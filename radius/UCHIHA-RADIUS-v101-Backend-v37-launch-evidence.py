#!/usr/bin/env python3
from __future__ import annotations
import argparse, datetime as dt, hashlib, hmac, json, os, secrets, shutil, subprocess, sys
import urllib.error, urllib.request
from pathlib import Path
from urllib.parse import urljoin, urlparse

RELEASE_ID="uchiha-radius-v101-backend-v37"
EXPECTED_BACKEND="v37"
EXPECTED_UI="v101"
EXPECTED_SCHEMA=30
SENSITIVE_FRAGMENTS=("password","secret","token","authorization","cookie","privatekey","credential")

def sha256_file(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()

def redact(value):
    if isinstance(value,dict):
        out={}
        for k,v in value.items():
            lk=str(k).lower()
            if any(fragment in lk for fragment in SENSITIVE_FRAGMENTS):
                out[k]="[REDACTED]"
            else:
                out[k]=redact(v)
        return out
    if isinstance(value,list):
        return [redact(x) for x in value]
    return value

def canonical_json_sha(obj) -> str:
    raw=json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()
    return hashlib.sha256(raw).hexdigest()

def signed_headers(method: str, path: str, body: bytes=b"") -> dict:
    secret=os.environ.get("UCHIHA_CONNECTOR_GATEWAY_HMAC_SECRET","")
    if not secret:
        return {}
    key_id=os.environ.get("UCHIHA_CONNECTOR_GATEWAY_HMAC_KEY_ID","primary")
    actor=os.environ.get("UCHIHA_EVIDENCE_ACTOR","launch-evidence")
    role=os.environ.get("UCHIHA_EVIDENCE_ROLE","owner")
    timestamp=str(int(dt.datetime.now(dt.timezone.utc).timestamp()))
    nonce="EVIDENCE-"+secrets.token_urlsafe(18)
    body_sha=hashlib.sha256(body).hexdigest()
    canonical="\n".join([
        "UCHIHA-GATEWAY-HMAC-V1",method.upper(),path,actor,role,
        timestamp,nonce,body_sha
    ])
    sig=hmac.new(secret.encode(),canonical.encode(),hashlib.sha256).hexdigest()
    return {
        "X-Uchiha-Gateway-Signature":"sha256="+sig,
        "X-Uchiha-Gateway-Key-Id":key_id,
        "X-Uchiha-Gateway-Timestamp":timestamp,
        "X-Uchiha-Gateway-Nonce":nonce,
        "X-Uchiha-Actor":actor,
        "X-Uchiha-Role":role,
    }

def fetch(base: str, path: str, timeout: float, auth: bool) -> dict:
    headers={"Accept":"application/json"}
    if auth:
        headers.update(signed_headers("GET",path))
    req=urllib.request.Request(urljoin(base.rstrip("/")+"/",path.lstrip("/")),method="GET",headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:
            raw=r.read()
            try: body=json.loads(raw.decode()) if raw else {}
            except Exception: body={"invalidJson":True}
            return {"status":r.status,"body":redact(body)}
    except urllib.error.HTTPError as e:
        raw=e.read()
        try: body=json.loads(raw.decode()) if raw else {}
        except Exception: body={"invalidJson":True}
        return {"status":e.code,"body":redact(body)}
    except Exception as exc:
        return {"status":None,"error":type(exc).__name__}

def command_evidence(cmd: list[str]) -> dict:
    if not shutil.which(cmd[0]):
        return {"available":False,"ok":False,"returnCode":None}
    try:
        p=subprocess.run(cmd,capture_output=True,text=True,timeout=15)
        # Do not retain command stdout/stderr: only status metadata.
        return {"available":True,"ok":p.returncode==0,"returnCode":p.returncode}
    except Exception as exc:
        return {"available":True,"ok":False,"error":type(exc).__name__}

def verify_local_release(release_dir: Path) -> dict:
    manifest_path=release_dir/"UCHIHA-RADIUS-v101-Backend-v37-RELEASE-MANIFEST.json"
    if not manifest_path.is_file():
        return {"available":False,"verified":False,"reason":"release-manifest-missing"}
    try:
        manifest=json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return {"available":True,"verified":False,"reason":"release-manifest-invalid"}

    results=[]
    errors=[]
    for item in manifest.get("files",[]):
        name=item.get("name")
        if not name or Path(name).name!=name:
            errors.append("invalid-file-entry")
            continue
        p=release_dir/name
        actual_sha=sha256_file(p) if p.is_file() else None
        actual_size=p.stat().st_size if p.is_file() else None
        ok=bool(p.is_file() and actual_sha==item.get("sha256") and actual_size==item.get("bytes"))
        results.append({"name":name,"ok":ok})
        if not ok:
            errors.append(name)
    return {
        "available":True,
        "verified":not errors and bool(results),
        "releaseId":manifest.get("releaseId"),
        "backendBuild":manifest.get("backendBuild"),
        "uiBuild":manifest.get("uiBuild"),
        "databaseSchemaVersion":manifest.get("databaseSchemaVersion"),
        "verifiedFiles":sum(1 for x in results if x["ok"]),
        "manifestFiles":len(results),
        "errors":errors,
        "manifestSha256":sha256_file(manifest_path),
    }

def main() -> int:
    ap=argparse.ArgumentParser(description="Collect secret-free UCHIHA RADIUS launch evidence")
    ap.add_argument("--base-url",default=os.environ.get("UCHIHA_SMOKE_BASE_URL",""))
    ap.add_argument("--release-dir",default="/opt/uchiha-radius/current")
    ap.add_argument("--output-dir",default=".")
    ap.add_argument("--timeout",type=float,default=8.0)
    ap.add_argument("--allow-http",action="store_true",help="Local/fake test only")
    ap.add_argument("--service-name",default="uchiha-radius")
    args=ap.parse_args()

    if not args.base_url:
        raise SystemExit("BLOCKED: --base-url or UCHIHA_SMOKE_BASE_URL is required")
    parsed=urlparse(args.base_url)
    if parsed.scheme not in {"https","http"}:
        raise SystemExit("BLOCKED: base URL must be http(s)")
    if parsed.scheme!="https" and not args.allow_http:
        raise SystemExit("BLOCKED: production evidence collection requires HTTPS")

    endpoints=[
        ("liveness","/api/connectors/radius/health/live",False),
        ("readiness","/api/connectors/radius/health/ready",False),
        ("releaseReadiness","/api/connectors/radius/release-readiness",True),
        ("hostPreflight","/api/connectors/radius/host-preflight",True),
        ("instanceLease","/api/connectors/radius/instance-lock",True),
        ("releaseIntegrity","/api/connectors/radius/release-integrity",True),
        ("edgeProtection","/api/connectors/radius/edge-protection",True),
        ("productionReadiness","/api/connectors/radius/production-readiness",True),
        ("databaseSchema","/api/connectors/radius/database-schema",True),
        ("processLifecycle","/api/connectors/radius/process-lifecycle",True),
        ("launchReadiness","/api/connectors/radius/launch-readiness",True),
        ("apiContract","/api/connectors/radius/api-contract",True),
    ]

    responses={name:fetch(args.base_url,path,args.timeout,auth) for name,path,auth in endpoints}
    local=verify_local_release(Path(args.release_dir))

    rel=(responses["releaseReadiness"].get("body") or {})
    launch=(responses["launchReadiness"].get("body") or {}).get("launchReadiness") or {}
    host=(responses["hostPreflight"].get("body") or {}).get("hostPreflight") or {}
    lease=(responses["instanceLease"].get("body") or {}).get("instanceLease") or {}
    integrity=(responses["releaseIntegrity"].get("body") or {}).get("releaseIntegrity") or {}
    edge=(responses["edgeProtection"].get("body") or {}).get("edgeProtection") or {}
    schema=(responses["databaseSchema"].get("body") or {}).get("databaseSchema") or {}
    api=(responses["apiContract"].get("body") or {}).get("apiContract") or {}
    ready_body=responses["readiness"].get("body") or {}

    checks={
        "https":parsed.scheme=="https" or args.allow_http,
        "liveness":responses["liveness"].get("status")==200 and (responses["liveness"].get("body") or {}).get("alive") is True,
        "readiness":responses["readiness"].get("status")==200 and ready_body.get("ready") is True,
        "releaseIdentity":(
            responses["releaseReadiness"].get("status")==200
            and rel.get("backendBuild")==EXPECTED_BACKEND
            and rel.get("uiBuild")==EXPECTED_UI
        ),
        "schema30":(
            responses["databaseSchema"].get("status")==200
            and (schema.get("currentVersion")==EXPECTED_SCHEMA or rel.get("databaseSchema",{}).get("currentVersion")==EXPECTED_SCHEMA)
        ),
        "hostPreflight":responses["hostPreflight"].get("status")==200 and host.get("ready") is True,
        "instanceLease":responses["instanceLease"].get("status")==200 and lease.get("held") is True and lease.get("ready") is True,
        "releaseIntegrity":responses["releaseIntegrity"].get("status")==200 and integrity.get("verified") is True,
        "edgeProtection":responses["edgeProtection"].get("status")==200 and edge.get("ready") is True,
        "apiContract":responses["apiContract"].get("status")==200 and api.get("valid") is True,
        "launchReadyToServe":(
            responses["launchReadiness"].get("status")==200
            and launch.get("status")=="READY_TO_SERVE"
            and launch.get("safeToServe") is True
            and launch.get("score")==100
            and launch.get("blockers")==[]
        ),
        "localReleaseFiles":local.get("verified") is True,
    }

    system={
        "systemd":command_evidence(["systemctl","is-active","--quiet",args.service_name]),
        "nginxConfig":command_evidence(["nginx","-t"]),
    }

    evidence={
        "formatVersion":"1.0",
        "product":"UCHIHA RADIUS-A",
        "releaseId":RELEASE_ID,
        "expected":{"backendBuild":EXPECTED_BACKEND,"uiBuild":EXPECTED_UI,"databaseSchemaVersion":EXPECTED_SCHEMA},
        "collectedAtUtc":dt.datetime.now(dt.timezone.utc).isoformat(),
        "baseUrl":args.base_url,
        "checks":checks,
        "allRequiredChecksPassed":all(checks.values()),
        "system":system,
        "localRelease":local,
        "responses":responses,
        "secretsIncluded":False,
    }

    output_dir=Path(args.output_dir)
    output_dir.mkdir(parents=True,exist_ok=True)
    stamp=dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out=output_dir/f"UCHIHA-RADIUS-v101-Backend-v37-LAUNCH-EVIDENCE-{stamp}.json"
    out.write_text(json.dumps(evidence,ensure_ascii=False,sort_keys=True,indent=2),encoding="utf-8")
    digest=sha256_file(out)
    sha=out.with_suffix(out.suffix+".sha256")
    sha.write_text(f"{digest}  {out.name}\n",encoding="ascii")

    summary={
        "ok":evidence["allRequiredChecksPassed"],
        "evidenceFile":str(out),
        "sha256File":str(sha),
        "sha256":digest,
        "launchStatus":launch.get("status"),
        "launchScore":launch.get("score"),
        "failedChecks":[k for k,v in checks.items() if not v],
        "secretsIncluded":False,
    }
    print(json.dumps(summary,ensure_ascii=False,indent=2))
    return 0 if summary["ok"] else 2

if __name__=="__main__":
    raise SystemExit(main())
