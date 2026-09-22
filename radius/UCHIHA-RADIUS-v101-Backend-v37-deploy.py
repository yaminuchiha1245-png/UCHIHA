#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, os, shutil, subprocess, sys, tempfile, time
from pathlib import Path

def sha256_file(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()

def load_manifest(source: Path):
    expected=source/"UCHIHA-RADIUS-v101-Backend-v37-RELEASE-MANIFEST.json"
    if expected.is_file():
        path=expected
    else:
        matches=sorted(source.glob("UCHIHA-RADIUS-*-RELEASE-MANIFEST.json"))
        if len(matches)!=1:
            raise RuntimeError(f"expected v101/v37 release manifest (or exactly one manifest), found {len(matches)}")
        path=matches[0]
    data=json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data,dict) or not isinstance(data.get("files"),list):
        raise RuntimeError("release manifest is invalid")
    return path,data

def verify_release(source: Path, manifest: dict):
    results=[]
    errors=[]
    for item in manifest["files"]:
        name=item.get("name")
        if not name or Path(name).name!=name:
            errors.append(f"invalid manifest file name: {name!r}")
            continue
        path=source/name
        present=path.is_file()
        actual_bytes=path.stat().st_size if present else None
        actual_sha=sha256_file(path) if present else None
        ok=bool(
            present and
            actual_bytes==item.get("bytes") and
            actual_sha==item.get("sha256")
        )
        results.append({"name":name,"ok":ok})
        if not ok:
            errors.append(f"hash/size mismatch: {name}")
    return results,errors

def read_env_file(path: Path):
    out={}
    if not path.is_file():
        raise RuntimeError(f"environment file not found: {path}")
    for raw in path.read_text(encoding="utf-8").splitlines():
        line=raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k,v=line.split("=",1)
        out[k.strip()]=v.strip().strip("'").strip('"')
    return out

def atomic_symlink(target: Path, link: Path):
    link.parent.mkdir(parents=True,exist_ok=True)
    temp=link.with_name(link.name+f".tmp-{os.getpid()}")
    try:
        temp.unlink(missing_ok=True)
        temp.symlink_to(target)
        os.replace(temp,link)
    finally:
        temp.unlink(missing_ok=True)

def run(cmd,env=None,check=True):
    p=subprocess.run(cmd,env=env,text=True,capture_output=True)
    if check and p.returncode!=0:
        raise RuntimeError(
            f"command failed ({p.returncode}): {' '.join(cmd)}\n"
            f"stdout={p.stdout[-2000:]}\nstderr={p.stderr[-2000:]}"
        )
    return p

