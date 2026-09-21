from __future__ import annotations

import json
import os
import sqlite3
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from mikrotik_probe import probe
from provider_store import Access, ProviderStore
from telegram_auth import TelegramAuthError, verify_init_data

COOKIE = "uchiha_radius_provider_session"


def env_int(name: str, default: int) -> int:
    try: return int(os.getenv(name, str(default)))
    except ValueError: return default


class App:
    def __init__(self):
        self.bot_token = os.environ["TELEGRAM_BOT_TOKEN"]
        self.store = ProviderStore(os.getenv("UCHIHA_RADIUS_PROVIDER_DB", "/var/lib/uchiha-radius/provider.sqlite3"))
        owner = env_int("UCHIHA_RADIUS_OWNER_TELEGRAM_ID", 0)
        if owner:
            self.store.bootstrap_owner(owner,
                provider_name=os.getenv("UCHIHA_RADIUS_DEFAULT_PROVIDER_NAME","UCHIHA Provider"),
                provider_code=os.getenv("UCHIHA_RADIUS_DEFAULT_PROVIDER_CODE","UCHIHA"))
        self.max_age = env_int("UCHIHA_RADIUS_TELEGRAM_AUTH_MAX_AGE",900)
        self.ttl = env_int("UCHIHA_RADIUS_SESSION_TTL",28800)
        self.origin = os.getenv("UCHIHA_RADIUS_PUBLIC_ORIGIN","https://radius.uchiha-builder.com").rstrip("/")


APP: App | None = None


