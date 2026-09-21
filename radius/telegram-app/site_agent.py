from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

CENTRAL=os.environ["UCHIHA_RADIUS_CENTRAL_URL"].rstrip("/")
AGENT_TOKEN=os.environ["UCHIHA_RADIUS_SITE_AGENT_TOKEN"]
LOCAL_GATEWAY=os.getenv("UCHIHA_SITE_GATEWAY_URL","http://127.0.0.1:8789").rstrip("/")
LOCAL_GATEWAY_TOKEN=os.environ["UCHIHA_SITE_GATEWAY_TOKEN"]
POLL_SECONDS=max(0.25,min(float(os.getenv("UCHIHA_SITE_AGENT_POLL_SECONDS","1")),10.0))
TIMEOUT=max(2.0,min(float(os.getenv("UCHIHA_SITE_AGENT_TIMEOUT","12")),30.0))
SESSION_SYNC_SECONDS=max(2.0,min(float(os.getenv("UCHIHA_SITE_AGENT_SESSION_SYNC_SECONDS","5")),60.0))

if urllib.parse.urlparse(CENTRAL).scheme!="https":
    raise RuntimeError("UCHIHA_RADIUS_CENTRAL_URL must use HTTPS")
if not LOCAL_GATEWAY.startswith(("http://127.0.0.1","http://localhost","https://")):
    raise RuntimeError("local gateway must be loopback HTTP or HTTPS")


def request_json(url: str, *, method: str="GET", token: str="", payload: dict|None=None, timeout: float=TIMEOUT):
    raw=None if payload is None else json.dumps(payload,ensure_ascii=False,separators=(",",":")).encode()
    headers={"Accept":"application/json"}
    if raw is not None:
        headers["Content-Type"]="application/json"
    if token:
        headers["Authorization"]=f"Bearer {token}"
    req=urllib.request.Request(url,data=raw,method=method,headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as response:
            body=response.read(262144)
            return int(response.status), json.loads(body.decode() or "{}")
    except urllib.error.HTTPError as exc:
        body=exc.read(262144)
        try: data=json.loads(body.decode() or "{}")
        except Exception: data={"error":"http-error"}
        return int(exc.code),data


def local_execute(operation: str,payload: dict)->dict:
    path="/api/radius/node-status" if operation=="node-status" else "/api/radius/session-command"
    try:
        status,data=request_json(
            LOCAL_GATEWAY+path,
            method="POST",
            token=LOCAL_GATEWAY_TOKEN,
            payload=payload,
            timeout=TIMEOUT,
        )
        if 200<=status<300 and isinstance(data,dict):
            data.setdefault("ok",True)
            return data
        return {"ok":False,"error":"local-gateway-rejected","httpStatus":status}
    except Exception as exc:
        return {"ok":False,"error":"local-gateway-unreachable","detail":type(exc).__name__}


def complete(command_id: str,result: dict)->None:
    request_json(
        f"{CENTRAL}/api/radius-agent/commands/{urllib.parse.quote(command_id,safe='')}/result",
        method="POST",
        token=AGENT_TOKEN,
        payload=result,
        timeout=TIMEOUT,
    )


def sync_live_sessions()->None:
    status,data=request_json(
        LOCAL_GATEWAY+"/api/radius/live-sessions",
        token=LOCAL_GATEWAY_TOKEN,
        timeout=TIMEOUT,
    )
    if status!=200 or not isinstance(data,dict) or not isinstance(data.get("items"),list):
        return
    request_json(
        CENTRAL+"/api/radius-agent/sessions/sync",
        method="POST",
        token=AGENT_TOKEN,
        payload={"items":data["items"]},
        timeout=TIMEOUT,
    )


def main()->None:
    print("UCHIHA RADIUS site agent started; outbound-only central connection")
    next_sync=0.0
    while True:
        try:
            now=time.monotonic()
            if now>=next_sync:
                sync_live_sessions()
                next_sync=now+SESSION_SYNC_SECONDS
            status,data=request_json(
                CENTRAL+"/api/radius-agent/poll",
                token=AGENT_TOKEN,
                timeout=TIMEOUT,
            )
            if status==401:
                print("site agent token rejected; waiting before retry")
                time.sleep(10)
                continue
            if status!=200:
                time.sleep(POLL_SECONDS)
                continue
            command=data.get("command") if isinstance(data,dict) else None
            if not isinstance(command,dict):
                time.sleep(POLL_SECONDS)
                continue
            command_id=str(command.get("id") or "")
            operation=str(command.get("operation") or "")
            payload=command.get("payload") if isinstance(command.get("payload"),dict) else {}
            result=local_execute(operation,payload)
            if command_id:
                complete(command_id,result)
        except (urllib.error.URLError,TimeoutError,json.JSONDecodeError):
            time.sleep(max(1.0,POLL_SECONDS))
        except Exception as exc:
            print("site agent retry",type(exc).__name__)
            time.sleep(max(1.0,POLL_SECONDS))


if __name__=="__main__":
    main()
