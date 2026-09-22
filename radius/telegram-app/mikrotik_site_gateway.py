from __future__ import annotations

import base64
import hmac
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


BIND = os.getenv("UCHIHA_SITE_GATEWAY_BIND","127.0.0.1")
PORT = int(os.getenv("UCHIHA_SITE_GATEWAY_PORT","8789"))
GATEWAY_TOKEN = os.environ["UCHIHA_SITE_GATEWAY_TOKEN"]
ROUTEROS_BASE = os.environ["UCHIHA_ROUTEROS_BASE_URL"].rstrip("/")
ROUTEROS_USER = os.environ["UCHIHA_ROUTEROS_USERNAME"]
ROUTEROS_PASSWORD = os.environ["UCHIHA_ROUTEROS_PASSWORD"]
ALLOW_INSECURE = os.getenv("UCHIHA_ROUTEROS_ALLOW_INSECURE","0").strip()=="1"
MAX_BODY = 131072


def _validate_base() -> None:
    parsed=urllib.parse.urlparse(ROUTEROS_BASE)
    if parsed.scheme!="https" and not ALLOW_INSECURE:
        raise RuntimeError("RouterOS REST must use HTTPS unless explicitly acknowledged")
    if parsed.scheme not in {"https","http"} or not parsed.hostname:
        raise RuntimeError("invalid RouterOS base URL")
_validate_base()


def _ssl_context():
    if urllib.parse.urlparse(ROUTEROS_BASE).scheme!="https":
        return None
    if ALLOW_INSECURE:
        return ssl._create_unverified_context()
    return ssl.create_default_context()


def _router_request(method: str,path: str,body: dict|None=None):
    url=f"{ROUTEROS_BASE}{path}"
    raw=None if body is None else json.dumps(body,separators=(",",":")).encode()
    auth=base64.b64encode(f"{ROUTEROS_USER}:{ROUTEROS_PASSWORD}".encode()).decode()
    req=urllib.request.Request(url,data=raw,method=method,headers={
        "Authorization":f"Basic {auth}",
        "Accept":"application/json",
        "Content-Type":"application/json",
        "User-Agent":"UCHIHA-RADIUS-SiteGateway/1.0"
    })
    try:
        with urllib.request.urlopen(req,timeout=5,context=_ssl_context()) as resp:
            data=resp.read(MAX_BODY)
            return int(resp.status), json.loads(data.decode() or "null")
    except urllib.error.HTTPError as exc:
        data=exc.read(MAX_BODY)
        try: payload=json.loads(data.decode() or "{}")
        except Exception: payload={"message":"routeros-http-error"}
        return int(exc.code),payload


def _duration_seconds(value: str) -> int:
    text=str(value or "").strip().lower()
    if not text:
        return 0
    if ":" in text and re.fullmatch(r"(?:\d+d)?\d{1,3}:\d{1,2}:\d{1,2}",text):
        days=0
        if "d" in text:
            day_part,text=text.split("d",1)
            days=int(day_part or 0)
        h,m,s=(int(x) for x in text.split(":"))
        return days*86400+h*3600+m*60+s
    total=0
    for number,unit in re.findall(r"(\d+)([wdhms])",text):
        total += int(number)*{"w":604800,"d":86400,"h":3600,"m":60,"s":1}[unit]
    return total


def _int_field(item: dict,*names: str) -> int:
    for name in names:
        value=item.get(name)
        if value not in (None,""):
            try:
                return max(0,int(str(value).replace(" ","")))
            except ValueError:
                pass
    return 0


def _live_sessions() -> list[dict]:
    now=int(time.time())
    result=[]
    sources=[
        ("PPPoE","/rest/ppp/active"),
        ("Hotspot","/rest/ip/hotspot/active"),
    ]
    for kind,path in sources:
        status,items=_router_request("GET",path)
        if status>=300:
            continue
        if not isinstance(items,list):
            continue
        for item in items:
            if not isinstance(item,dict):
                continue
            username=str(item.get("user") or item.get("name") or "").strip()
            external_id=str(item.get(".id") or "").strip()
            if not username or not external_id:
                continue
            uptime=_duration_seconds(str(item.get("uptime") or ""))
            result.append({
                "externalId":f"{kind.lower()}:{external_id}",
                "username":username,
                "framedIp":str(item.get("address") or item.get("ip") or "")[:64],
                "accessKind":kind,
                "startedAt":max(0,now-uptime) if uptime else now,
                "inputOctets":_int_field(item,"bytes-in","rx-byte","rx-bytes"),
                "outputOctets":_int_field(item,"bytes-out","tx-byte","tx-bytes"),
            })
    return result


def _active_path(kind: str) -> str:
    k=(kind or "").lower()
    if "hotspot" in k: return "/rest/ip/hotspot/active"
    if "ppp" in k or "pppoe" in k: return "/rest/ppp/active"
    raise ValueError("unsupported access kind")