class Handler(BaseHTTPRequestHandler):
    server_version = "UCHIHA-RADIUS-Provider/0.1"

    @property
    def app(self) -> App:
        assert APP is not None
        return APP

    def log_message(self, fmt: str, *args) -> None:
        print(f"provider-api {self.address_string()} {fmt % args}")

    def json(self, status: int, payload: object, *, session: str | None = None, clear: bool = False) -> None:
        body = json.dumps(payload,ensure_ascii=False,separators=(",",":")).encode()
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        if session is not None:
            self.send_header("Set-Cookie",f"{COOKIE}={session}; Path=/; Max-Age={self.app.ttl}; HttpOnly; Secure; SameSite=Strict")
        if clear:
            self.send_header("Set-Cookie",f"{COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict")
        self.send_header("Content-Length",str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def read_json(self) -> dict:
        try: size = int(self.headers.get("Content-Length","0"))
        except ValueError: raise ValueError("invalid content length")
        if size < 0 or size > 131072: raise ValueError("request too large")
        if not size: return {}
        try: value = json.loads(self.rfile.read(size).decode())
        except Exception as exc: raise ValueError("invalid json") from exc
        if not isinstance(value,dict): raise ValueError("json object required")
        return value

    def raw_session(self) -> str:
        cookie = SimpleCookie()
        try: cookie.load(self.headers.get("Cookie",""))
        except Exception: return ""
        morsel = cookie.get(COOKIE)
        return morsel.value if morsel else ""

    def access(self) -> Access | None:
        return self.app.store.resolve_session(self.raw_session())

    def require(self) -> Access | None:
        access = self.access()
        if not access: self.json(401,{"error":{"code":"telegram_session_required"}})
        return access

    def origin_ok(self) -> bool:
        origin = self.headers.get("Origin")
        return not origin or origin.rstrip("/") == self.app.origin

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/healthz":
            self.json(200,{"ok":True,"service":"radius-provider-api","routerMutation":False}); return
        access = self.require()
        if not access: return
        if path == "/api/radius-provider/me":
            self.json(200,{"provider":self.app.store.provider(access),"telegramUserId":access.telegram_user_id,"role":access.role,"displayName":access.display_name})
        elif path in ("/api/radius-provider/dashboard","/api/operations"):
            self.json(200,self.app.store.dashboard(access))
        elif path == "/api/catalog":
            self.json(200,self.app.store.catalog(access))
        elif path == "/api/workflows":
            self.json(200,{"actions":self.app.store.workflow_actions(access)})
        elif path == "/api/radius-provider/plans":
            self.json(200,{"items":self.app.store.list_plans(access)})
        elif path == "/api/radius-provider/subscribers":
            self.json(200,{"items":self.app.store.list_subscribers(access)})
        elif path == "/api/radius-provider/routers":
            self.json(200,{"items":self.app.store.list_routers(access)})
        elif path == "/api/radius-provider/sessions":
            self.json(200,{"items":self.app.store.list_sessions(access)})
        elif path == "/api/radius-provider/invoices":
            self.json(200,{"items":self.app.store.list_invoices(access)})
        else:
            self.json(404,{"error":{"code":"not_found"}})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/radius-provider/auth/telegram":
            try:
                identity = verify_init_data(str(self.read_json().get("initData") or ""),self.app.bot_token,max_age_seconds=self.app.max_age)
            except (ValueError,TelegramAuthError):
                self.json(401,{"error":{"code":"telegram_auth_invalid"}}); return
            access = self.app.store.resolve_telegram(identity.user_id,display_name=identity.display_name)
            if not access:
                self.json(403,{"error":{"code":"provider_access_not_assigned"}}); return
            token = self.app.store.issue_session(access,self.app.ttl)
            self.json(200,{"ok":True,"provider":self.app.store.provider(access),"role":access.role,"displayName":identity.display_name},session=token); return

        if path == "/api/radius-provider/logout":
            self.app.store.revoke_session(self.raw_session()); self.json(200,{"ok":True},clear=True); return
        if not self.origin_ok():
            self.json(403,{"error":{"code":"origin_rejected"}}); return
        access = self.require()
        if not access: return
        try:
            data = self.read_json()
            if path == "/api/radius-provider/plans":
                self.json(201,self.app.store.create_plan(access,data)); return
            if path == "/api/radius-provider/subscribers":
                self.json(201,self.app.store.create_subscriber(access,data)); return
            if path == "/api/radius-provider/routers":
                self.json(201,self.app.store.create_router(access,data)); return
            if path.startswith("/api/radius-provider/routers/") and path.endswith("/probe"):
                router_id = path.split("/")[4]
                router = self.app.store.get_router(access,router_id)
                if not router: self.json(404,{"error":{"code":"router_not_found"}}); return
                result = probe(router["management_ip"])
                updated = self.app.store.mark_router_probe(access,router_id,reachable=bool(result["reachable"]),detail=result)
                self.json(200,{"router":updated,"probe":result}); return
            if path == "/api/workflows":
                self.compat_workflow(access,data); return
            self.json(404,{"error":{"code":"not_found"}})
        except PermissionError:
            self.json(403,{"error":{"code":"read_only_role"}})
        except sqlite3.IntegrityError:
            self.json(409,{"error":{"code":"already_exists"}})
        except RuntimeError as exc:
            self.json(409,{"error":{"code":"conflict","message":str(exc)}})
        except KeyError:
            self.json(404,{"error":{"code":"record_not_found"}})
        except ValueError as exc:
            self.json(400,{"error":{"code":"invalid_request","message":str(exc)}})
        except Exception as exc:
            print(f"provider-api internal-error {type(exc).__name__}: {exc}")
            self.json(500,{"error":{"code":"internal_error"}})

    def compat_workflow(self, access: Access, data: dict) -> None:
        action = str(data.get("actionType") or "")
        values = [str(x).strip() for x in (data.get("values") or [])]
        if action == "subscriber" and len(values) >= 3:
            record = self.app.store.create_subscriber(access,{"full_name":values[0],"username":values[1],"plan":values[2]})
            self.json(201,{"action":{"status":"completed","actionType":action},"record":record}); return
        if action == "node" and len(values) >= 4:
            record = self.app.store.create_router(access,{"code":values[0],"name":values[0],"management_ip":values[2],"region":values[3]})
            self.json(201,{"action":{"status":"completed","actionType":action},"record":record}); return
        if action == "session":
            self.json(503,{"error":{"code":"provider_radius_control_not_mapped","message":"Real disconnect/reauth remains blocked until provider authorization is mapped to Backend v37."}}); return
        self.json(501,{"error":{"code":"workflow_not_implemented","actionType":action}})

    def do_PATCH(self):
        path = urlparse(self.path).path
        if path != "/api/catalog": self.json(404,{"error":{"code":"not_found"}}); return
        if not self.origin_ok(): self.json(403,{"error":{"code":"origin_rejected"}}); return
        access = self.require()
        if not access: return
        try:
            data = self.read_json()
            record = self.app.store.update_status(access,str(data.get("kind") or ""),str(data.get("id") or ""),
                                                  str(data.get("status") or ""),str(data.get("expectedStatus") or "") or None)
            self.json(200,{"record":record,"action":{"status":"completed"}})
        except PermissionError: self.json(403,{"error":{"code":"read_only_role"}})
        except KeyError: self.json(404,{"error":{"code":"record_not_found"}})
        except RuntimeError: self.json(409,{"error":{"code":"status_changed"}})
        except ValueError as exc: self.json(400,{"error":{"code":"invalid_request","message":str(exc)}})


def main():
    global APP
    APP = App()
    host = os.getenv("UCHIHA_RADIUS_PROVIDER_BIND","127.0.0.1")
    port = env_int("UCHIHA_RADIUS_PROVIDER_PORT",8788)
    print(f"UCHIHA RADIUS provider API listening on {host}:{port}")
    ThreadingHTTPServer((host,port),Handler).serve_forever()


if __name__ == "__main__":
    main()
