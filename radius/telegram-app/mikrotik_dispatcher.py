from __future__ import annotations

import hmac
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from provider_store import ProviderStore
from site_routing import decode_route

BIND=os.getenv("UCHIHA_DISPATCHER_BIND","127.0.0.1")
PORT=int(os.getenv("UCHIHA_DISPATCHER_PORT","8791"))
TOKEN=os.environ["UCHIHA_DISPATCHER_V37_TOKEN"]
STORE=ProviderStore(os.getenv("UCHIHA_RADIUS_PROVIDER_DB","/var/lib/uchiha-radius/provider.sqlite3"))
WAIT_SECONDS=max(1.0,min(float(os.getenv("UCHIHA_DISPATCHER_WAIT_SECONDS","10")),14.0))
MAX_BODY=131072


def bearer(header: str) -> str:
    if not header.startswith("Bearer "):
        return ""
    return header[7:]


def wait_result(provider_id: str, command_id: str) -> dict:
    deadline=time.monotonic()+WAIT_SECONDS
    while time.monotonic()<deadline:
        item=STORE.site_agent_command_result(provider_id,command_id)
        if item and item["status"] in {"completed","failed"}:
            result=item.get("result") or {}
            if isinstance(result,dict):
                return result
            return {"ok":False,"error":"invalid-agent-result"}
        time.sleep(0.12)
    return {"ok":False,"error":"site-agent-timeout","status":"timeout"}


class Handler(BaseHTTPRequestHandler):
    server_version="UCHIHA-RADIUS-MikroTik-Dispatcher/1.0"

    def log_message(self,fmt,*args):
        print("mikrotik-dispatcher",fmt%args)

    def send_json(self,status:int,payload:dict):
        raw=json.dumps(payload,ensure_ascii=False,separators=(",",":")).encode()
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length",str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def authorized(self)->bool:
        supplied=bearer(self.headers.get("Authorization",""))
        return bool(supplied and hmac.compare_digest(supplied,TOKEN))

    def payload(self)->dict:
        try:
            size=int(self.headers.get("Content-Length","0"))
        except ValueError as exc:
            raise ValueError("invalid content length") from exc
        if size<0 or size>MAX_BODY:
            raise ValueError("body too large")
        value=json.loads(self.rfile.read(size).decode() if size else "{}")
        if not isinstance(value,dict):
            raise ValueError("object required")
        return value

    def do_HEAD(self):
        self.send_response(204)
        self.send_header("Cache-Control","no-store")
        self.end_headers()

    def do_GET(self):
        if self.path=="/healthz":
            self.send_json(200,{"ok":True,"service":"mikrotik-dispatcher","simulation":False})
            return
        self.send_json(404,{"error":"not-found"})

    def do_POST(self):
        if not self.authorized():
            self.send_json(401,{"error":"unauthorized"})
            return
        try:
            data=self.payload()
            if self.path=="/api/radius/session-command":
                session=data.get("session") if isinstance(data.get("session"),dict) else {}
                route=decode_route(str(session.get("nas") or ""))
                if not route:
                    self.send_json(400,{"error":"provider-route-required"})
                    return
                provider_id,router_id,_=route
                command_id=STORE.queue_site_agent_command(provider_id,router_id,str(data.get("operation") or ""),data)
            elif self.path=="/api/radius/node-status":
                node=data.get("node") if isinstance(data.get("node"),dict) else {}
                route=decode_route(str(node.get("code") or ""))
                if not route:
                    self.send_json(400,{"error":"provider-route-required"})
                    return
                provider_id,router_id,_=route
                command_id=STORE.queue_site_agent_command(provider_id,router_id,"node-status",data)
            else:
                self.send_json(404,{"error":"not-found"})
                return

            result=wait_result(provider_id,command_id)
            if result.get("ok") is True:
                result.setdefault("status","completed")
                result.setdefault("dispatcherCommandId",command_id)
                self.send_json(200,result)
            elif result.get("status")=="timeout":
                self.send_json(503,{"error":"site-agent-timeout","dispatcherCommandId":command_id})
            else:
                self.send_json(502,{"error":"site-agent-failed","dispatcherCommandId":command_id})
        except RuntimeError as exc:
            self.send_json(503,{"error":"site-agent-not-ready","message":str(exc)})
        except ValueError as exc:
            self.send_json(400,{"error":"invalid-request","message":str(exc)})
        except Exception as exc:
            print("dispatcher error",type(exc).__name__,str(exc))
            self.send_json(500,{"error":"internal-error"})


if __name__=="__main__":
    print(f"UCHIHA MikroTik dispatcher listening on {BIND}:{PORT}")
    ThreadingHTTPServer((BIND,PORT),Handler).serve_forever()