def _find_active(user: str,kind: str):
    path=_active_path(kind)
    status,data=_router_request("GET",path)
    if status>=300 or not isinstance(data,list):
        raise RuntimeError("could not query active sessions")
    for item in data:
        if str(item.get("user") or item.get("name") or "")==user:
            return path,item
    return path,None


def _session_command(payload: dict):
    operation=str(payload.get("operation") or "")
    session=payload.get("session") or {}
    user=str(session.get("user") or "").strip()
    kind=str(session.get("kind") or "").strip()
    if operation=="review":
        path,item=_find_active(user,kind)
        return {"ok":True,"status":"completed","effect":"reviewed","decision":"Not-Evaluated","sessionId":session.get("id"),"user":user,"active":bool(item),"routerPath":path}
    if operation not in {"disconnect","reauthenticate"}:
        raise ValueError("unsupported operation")
    path,item=_find_active(user,kind)
    if not item:
        return {"ok":True,"status":"completed","effect":"not-found","decision":"Not-Evaluated","sessionId":session.get("id"),"user":user}
    item_id=str(item.get(".id") or "")
    if not item_id:
        raise RuntimeError("RouterOS active row has no .id")
    status,result=_router_request("DELETE",f"{path}/{urllib.parse.quote(item_id,safe='')}")
    if status>=300:
        raise RuntimeError("RouterOS rejected session removal")
    return {
        "ok":True,"status":"completed",
        "effect":"disconnected" if operation=="disconnect" else "reauthenticated",
        "decision":"Operator-Disconnect" if operation=="disconnect" else "Operator-Reauthenticate",
        "reason":"RouterOS-REST",
        "sessionId":session.get("id"),"user":user,
        "realNetworkCommandSent":True
    }


def _node_status(payload: dict):
    status,resource=_router_request("GET","/rest/system/resource")
    if status>=300: raise RuntimeError("RouterOS resource query failed")
    status2,identity=_router_request("GET","/rest/system/identity")
    return {
        "ok":True,"status":"completed","effect":"node-read",
        "realNetworkCommandSent":False,
        "resource":resource if isinstance(resource,list) else [resource],
        "identity":identity if status2<300 else None
    }


class Handler(BaseHTTPRequestHandler):
    server_version="UCHIHA-MikroTik-SiteGateway/1.0"

    def log_message(self,fmt,*args):
        print("site-gateway",fmt%args)

    def _json(self,status,payload):
        raw=json.dumps(payload,ensure_ascii=False,separators=(",",":")).encode()
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length",str(len(raw)))
        self.end_headers(); self.wfile.write(raw)

    def _authorized(self):
        supplied=self.headers.get("Authorization","")
        expected=f"Bearer {GATEWAY_TOKEN}"
        return bool(supplied and hmac.compare_digest(supplied,expected))

    def _payload(self):
        size=int(self.headers.get("Content-Length","0") or 0)
        if size<0 or size>MAX_BODY: raise ValueError("invalid body size")
        data=self.rfile.read(size) if size else b"{}"
        obj=json.loads(data.decode())
        if not isinstance(obj,dict): raise ValueError("object required")
        return obj

    def do_HEAD(self):
        self.send_response(204); self.send_header("Cache-Control","no-store"); self.end_headers()

    def do_GET(self):
        if self.path=="/healthz":
            try:
                status,data=_router_request("GET","/rest/system/identity")
                self._json(200 if status<300 else 503,{"ok":status<300,"routerReachable":status<300,"identity":data if status<300 else None})
            except Exception:
                self._json(503,{"ok":False,"routerReachable":False})
            return
        if self.path=="/api/radius/live-sessions":
            if not self._authorized():
                self._json(401,{"error":"unauthorized"})
                return
            try:
                sessions=_live_sessions()
                self._json(200,{"ok":True,"items":sessions,"collectedAt":int(time.time())})
            except Exception as exc:
                print("site-gateway live sessions",type(exc).__name__,str(exc))
                self._json(503,{"ok":False,"error":"live-sessions-unavailable"})
            return
        self._json(404,{"error":"not-found"})

    def do_POST(self):
        if not self._authorized():
            self._json(401,{"error":"unauthorized"}); return
        try:
            payload=self._payload()
            if self.path=="/api/radius/session-command":
                self._json(200,_session_command(payload)); return
            if self.path=="/api/radius/node-status":
                self._json(200,_node_status(payload)); return
            self._json(404,{"error":"not-found"})
        except ValueError as exc:
            self._json(400,{"error":"invalid-request","message":str(exc)})
        except Exception as exc:
            print("site-gateway error",type(exc).__name__,str(exc))
            self._json(503,{"error":"gateway-operation-failed"})


if __name__=="__main__":
    print(f"UCHIHA MikroTik site gateway on {BIND}:{PORT}")
    ThreadingHTTPServer((BIND,PORT),Handler).serve_forever()
