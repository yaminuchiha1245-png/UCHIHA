#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, hmac, http.cookiejar, json, os, secrets, sys, time
import urllib.error, urllib.request
from pathlib import Path
from urllib.parse import urljoin, urlparse

def canonical_json_sha(obj):
    raw=json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()
    return hashlib.sha256(raw).hexdigest()

def signed_headers(method,path,body=b""):
    secret=os.environ.get("UCHIHA_CONNECTOR_GATEWAY_HMAC_SECRET","")
    if not secret:
        return {}
    key_id=os.environ.get("UCHIHA_CONNECTOR_GATEWAY_HMAC_KEY_ID","primary")
    actor=os.environ.get("UCHIHA_SMOKE_ACTOR","launch-smoke")
    role=os.environ.get("UCHIHA_SMOKE_ROLE","owner")
    timestamp=str(int(time.time()))
    nonce="SMOKE-"+secrets.token_urlsafe(18)
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

def fetch(base,path,timeout,auth=False,opener=None):
    url=urljoin(base.rstrip("/")+"/",path.lstrip("/"))
    headers={"Accept":"application/json"}
    if auth:
        headers.update(signed_headers("GET",path))
    req=urllib.request.Request(url,method="GET",headers=headers)
    agent=opener or urllib.request.build_opener()
    try:
        with agent.open(req,timeout=timeout) as r:
            raw=r.read()
            body=json.loads(raw.decode()) if raw else {}
            return r.status,body,dict(r.headers.items())
    except urllib.error.HTTPError as e:
        raw=e.read()
        try: body=json.loads(raw.decode()) if raw else {}
        except Exception: body={"raw":raw.decode(errors="replace")}
        return e.code,body,dict(e.headers.items())

def post_json(base,path,payload,timeout,headers=None,opener=None):
    url=urljoin(base.rstrip("/")+"/",path.lstrip("/"))
    raw=json.dumps(payload).encode()
    final={"Accept":"application/json","Content-Type":"application/json","X-Uchiha-Contract":"1.0"}
    final.update(headers or {})
    req=urllib.request.Request(url,data=raw,method="POST",headers=final)
    agent=opener or urllib.request.build_opener()
    try:
        with agent.open(req,timeout=timeout) as r:
            data=r.read()
            body=json.loads(data.decode()) if data else {}
            return r.status,body,dict(r.headers.items())
    except urllib.error.HTTPError as e:
        data=e.read()
        try: body=json.loads(data.decode()) if data else {}
        except Exception: body={"raw":data.decode(errors="replace")}
        return e.code,body,dict(e.headers.items())

def operator_browser_smoke(base,timeout):
    username=os.environ.get("UCHIHA_SMOKE_OPERATOR_USERNAME","owner").strip().lower()
    password_file=os.environ.get("UCHIHA_SMOKE_OPERATOR_PASSWORD_FILE","").strip()
    if not password_file:
        return False,{"error":"UCHIHA_SMOKE_OPERATOR_PASSWORD_FILE is required"}
    path=Path(password_file)
    if not path.is_file():
        return False,{"error":"operator password file is missing"}
    password=path.read_text(encoding="utf-8").rstrip("\r\n")
    if not password:
        return False,{"error":"operator password file is empty"}

    jar=http.cookiejar.CookieJar()
    opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    login={
        "contractVersion":"1.0",
        "requestId":"SMOKE-LOGIN-"+secrets.token_hex(8).upper(),
        "operation":"operator-login",
        "username":username,
        "password":password,
    }
    status,body,_=post_json(base,"/api/connectors/radius/session/login",login,timeout,opener=opener)
    if status!=200 or body.get("authenticated") is not True:
        return False,{"stage":"login","status":status,"code":(body.get("error") or {}).get("code")}
    csrf=body.get("csrfToken")
    if not csrf:
        return False,{"stage":"login","status":status,"error":"csrf missing"}

    status,context,_=fetch(base,"/api/connectors/radius/auth-context",timeout,opener=opener)
    if status!=200 or context.get("authenticated") is not True or context.get("actor")!=username:
        return False,{"stage":"context","status":status}

    logout={
        "contractVersion":"1.0",
        "requestId":"SMOKE-LOGOUT-"+secrets.token_hex(8).upper(),
        "operation":"operator-logout",
    }
    status,out,_=post_json(
        base,"/api/connectors/radius/session/logout",logout,timeout,
        headers={"X-Uchiha-CSRF":csrf},opener=opener
    )
    if status!=200 or out.get("authenticated") is not False:
        return False,{"stage":"logout","status":status}

    return True,{"username":username,"role":body.get("role"),"passwordExposed":False}

