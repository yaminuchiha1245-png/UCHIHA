from __future__ import annotations

import hashlib
import hmac
import json
import os
import sqlite3
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from mikrotik_probe import probe
from provider_store import Access, ProviderStore
from site_routing import encode_route, sanitize_routes
from telegram_auth import TelegramAuthError, verify_init_data
from v37_gateway import V37Gateway, V37GatewayError

COOKIE = "uchiha_radius_provider_session"


def env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


class App:
    def __init__(self):
        self.bot_token = os.environ["TELEGRAM_BOT_TOKEN"]
        self.store = ProviderStore(os.getenv("UCHIHA_RADIUS_PROVIDER_DB", "/var/lib/uchiha-radius/provider.sqlite3"))
        owner = env_int("UCHIHA_RADIUS_OWNER_TELEGRAM_ID", 0)
        if owner:
            self.store.bootstrap_owner(
                owner,
                provider_name=os.getenv("UCHIHA_RADIUS_DEFAULT_PROVIDER_NAME", "UCHIHA Provider"),
                provider_code=os.getenv("UCHIHA_RADIUS_DEFAULT_PROVIDER_CODE", "UCHIHA"),
            )
        self.max_age = env_int("UCHIHA_RADIUS_TELEGRAM_AUTH_MAX_AGE", 900)
        self.ttl = env_int("UCHIHA_RADIUS_SESSION_TTL", 28800)
        self.origin = os.getenv("UCHIHA_RADIUS_PUBLIC_ORIGIN", "https://radius.uchiha-builder.com").rstrip("/")
        self.public_host = urlparse(self.origin).netloc or "radius.uchiha-builder.com"
        self.csrf_secret = os.getenv("UCHIHA_RADIUS_PROVIDER_CSRF_SECRET") or self.bot_token

        base_url = os.getenv("UCHIHA_RADIUS_V37_BASE_URL", "http://127.0.0.1:8790")
        key_id = os.getenv("UCHIHA_RADIUS_V37_HMAC_KEY_ID", "primary")
        secret_file = os.getenv("UCHIHA_RADIUS_V37_HMAC_SECRET_FILE", "")
        secret = os.getenv("UCHIHA_RADIUS_V37_HMAC_SECRET", "")
        self.gateway: V37Gateway | None = None
        if secret_file:
            self.gateway = V37Gateway.from_secret_file(
                base_url,
                key_id=key_id,
                secret_file=secret_file,
                public_host=self.public_host,
            )
        elif secret:
            self.gateway = V37Gateway(
                base_url,
                key_id=key_id,
                secret=secret,
                public_host=self.public_host,
            )

    def csrf(self, raw_session: str) -> str:
        return hmac.new(
            self.csrf_secret.encode("utf-8"),
            raw_session.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()


APP: App | None = None


class Handler(BaseHTTPRequestHandler):
    server_version = "UCHIHA-RADIUS-Provider/0.2"

    @property
    def app(self) -> App:
        assert APP is not None
        return APP

    def log_message(self, fmt: str, *args) -> None:
        print(f"provider-api {self.address_string()} {fmt % args}")

    def json(self, status: int, payload: object, *, session: str | None = None, clear: bool = False) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if session is not None:
            self.send_header(
                "Set-Cookie",
                f"{COOKIE}={session}; Path=/; Max-Age={self.app.ttl}; HttpOnly; Secure; SameSite=Strict",
            )
        if clear:
            self.send_header(
                "Set-Cookie",
                f"{COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
            )
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_gateway_response(self, response, *, sanitize: bool = True) -> None:
        body = response.body or b"{}"
        content_type = response.headers.get("content-type", "application/json; charset=utf-8")
        if sanitize and "json" in content_type.lower():
            try:
                value = json.loads(body.decode("utf-8"))
                body = json.dumps(sanitize_routes(value), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            except Exception:
                pass
        self.send_response(response.status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("invalid content length") from exc
        if size < 0 or size > 131072:
            raise ValueError("request too large")
        if not size:
            return {}
        try:
            value = json.loads(self.rfile.read(size).decode())
        except Exception as exc:
            raise ValueError("invalid json") from exc
        if not isinstance(value, dict):
            raise ValueError("json object required")
        return value

    def raw_session(self) -> str:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return ""
        morsel = cookie.get(COOKIE)
        return morsel.value if morsel else ""

    def bearer_token(self) -> str:
        value = self.headers.get("Authorization", "")
        return value[7:] if value.startswith("Bearer ") else ""

    def access(self) -> Access | None:
        return self.app.store.resolve_session(self.raw_session())

    def require(self) -> Access | None:
        access = self.access()
        if not access:
            self.json(401, {"error": {"code": "telegram_session_required"}})
        return access

    def origin_ok(self) -> bool:
        origin = self.headers.get("Origin")
        return not origin or origin.rstrip("/") == self.app.origin

    def csrf_ok(self) -> bool:
        raw = self.raw_session()
        supplied = self.headers.get("X-Uchiha-CSRF", "")
        return bool(raw and supplied and hmac.compare_digest(supplied, self.app.csrf(raw)))

    def require_connector_write(self) -> Access | None:
        if not self.origin_ok():
            self.json(403, {"error": {"code": "origin_rejected"}})
            return None
        access = self.require()
        if not access:
            return None
        if access.role not in ("owner", "admin", "operator"):
            self.json(403, {"error": {"code": "read_only_role"}})
            return None
        if not self.csrf_ok():
            self.json(403, {"error": {"code": "csrf_invalid"}})
            return None
        return access

    def gateway_actor(self, access: Access) -> str:
        return f"telegram:{access.telegram_user_id}:{access.provider_id}"

    @staticmethod
    def gateway_role(access: Access) -> str:
        return {
            "owner": "owner",
            "admin": "operator",
            "operator": "operator",
            "viewer": "auditor",
        }.get(access.role, "auditor")

    @staticmethod
    def normalize_path(path: str) -> str:
        prefix = "/telegram-api/"
        if path.startswith(prefix):
            return "/api/" + path[len(prefix):]
        return path

    @staticmethod
    def connector_read_allowed(path: str) -> bool:
        safe_exact = {
            "/api/connectors/radius/health",
            "/api/connectors/radius/health/live",
            "/api/connectors/radius/health/ready",
            "/api/connectors/radius/capabilities",
            "/api/connectors/radius/production-readiness",
            "/api/connectors/radius/release-readiness",
            "/api/connectors/radius/connectivity-check",
            "/api/connectors/radius/api-contract",
            "/api/connectors/radius/openapi.json",
        }
        return path in safe_exact

    @staticmethod
    def connector_write_kind(path: str) -> str | None:
        if path == "/api/connectors/radius":
            return "session"
        if path == "/api/connectors/radius/node-status":
            return "node-status"
        if path == "/api/connectors/radius/voucher-batches":
            return "voucher"
        if path.startswith("/api/connectors/radius/commands/") and path.endswith(("/cancel", "/retry")):
            return "owned-command"
        return None

    def proxy_v37(self, access: Access, method: str, target: str, payload: dict | None = None):
        if not self.app.gateway:
            self.json(
                503,
                {
                    "ok": False,
                    "error": {"code": "v37_gateway_not_configured"},
                    "providerRuntime": True,
                    "simulation": False,
                },
            )
            return None
        try:
            response = self.app.gateway.request(
                method,
                target,
                actor=self.gateway_actor(access),
                role=self.gateway_role(access),
                payload=payload,
            )
        except V37GatewayError:
            self.json(
                503,
                {
                    "ok": False,
                    "error": {"code": "v37_gateway_unreachable"},
                    "providerRuntime": True,
                    "simulation": False,
                },
            )
            return None
        return response

    @staticmethod
    def connector_command_id(path: str) -> str | None:
        prefix = "/api/connectors/radius/commands/"
        if not path.startswith(prefix):
            return None
        rest = path[len(prefix):].split("/", 1)[0]
        return rest or None

    def do_GET(self):
        parsed = urlparse(self.path)
        path = self.normalize_path(parsed.path)
        target = path + (f"?{parsed.query}" if parsed.query else "")
        if path == "/healthz":
            self.json(
                200,
                {
                    "ok": True,
                    "service": "radius-provider-api",
                    "routerMutation": False,
                    "v37GatewayConfigured": self.app.gateway is not None,
                },
            )
            return

        if path == "/api/radius-agent/poll":
            agent = self.app.store.resolve_site_agent(self.bearer_token())
            if not agent:
                self.json(401, {"error": {"code": "site_agent_unauthorized"}})
                return
            self.app.store.touch_site_agent(agent)
            item = self.app.store.poll_site_agent(agent)
            self.json(200, {"ok": True, "command": item})
            return

        access = self.require()
        if not access:
            return

        if path == "/api/connectors/radius/auth-context":
            self.json(
                200,
                {
                    "ok": True,
                    "authenticated": True,
                    "mode": "telegram-provider",
                    "actor": self.gateway_actor(access),
                    "role": access.role,
                    "provider": self.app.store.provider(access),
                    "csrfToken": self.app.csrf(self.raw_session()),
                },
            )
            return

        if path.startswith("/api/connectors/radius/"):
            command_id = self.connector_command_id(path)
            if command_id:
                if not self.app.store.command_owned(access, command_id):
                    self.json(404, {"error": {"code": "command_not_found"}})
                    return
            elif not self.connector_read_allowed(path):
                self.json(403, {
                    "error": {"code": "provider_connector_route_restricted"},
                    "providerRuntime": True,
                    "simulation": False,
                })
                return
            response = self.proxy_v37(access, "GET", target)
            if response is not None:
                self.send_gateway_response(response)
            return

        if path == "/api/radius-provider/me":
            self.json(
                200,
                {
                    "provider": self.app.store.provider(access),
                    "telegramUserId": access.telegram_user_id,
                    "role": access.role,
                    "displayName": access.display_name,
                },
            )
        elif path in ("/api/radius-provider/dashboard", "/api/operations"):
            self.json(200, self.app.store.dashboard(access))
        elif path == "/api/catalog":
            self.json(200, self.app.store.catalog(access))
        elif path == "/api/workflows":
            self.json(200, {"actions": self.app.store.workflow_actions(access)})
        elif path == "/api/radius-provider/plans":
            self.json(200, {"items": self.app.store.list_plans(access)})
        elif path == "/api/radius-provider/subscribers":
            self.json(200, {"items": self.app.store.list_subscribers(access)})
        elif path == "/api/radius-provider/routers":
            self.json(200, {"items": self.app.store.list_routers(access)})
        elif path.startswith("/api/radius-provider/routers/") and path.endswith("/agent-status"):
            router_id = path.split("/")[4]
            self.json(200, self.app.store.site_agent_status(access, router_id))
        elif path == "/api/radius-provider/sessions":
            self.json(200, {"items": self.app.store.list_sessions(access)})
        elif path == "/api/radius-provider/invoices":
            self.json(200, {"items": self.app.store.list_invoices(access)})
        else:
            self.json(404, {"error": {"code": "not_found"}})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = self.normalize_path(parsed.path)
        target = path + (f"?{parsed.query}" if parsed.query else "")

        if path.startswith("/api/radius-agent/commands/") and path.endswith("/result"):
            agent = self.app.store.resolve_site_agent(self.bearer_token())
            if not agent:
                self.json(401, {"error": {"code": "site_agent_unauthorized"}})
                return
            try:
                data = self.read_json()
            except ValueError as exc:
                self.json(400, {"error": {"code": "invalid_request", "message": str(exc)}})
                return
            command_id = path.split("/")[4]
            if not self.app.store.finish_site_agent_command(agent, command_id, data):
                self.json(404, {"error": {"code": "site_agent_command_not_found"}})
                return
            self.app.store.touch_site_agent(agent)
            self.json(200, {"ok": True})
            return

        if path == "/api/radius-provider/auth/telegram":
            try:
                identity = verify_init_data(
                    str(self.read_json().get("initData") or ""),
                    self.app.bot_token,
                    max_age_seconds=self.app.max_age,
                )
            except (ValueError, TelegramAuthError):
                self.json(401, {"error": {"code": "telegram_auth_invalid"}})
                return
            access = self.app.store.resolve_telegram(identity.user_id, display_name=identity.display_name)
            if not access:
                self.json(403, {"error": {"code": "provider_access_not_assigned"}})
                return
            token = self.app.store.issue_session(access, self.app.ttl)
            self.json(
                200,
                {
                    "ok": True,
                    "provider": self.app.store.provider(access),
                    "role": access.role,
                    "displayName": identity.display_name,
                },
                session=token,
            )
            return

        if path == "/api/radius-provider/logout":
            self.app.store.revoke_session(self.raw_session())
            self.json(200, {"ok": True}, clear=True)
            return

        if path.startswith("/api/radius-provider/routers/") and path.endswith("/agent-token"):
            if not self.origin_ok():
                self.json(403, {"error": {"code": "origin_rejected"}})
                return
            access = self.require()
            if not access:
                return
            if not self.csrf_ok():
                self.json(403, {"error": {"code": "csrf_invalid"}})
                return
            router_id = path.split("/")[4]
            try:
                issued = self.app.store.issue_site_agent(access, router_id)
                self.json(201, {
                    "ok": True,
                    "routerId": issued["routerId"],
                    "routerName": issued["routerName"],
                    "agentToken": issued["token"],
                    "tokenShownOnce": True,
                })
            except PermissionError:
                self.json(403, {"error": {"code": "owner_or_admin_required"}})
            except KeyError:
                self.json(404, {"error": {"code": "router_not_found"}})
            return

        if path.startswith("/api/connectors/radius"):
            access = self.require_connector_write()
            if not access:
                return
            write_kind = self.connector_write_kind(path)
            if write_kind is None:
                self.json(403, {
                    "error": {"code": "provider_connector_route_restricted"},
                    "providerRuntime": True,
                    "simulation": False,
                })
                return
            try:
                data = self.read_json()
            except ValueError as exc:
                self.json(400, {"error": {"code": "invalid_request", "message": str(exc)}})
                return

            if path == "/api/connectors/radius":
                if not self.app.store.command_target_allowed(access, data):
                    self.json(403, {"error": {"code": "provider_target_rejected"}})
                    return
                session = data.get("session") if isinstance(data.get("session"), dict) else {}
                route = self.app.store.router_route(
                    access,
                    str(session.get("nas") or ""),
                    str(session.get("id") or ""),
                )
                if not route:
                    self.json(409, {"error": {"code": "provider_router_not_mapped"}})
                    return
                router_id, router_code = route
                session = dict(session)
                session["nas"] = encode_route(access.provider_id, router_id, str(session.get("nas") or router_code))
                data["session"] = session
            elif path == "/api/connectors/radius/node-status":
                node = data.get("node") if isinstance(data.get("node"), dict) else {}
                code = str(node.get("code") or "")
                if not self.app.store.node_target_allowed(access, code):
                    self.json(403, {"error": {"code": "provider_node_rejected"}})
                    return
                route = self.app.store.router_route(access, code)
                if not route:
                    self.json(409, {"error": {"code": "provider_router_not_mapped"}})
                    return
                router_id, router_code = route
                node = dict(node)
                node["code"] = encode_route(access.provider_id, router_id, code or router_code)
                data["node"] = node
            elif path == "/api/connectors/radius/voucher-batches":
                batch = data.get("batch") if isinstance(data.get("batch"), dict) else {}
                plan_value = str(data.get("planId") or batch.get("plan") or "").strip()
                if not self.app.store.plan_owned(access, plan_value):
                    self.json(403, {"error": {"code": "provider_plan_rejected"}})
                    return
                data["providerId"] = access.provider_id
                data["scope"] = access.provider_id
            else:
                command_id = self.connector_command_id(path)
                if not command_id or not self.app.store.command_owned(access, command_id):
                    self.json(404, {"error": {"code": "command_not_found"}})
                    return

            response = self.proxy_v37(access, "POST", target, data)
            if response is None:
                return
            if 200 <= response.status < 300:
                try:
                    body = response.json()
                except Exception:
                    body = {}
                command_id = str(body.get("commandId") or "")
                if command_id:
                    self.app.store.remember_command(access, command_id, str(data.get("operation") or path.rsplit("/", 1)[-1]))
            self.send_gateway_response(response)
            return

        if not self.origin_ok():
            self.json(403, {"error": {"code": "origin_rejected"}})
            return
        access = self.require()
        if not access:
            return
        try:
            data = self.read_json()
            if path == "/api/radius-provider/plans":
                self.json(201, self.app.store.create_plan(access, data))
                return
            if path == "/api/radius-provider/subscribers":
                self.json(201, self.app.store.create_subscriber(access, data))
                return
            if path == "/api/radius-provider/routers":
                self.json(201, self.app.store.create_router(access, data))
                return
            if path.startswith("/api/radius-provider/routers/") and path.endswith("/probe"):
                router_id = path.split("/")[4]
                router = self.app.store.get_router(access, router_id)
                if not router:
                    self.json(404, {"error": {"code": "router_not_found"}})
                    return
                result = probe(router["management_ip"])
                updated = self.app.store.mark_router_probe(
                    access,
                    router_id,
                    reachable=bool(result["reachable"]),
                    detail=result,
                )
                self.json(200, {"router": updated, "probe": result})
                return
            if path == "/api/workflows":
                self.compat_workflow(access, data)
                return
            self.json(404, {"error": {"code": "not_found"}})
        except PermissionError:
            self.json(403, {"error": {"code": "read_only_role"}})
        except sqlite3.IntegrityError:
            self.json(409, {"error": {"code": "already_exists"}})
        except RuntimeError as exc:
            self.json(409, {"error": {"code": "conflict", "message": str(exc)}})
        except KeyError:
            self.json(404, {"error": {"code": "record_not_found"}})
        except ValueError as exc:
            self.json(400, {"error": {"code": "invalid_request", "message": str(exc)}})
        except Exception as exc:
            print(f"provider-api internal-error {type(exc).__name__}: {exc}")
            self.json(500, {"error": {"code": "internal_error"}})

    def compat_workflow(self, access: Access, data: dict) -> None:
        action = str(data.get("actionType") or "")
        values = [str(x).strip() for x in (data.get("values") or [])]
        if action == "subscriber" and len(values) >= 3:
            record = self.app.store.create_subscriber(
                access,
                {"full_name": values[0], "username": values[1], "plan": values[2]},
            )
            self.json(201, {"action": {"status": "completed", "actionType": action}, "record": record})
            return
        if action == "node" and len(values) >= 4:
            record = self.app.store.create_router(
                access,
                {"code": values[0], "name": values[0], "management_ip": values[2], "region": values[3]},
            )
            self.json(201, {"action": {"status": "completed", "actionType": action}, "record": record})
            return
        if action == "session":
            self.json(
                409,
                {
                    "error": {
                        "code": "use_v37_connector",
                        "message": "Session control must go through /api/connectors/radius with provider ownership checks.",
                    }
                },
            )
            return
        self.json(501, {"error": {"code": "workflow_not_implemented", "actionType": action}})

    def do_PATCH(self):
        path = self.normalize_path(urlparse(self.path).path)
        if path != "/api/catalog":
            self.json(404, {"error": {"code": "not_found"}})
            return
        if not self.origin_ok():
            self.json(403, {"error": {"code": "origin_rejected"}})
            return
        access = self.require()
        if not access:
            return
        try:
            data = self.read_json()
            record = self.app.store.update_status(
                access,
                str(data.get("kind") or ""),
                str(data.get("id") or ""),
                str(data.get("status") or ""),
                str(data.get("expectedStatus") or "") or None,
            )
            self.json(200, {"record": record, "action": {"status": "completed"}})
        except PermissionError:
            self.json(403, {"error": {"code": "read_only_role"}})
        except KeyError:
            self.json(404, {"error": {"code": "record_not_found"}})
        except RuntimeError:
            self.json(409, {"error": {"code": "status_changed"}})
        except ValueError as exc:
            self.json(400, {"error": {"code": "invalid_request", "message": str(exc)}})


def main():
    global APP
    APP = App()
    host = os.getenv("UCHIHA_RADIUS_PROVIDER_BIND", "127.0.0.1")
    port = env_int("UCHIHA_RADIUS_PROVIDER_PORT", 8788)
    print(
        f"UCHIHA RADIUS provider API listening on {host}:{port}; "
        f"v37-gateway={'ready' if APP.gateway else 'not-configured'}"
    )
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
