#!/usr/bin/env python3
from __future__ import annotations
import argparse, datetime as dt, hashlib, hmac, json, os, secrets, subprocess, sys
import urllib.error, urllib.request
from pathlib import Path
from urllib.parse import urljoin, urlparse

EXPECTED_BACKEND="v37"
EXPECTED_UI="v101"
EXPECTED_SCHEMA=30
CONTRACT_VERSION="1.0"

def canonical_body(payload: dict | None) -> bytes:
    if payload is None:
        return b""
    return json.dumps(payload,ensure_ascii=False,separators=(",",":")).encode()

def signed_headers(method: str, path: str, body: bytes=b"") -> dict:
    secret=os.environ.get("UCHIHA_CONNECTOR_GATEWAY_HMAC_SECRET","").strip()
    if not secret:
        raise RuntimeError("UCHIHA_CONNECTOR_GATEWAY_HMAC_SECRET is required")
    key_id=os.environ.get("UCHIHA_CONNECTOR_GATEWAY_HMAC_KEY_ID","primary").strip()
    actor=os.environ.get("UCHIHA_LAUNCH_ACTOR","production-launch").strip() or "production-launch"
    role=os.environ.get("UCHIHA_LAUNCH_ROLE","owner").strip() or "owner"
    timestamp=str(int(dt.datetime.now(dt.timezone.utc).timestamp()))
    nonce="LAUNCH-"+secrets.token_urlsafe(18)
    body_sha=hashlib.sha256(body).hexdigest()
    canonical="\n".join([
        "UCHIHA-GATEWAY-HMAC-V1",method.upper(),path,actor,role,
        timestamp,nonce,body_sha
    ])
    signature=hmac.new(secret.encode(),canonical.encode(),hashlib.sha256).hexdigest()
    return {
        "Accept":"application/json",
        "X-Uchiha-Gateway-Signature":"sha256="+signature,
        "X-Uchiha-Gateway-Key-Id":key_id,
        "X-Uchiha-Gateway-Timestamp":timestamp,
        "X-Uchiha-Gateway-Nonce":nonce,
        "X-Uchiha-Actor":actor,
        "X-Uchiha-Role":role,
    }

def request_json(base: str, method: str, path: str, timeout: float, payload: dict | None=None) -> tuple[int,dict]:
    body=canonical_body(payload)
    headers=signed_headers(method,path,body)
    if payload is not None:
        headers["Content-Type"]="application/json"
        headers["X-Uchiha-Contract"]=CONTRACT_VERSION
    req=urllib.request.Request(
        urljoin(base.rstrip("/")+"/",path.lstrip("/")),
        data=body if payload is not None else None,
        method=method.upper(),
        headers=headers
    )
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:
            raw=r.read()
            return r.status,json.loads(raw.decode()) if raw else {}
    except urllib.error.HTTPError as e:
        raw=e.read()
        try: data=json.loads(raw.decode()) if raw else {}
        except Exception: data={"raw":"non-json-error"}
        return e.code,data

def fail(message: str, details=None, code=2):
    result={"ok":False,"error":message}
    if details is not None: result["details"]=details
    print(json.dumps(result,ensure_ascii=False,indent=2))
    raise SystemExit(code)

def require(condition: bool, message: str, details=None):
    if not condition:
        fail(message,details)

def get_launch(base,timeout):
    status,body=request_json(base,"GET","/api/connectors/radius/launch-readiness",timeout)
    require(status==200,"launch-readiness request failed",{"status":status})
    state=body.get("launchReadiness") or {}
    return state

def make_request_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(8).upper()}"

def run_evidence(collector: Path, base: str, release_dir: str, output_dir: str, timeout: float, allow_http: bool=False) -> dict:
    if not collector.is_file():
        fail("launch evidence collector is missing",{"path":str(collector)})
    env=os.environ.copy()
    cmd=[
        sys.executable,"-S","-B",str(collector),
        "--base-url",base,
        "--release-dir",release_dir,
        "--output-dir",output_dir,
        "--timeout",str(timeout),
    ]
    if allow_http:
        cmd.append("--allow-http")
    p=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=max(30,int(timeout*8)))
    try:
        payload=json.loads(p.stdout) if p.stdout.strip() else {}
    except Exception:
        payload={"stdout":"invalid-json"}
    if p.returncode!=0:
        fail("launch evidence collection failed",{
            "returnCode":p.returncode,
            "summary":payload,
            "stderr":p.stderr[-1200:] if p.stderr else "",
        })
    return payload