def main():
    ap=argparse.ArgumentParser(description="Atomic UCHIHA RADIUS release deploy with rollback")
    ap.add_argument("--source-dir",default=str(Path(__file__).resolve().parent))
    ap.add_argument("--release-root",default="/opt/uchiha-radius/releases")
    ap.add_argument("--current-link",default="/opt/uchiha-radius/current")
    ap.add_argument("--env-file",default="/etc/uchiha-radius/connector.env")
    ap.add_argument("--service-name",default="uchiha-radius")
    ap.add_argument("--systemd-unit-destination",default="/etc/systemd/system/uchiha-radius.service")
    ap.add_argument("--smoke-base-url",default=os.environ.get("UCHIHA_SMOKE_BASE_URL",""))
    ap.add_argument("--verify-only",action="store_true")
    ap.add_argument("--dry-run",action="store_true")
    ap.add_argument("--skip-systemctl",action="store_true")
    ap.add_argument("--skip-smoke",action="store_true")
    args=ap.parse_args()

    source=Path(args.source_dir).resolve()
    manifest_path,manifest=load_manifest(source)
    verified,errors=verify_release(source,manifest)
    release_id=manifest.get("releaseId") or f"{manifest.get('uiBuild','ui')}-{manifest.get('backendBuild','backend')}"
    output={
        "ok":False,
        "releaseId":release_id,
        "source":str(source),
        "verifiedFiles":sum(1 for x in verified if x["ok"]),
        "manifestFiles":len(verified),
        "errors":list(errors),
        "rolledBack":False,
    }
    if errors:
        print(json.dumps(output,ensure_ascii=False,indent=2))
        return 2

    # Verify the production environment pins this release's runtime integrity manifest.
    env_path=Path(args.env_file)
    env_values=None
    if not args.verify_only and env_path.exists():
        env_values=read_env_file(env_path)
        integrity_name=manifest.get("integrityManifest")
        integrity_sha=manifest.get("integrityManifestSha256")
        if integrity_name and integrity_sha:
            configured=env_values.get("UCHIHA_RELEASE_INTEGRITY_MANIFEST_SHA256","")
            if configured!=integrity_sha:
                output["errors"].append("environment integrity-manifest SHA pin does not match this release")
                print(json.dumps(output,ensure_ascii=False,indent=2))
                return 2

    if args.verify_only:
        output["ok"]=True
        output["mode"]="verify-only"
        print(json.dumps(output,ensure_ascii=False,indent=2))
        return 0

    release_root=Path(args.release_root)
    current_link=Path(args.current_link)
    final_dir=release_root/release_id
    previous_target=None
    if current_link.is_symlink():
        try: previous_target=current_link.resolve(strict=True)
        except FileNotFoundError: previous_target=None

    output["previousRelease"]=str(previous_target) if previous_target else None
    output["targetRelease"]=str(final_dir)

    if args.dry_run:
        output["ok"]=True
        output["mode"]="dry-run"
        output["wouldRestartService"]=not args.skip_systemctl
        output["wouldRunSmoke"]=not args.skip_smoke
        print(json.dumps(output,ensure_ascii=False,indent=2))
        return 0

    release_root.mkdir(parents=True,exist_ok=True)
    staging=release_root/(release_id+f".staging-{os.getpid()}")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(mode=0o700)

    try:
        for item in manifest["files"]:
            shutil.copy2(source/item["name"],staging/item["name"])
        shutil.copy2(manifest_path,staging/manifest_path.name)

        stage_results,stage_errors=verify_release(staging,manifest)
        if stage_errors:
            raise RuntimeError("staging verification failed: "+", ".join(stage_errors))

        if final_dir.exists():
            existing_results,existing_errors=verify_release(final_dir,manifest)
            if existing_errors:
                raise RuntimeError(f"target release directory already exists but differs: {final_dir}")
            shutil.rmtree(staging)
        else:
            staging.rename(final_dir)

        atomic_symlink(final_dir,current_link)

        if not args.skip_systemctl:
            unit_source=final_dir/"uchiha-radius-v37.service"
            unit_dest=Path(args.systemd_unit_destination)
            unit_dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(unit_source,unit_dest)
            run(["systemctl","daemon-reload"])
            run(["systemctl","restart",args.service_name])
            active=run(["systemctl","is-active","--quiet",args.service_name],check=False)
            if active.returncode!=0:
                raise RuntimeError("service is not active after restart")

        if not args.skip_smoke:
            if not args.smoke_base_url:
                raise RuntimeError("--smoke-base-url or UCHIHA_SMOKE_BASE_URL is required unless --skip-smoke is explicit")
            smoke_env=os.environ.copy()
            if env_values is None:
                env_values=read_env_file(env_path)
            smoke_env.update(env_values)
            smoke=final_dir/"UCHIHA-RADIUS-v101-Backend-v37-launch-smoke.py"
            smoke_cmd=[sys.executable,"-S","-B",str(smoke),"--base-url",args.smoke_base_url,"--startup-only"]
            smoke_password_file=(env_values or {}).get("UCHIHA_SMOKE_OPERATOR_PASSWORD_FILE","")
            if not smoke_password_file or not Path(smoke_password_file).is_file():
                smoke_cmd.append("--skip-operator-login")
            smoke_result=run(
                smoke_cmd,
                env=smoke_env,
                check=False,
            )
            output["startupSmokeReturnCode"]=smoke_result.returncode
            if smoke_result.stdout.strip():
                try: output["startupSmoke"]=json.loads(smoke_result.stdout)
                except Exception: output["startupSmokeOutput"]=smoke_result.stdout[-4000:]
            if smoke_result.returncode!=0:
                raise RuntimeError("post-restart startup smoke failed")

        output["ok"]=True
        output["mode"]="deployed"
        output["currentRelease"]=str(final_dir)
        print(json.dumps(output,ensure_ascii=False,indent=2))
        return 0

    except Exception as exc:
        output["errors"].append(str(exc))
        # Roll back the active symlink and service if a previous release exists.
        try:
            if previous_target and previous_target.exists():
                atomic_symlink(previous_target,current_link)
                output["rolledBack"]=True
                output["rollbackRelease"]=str(previous_target)
                if not args.skip_systemctl:
                    run(["systemctl","restart",args.service_name],check=False)
            else:
                output["rolledBack"]=False
        except Exception as rollback_exc:
            output["errors"].append("rollback failed: "+str(rollback_exc))
        print(json.dumps(output,ensure_ascii=False,indent=2))
        return 3
    finally:
        if staging.exists():
            shutil.rmtree(staging,ignore_errors=True)

if __name__=="__main__":
    raise SystemExit(main())