def main():
    ap=argparse.ArgumentParser(description="UCHIHA RADIUS-A v101/v37 launch smoke")
    ap.add_argument("--base-url",default=os.environ.get("UCHIHA_SMOKE_BASE_URL",""))
    ap.add_argument("--timeout",type=float,default=8.0)
    ap.add_argument("--allow-http",action="store_true",help="Local test only")
    ap.add_argument("--skip-operator-login",action="store_true",help="Explicitly skip browser-operator login proof")
    ap.add_argument("--startup-only",action="store_true",help="Post-restart smoke before post-deploy verification; does not require READY_TO_SERVE")
    args=ap.parse_args()
    if not args.base_url:
        raise SystemExit("BLOCKED: --base-url or UCHIHA_SMOKE_BASE_URL is required")
    parsed=urlparse(args.base_url)
    if parsed.scheme not in {"https","http"}:
        raise SystemExit("BLOCKED: base URL must be http(s)")
    if parsed.scheme!="https" and not args.allow_http:
        raise SystemExit("BLOCKED: production launch smoke requires HTTPS")

    result={"ok":False,"baseUrl":args.base_url,"checks":{},"errors":[]}

    def check(name,path,auth,predicate):
        status,body,headers=fetch(args.base_url,path,args.timeout,auth=auth)
        try: ok=bool(predicate(status,body,headers))
        except Exception: ok=False
        result["checks"][name]={"ok":ok,"status":status}
        if not ok:
            code=(body.get("error") or {}).get("code") if isinstance(body,dict) else None
            result["errors"].append({"check":name,"status":status,"code":code})
        return status,body,headers

    check("liveness","/api/connectors/radius/health/live",False,
          lambda s,b,h:s==200 and b.get("alive") is True)

    _,release_identity,_=check("releaseIdentity","/api/connectors/radius/release-readiness",True,
          lambda s,b,h:s==200
          and b.get("backendBuild")=="v37"
          and b.get("uiBuild")=="v101"
          and b.get("databaseSchema",{}).get("currentVersion")==30)

    if not args.startup_only:
        check("readiness","/api/connectors/radius/health/ready",False,
              lambda s,b,h:s==200 and b.get("ready") is True)

    _,integrity,_=check("releaseIntegrity","/api/connectors/radius/release-integrity",True,
          lambda s,b,h:s==200
          and b.get("releaseIntegrity",{}).get("verified") is True
          and b.get("releaseIntegrity",{}).get("manifestPinned") is True)

    _,edge,_=check("edgeProtection","/api/connectors/radius/edge-protection",True,
          lambda s,b,h:s==200
          and b.get("edgeProtection",{}).get("ready") is True
          and b.get("edgeProtection",{}).get("boundedConcurrency") is True
          and b.get("edgeProtection",{}).get("gatewayPreAuthRateLimit") is True)

    _,lease,_=check("instanceLease","/api/connectors/radius/instance-lock",True,
          lambda s,b,h:s==200
          and b.get("instanceLease",{}).get("held") is True
          and b.get("instanceLease",{}).get("ready") is True
          and b.get("instanceLease",{}).get("kernelReleasedOnProcessExit") is True)

    _,host,_=check("hostPreflight","/api/connectors/radius/host-preflight",True,
          lambda s,b,h:s==200
          and b.get("hostPreflight",{}).get("ready") is True
          and b.get("hostPreflight",{}).get("linux") is True
          and b.get("hostPreflight",{}).get("databaseDirectoryWritable") is True
          and b.get("hostPreflight",{}).get("backupDirectoryWritable") is True
          and b.get("hostPreflight",{}).get("networkCallsPerformed") is False)

    launch={}
    if not args.startup_only:
        _,launch,_=check("launchGate","/api/connectors/radius/launch-readiness",True,
              lambda s,b,h:s==200
              and b.get("launchReadiness",{}).get("safeToServe") is True
              and b.get("launchReadiness",{}).get("status")=="READY_TO_SERVE"
              and b.get("launchReadiness",{}).get("checks",{}).get("configuration",{}).get("operatorSessionReady") is True)

    _,contract,ch=check("apiContract","/api/connectors/radius/api-contract",True,
          lambda s,b,h:s==200 and b.get("apiContract",{}).get("valid") is True)
    _,openapi,oh=check("openapi","/api/connectors/radius/openapi.json",True,
          lambda s,b,h:s==200 and b.get("openapi")=="3.1.0")

    if isinstance(contract,dict) and isinstance(openapi,dict):
        summary=contract.get("apiContract") or {}
        calculated=canonical_json_sha(openapi)
        contract_hash=summary.get("sha256")
        advertised=ch.get("X-API-Contract-SHA256") or oh.get("X-API-Contract-SHA256")
        ok=bool(contract_hash and calculated==contract_hash and advertised==contract_hash)
        result["checks"]["contractHash"]={"ok":ok,"sha256":contract_hash}
        if not ok: result["errors"].append({"check":"contractHash"})

    if args.skip_operator_login:
        result["checks"]["operatorBrowserLogin"]={"ok":True,"skipped":True}
    else:
        ok,detail=operator_browser_smoke(args.base_url,args.timeout)
        result["checks"]["operatorBrowserLogin"]={"ok":ok,**detail}
        if not ok:
            result["errors"].append({"check":"operatorBrowserLogin","detail":detail})

    launch_state=(launch.get("launchReadiness") or {}) if isinstance(launch,dict) else {}
    release_state=(release_identity if isinstance(release_identity,dict) else {})
    integrity_state=(integrity.get("releaseIntegrity") or {}) if isinstance(integrity,dict) else {}
    edge_state=(edge.get("edgeProtection") or {}) if isinstance(edge,dict) else {}
    lease_state=(lease.get("instanceLease") or {}) if isinstance(lease,dict) else {}
    host_state=(host.get("hostPreflight") or {}) if isinstance(host,dict) else {}
    operator_state=launch_state.get("operatorAuthentication") or {}
    result.update({
        "mode":"startup-only" if args.startup_only else "final",
        "launchStatus":launch_state.get("status") if not args.startup_only else None,
        "launchScore":launch_state.get("score") if not args.startup_only else None,
        "backendBuild":release_state.get("backendBuild") or launch_state.get("backendBuild"),
        "uiBuild":release_state.get("uiBuild") or launch_state.get("uiBuild"),
        "databaseSchemaVersion":(release_state.get("databaseSchema") or {}).get("currentVersion") or launch_state.get("databaseSchemaVersion"),
        "blockers":launch_state.get("blockers",[]),
        "releaseIntegrityVerified":integrity_state.get("verified"),
        "verifiedRuntimeFiles":integrity_state.get("verifiedFiles"),
        "edgeProtectionReady":edge_state.get("ready"),
        "edgeMaxConcurrentRequests":edge_state.get("maxConcurrentRequests"),
        "instanceLeaseHeld":lease_state.get("held"),
        "instanceLeaseOwnerPid":lease_state.get("ownerPid"),
        "hostPreflightReady":host_state.get("ready"),
        "hostPythonVersion":host_state.get("pythonVersion"),
        "hostSqliteVersion":host_state.get("sqliteVersion"),
        "operatorAuthenticationReady":operator_state.get("ready"),
        "enabledOwners":operator_state.get("enabledOwners"),
    })
    result["ok"]=all(v.get("ok") for v in result["checks"].values())
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return 0 if result["ok"] else 2

if __name__=="__main__":
    raise SystemExit(main())