def main() -> int:
    ap=argparse.ArgumentParser(description="UCHIHA RADIUS-A guarded production launch orchestrator")
    ap.add_argument("--base-url",default=os.environ.get("UCHIHA_SMOKE_BASE_URL",""))
    ap.add_argument("--timeout",type=float,default=10.0)
    ap.add_argument("--execute",action="store_true",
                    help="Actually create checkpoint and run guarded post-deploy verification. Without this flag: read-only plan.")
    ap.add_argument("--checkpoint-timeout",type=float,default=30.0)
    ap.add_argument("--reason",default="production-launch-v101-v37")
    ap.add_argument("--release-dir",default="/opt/uchiha-radius/current")
    ap.add_argument("--evidence-output-dir",default="/var/lib/uchiha-radius/launch-evidence")
    ap.add_argument("--evidence-collector",
                    default=str(Path(__file__).resolve().with_name("UCHIHA-RADIUS-v101-Backend-v37-launch-evidence.py")))
    ap.add_argument("--skip-evidence",action="store_true",
                    help="Explicit testing/operator override; final production acceptance should not skip evidence.")
    ap.add_argument("--allow-http",action="store_true",help="Local/fake testing only")
    args=ap.parse_args()

    if not args.base_url:
        fail("--base-url or UCHIHA_SMOKE_BASE_URL is required")
    parsed=urlparse(args.base_url)
    if parsed.scheme not in {"https","http"}:
        fail("base URL must be http(s)")
    if parsed.scheme!="https" and not args.allow_http:
        fail("production launch orchestration requires HTTPS")

    # Verify auth material exists before any state-changing request.
    if not os.environ.get("UCHIHA_CONNECTOR_GATEWAY_HMAC_SECRET","").strip():
        fail("UCHIHA_CONNECTOR_GATEWAY_HMAC_SECRET is required")

    summary={
        "ok":False,
        "mode":"execute" if args.execute else "plan",
        "baseUrl":args.base_url,
        "expected":{"backendBuild":EXPECTED_BACKEND,"uiBuild":EXPECTED_UI,"schema":EXPECTED_SCHEMA},
        "steps":[],
    }

    def step(name,ok,details=None):
        item={"name":name,"ok":bool(ok)}
        if details is not None: item["details"]=details
        summary["steps"].append(item)
        require(ok,name+" failed",details)

    # 1. Identity / readiness proof.
    status,release=request_json(args.base_url,"GET","/api/connectors/radius/release-readiness",args.timeout)
    schema=((release.get("databaseSchema") or {}).get("currentVersion")) if isinstance(release,dict) else None
    step("release-identity",
         status==200 and release.get("backendBuild")==EXPECTED_BACKEND and release.get("uiBuild")==EXPECTED_UI and schema==EXPECTED_SCHEMA,
         {"status":status,"backendBuild":release.get("backendBuild"),"uiBuild":release.get("uiBuild"),"schema":schema})

    status,host=request_json(args.base_url,"GET","/api/connectors/radius/host-preflight",args.timeout)
    hp=host.get("hostPreflight") or {}
    step("host-preflight",
         status==200 and hp.get("ready") is True and hp.get("networkCallsPerformed") is False,
         {"status":status,"ready":hp.get("ready"),"blockers":hp.get("blockers",[])})

    status,lease=request_json(args.base_url,"GET","/api/connectors/radius/instance-lock",args.timeout)
    il=lease.get("instanceLease") or {}
    step("single-instance-lease",
         status==200 and il.get("held") is True and il.get("ready") is True,
         {"status":status,"held":il.get("held"),"ownerPid":il.get("ownerPid")})

    status,integrity=request_json(args.base_url,"GET","/api/connectors/radius/release-integrity",args.timeout)
    ri=integrity.get("releaseIntegrity") or {}
    step("release-integrity",
         status==200 and ri.get("verified") is True,
         {"status":status,"verified":ri.get("verified"),"blockers":ri.get("blockers",[])})

    # 2. Real network preflight.
    status,connectivity=request_json(args.base_url,"GET","/api/connectors/radius/connectivity-check",args.timeout)
    step("connectivity-preflight",
         status==200 and connectivity.get("overallReachable") is True,
         {"status":status,"overallReachable":connectivity.get("overallReachable")})

    launch=get_launch(args.base_url,args.timeout)
    summary["initialLaunchState"]={
        "status":launch.get("status"),
        "score":launch.get("score"),
        "blockers":launch.get("blockers",[]),
        "nextActions":launch.get("nextActions",[]),
    }

    # If already READY_TO_SERVE, do not create a redundant checkpoint.
    if launch.get("status")=="READY_TO_SERVE" and launch.get("safeToServe") is True:
        step("launch-already-ready-to-serve",True,{"score":launch.get("score")})
    else:
        step("ready-for-checkpoint",
             launch.get("status")=="READY_FOR_CHECKPOINT" and launch.get("readyForCheckpoint") is True,
             {"status":launch.get("status"),"blockers":launch.get("blockers",[]),"nextActions":launch.get("nextActions",[])})

        if not args.execute:
            summary["ok"]=True
            summary["nextAction"]="rerun with --execute to create the guarded checkpoint and complete activation"
            print(json.dumps(summary,ensure_ascii=False,indent=2))
            return 0

        # 3. Guarded checkpoint: enters maintenance, drains, backup, restore drill, required off-host proof.
        checkpoint_rid=make_request_id("LAUNCH-CHECKPOINT")
        checkpoint_body={
            "contractVersion":CONTRACT_VERSION,
            "requestId":checkpoint_rid,
            "operation":"create-deployment-checkpoint",
            "reason":args.reason,
            "timeoutSeconds":args.checkpoint_timeout,
        }
        status,checkpoint=request_json(
            args.base_url,"POST","/api/connectors/radius/deployment-checkpoint",
            max(args.timeout,args.checkpoint_timeout+10),checkpoint_body
        )
        cp=checkpoint.get("checkpoint") or {}
        step("guarded-deployment-checkpoint",
             status in {200,201} and checkpoint.get("safeForDeployment") is True
             and cp.get("status")=="verified"
             and (cp.get("drain") or {}).get("drained") is True
             and cp.get("backupName")
             and cp.get("backupSha256")
             and cp.get("restoreDrillPassed") is True
             and checkpoint.get("maintenanceRemainsEnabled") is True,
             {"status":status,"checkpointId":cp.get("checkpointId"),"checkpointStatus":cp.get("status"),
              "safeForDeployment":checkpoint.get("safeForDeployment"),
              "restoreDrillPassed":cp.get("restoreDrillPassed"),
              "maintenanceRemainsEnabled":checkpoint.get("maintenanceRemainsEnabled")})

        checkpoint_id=cp.get("checkpointId")
        require(bool(checkpoint_id),"checkpoint ID missing")

        launch=get_launch(args.base_url,args.timeout)
        step("ready-to-deploy",
             launch.get("status")=="READY_TO_DEPLOY" and launch.get("safeToDeploy") is True and launch.get("safeToServe") is False,
             {"status":launch.get("status"),"blockers":launch.get("blockers",[]),"nextActions":launch.get("nextActions",[])})

        # 4. Current-build post-deploy verification + guarded resume.
        verify_rid=make_request_id("LAUNCH-VERIFY")
        verify_body={
            "contractVersion":CONTRACT_VERSION,
            "requestId":verify_rid,
            "operation":"verify-deployment",
            "checkpointId":checkpoint_id,
            "expectedBackendBuild":EXPECTED_BACKEND,
            "expectedUiBuild":EXPECTED_UI,
            "resumeIfPassed":True,
        }
        status,verification=request_json(
            args.base_url,"POST","/api/connectors/radius/deployment-verification",
            max(args.timeout,45.0),verify_body
        )
        vr=verification.get("verification") or {}
        step("post-deploy-verification-and-resume",
             status==200 and vr.get("passed") is True and vr.get("resumed") is True
             and vr.get("status")=="verified-resumed"
             and vr.get("backupIntegrityVerified") is True
             and vr.get("backupHashMatches") is True
             and vr.get("connectivityReachable") is True
             and vr.get("databaseReady") is True
             and vr.get("observedBackendBuild")==EXPECTED_BACKEND
             and vr.get("observedUiBuild")==EXPECTED_UI,
             {"status":status,"verificationStatus":vr.get("status"),"passed":vr.get("passed"),
              "resumed":vr.get("resumed"),"blockers":vr.get("blockers",[])})

    # 5. Final GO gate.
    final_launch=get_launch(args.base_url,args.timeout)
    step("ready-to-serve",
         final_launch.get("status")=="READY_TO_SERVE"
         and final_launch.get("safeToServe") is True
         and final_launch.get("safeToLaunch") is True
         and final_launch.get("go") is True
         and final_launch.get("score")==100
         and final_launch.get("blockers")==[],
         {"status":final_launch.get("status"),"score":final_launch.get("score"),
          "blockers":final_launch.get("blockers",[])})

    # 6. Immutable evidence.
    evidence=None
    if args.skip_evidence:
        summary["evidenceSkipped"]=True
    else:
        evidence=run_evidence(
            Path(args.evidence_collector),args.base_url,args.release_dir,args.evidence_output_dir,args.timeout,args.allow_http
        )
        step("launch-evidence",evidence.get("ok") is True and evidence.get("failedChecks")==[],
             {"evidenceFile":evidence.get("evidenceFile"),"sha256":evidence.get("sha256")})

    summary["finalLaunchState"]={
        "status":final_launch.get("status"),
        "score":final_launch.get("score"),
        "blockers":final_launch.get("blockers",[]),
    }
    summary["evidence"]=evidence
    summary["ok"]=True
    print(json.dumps(summary,ensure_ascii=False,indent=2))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
