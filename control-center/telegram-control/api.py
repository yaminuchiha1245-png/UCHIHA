#!/usr/bin/env python3
import hashlib
import hmac
import json
import os
import pathlib
import re
import secrets
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

sys.path.insert(0, "/opt/uchiha/telegram-control")
from common import (
    BOT_STATE_DIR,
    BOT_TOKEN_PATH,
    CLAIM_HASH_PATH,
    dashboard,
    delete_secret,
    put_secret,
    validate_init_data,
    restart_container,
    restart_nginx,
    refresh_infrastructure,
    create_database_backup,
    delete_backup,
    safe_container_logs,
)
from project_manager import (
    upsert_project, update_billing, set_timer, mark_paid, renew_project, add_version,
    start_project, stop_project
)

HOST = os.environ.get("TELEGRAM_CONTROL_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("TELEGRAM_CONTROL_API_PORT", "8790"))
SETUP_HASH_PATH = BOT_STATE_DIR / "setup-token.sha256"

def validate_setup_token(value):
    value = str(value or "").strip()
    if not value:
        return False
    try:
        expected = SETUP_HASH_PATH.read_text(encoding="utf-8").strip().lower()
    except Exception:
        return False
    if not re.fullmatch(r"[a-f0-9]{64}", expected):
        return False
    actual = hashlib.sha256(value.encode()).hexdigest()
    return hmac.compare_digest(actual, expected)

def verify_bot_token(token):
    token = str(token or "").strip()
    if not re.fullmatch(r"[0-9]{6,15}:[A-Za-z0-9_-]{20,}", token):
        raise ValueError("invalid_bot_token")
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/getMe")
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            body = json.loads(res.read().decode())
    except Exception:
        raise ValueError("telegram_verification_failed")
    if not body.get("ok") or not isinstance(body.get("result"), dict):
        raise ValueError("telegram_verification_failed")
    return body["result"]

def activate_bot(token):
    if BOT_TOKEN_PATH.exists():
        raise ValueError("already_activated")
    info = verify_bot_token(token)
    BOT_STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = BOT_TOKEN_PATH.with_suffix(".tmp")
    tmp.write_text(str(token).strip(), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(BOT_TOKEN_PATH)
    os.chmod(BOT_TOKEN_PATH, 0o600)

    claim_code = secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:10]
    claim_hash = hashlib.sha256(claim_code.encode()).hexdigest()
    tmp_hash = CLAIM_HASH_PATH.with_suffix(".tmp")
    tmp_hash.write_text(claim_hash, encoding="utf-8")
    os.chmod(tmp_hash, 0o600)
    tmp_hash.replace(CLAIM_HASH_PATH)
    try:
        SETUP_HASH_PATH.unlink()
    except Exception:
        pass
    return {
        "id": info.get("id"),
        "username": info.get("username"),
        "first_name": info.get("first_name"),
        "claimCode": claim_code,
    }

class Handler(BaseHTTPRequestHandler):
    server_version = "UCHIHA-Telegram-Control/1.1"

    def log_message(self, fmt, *args):
        return

    def send_json(self, status, data):
        raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(raw)

    def setup_authorized(self):
        return validate_setup_token(self.headers.get("X-Uchiha-Setup-Token", ""))

    def user(self):
        return validate_init_data(self.headers.get("X-Telegram-Init-Data", ""))

    def read_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except Exception:
            length = 0
        if length < 0 or length > 65536:
            raise ValueError("body_too_large")
        try:
            return json.loads(self.rfile.read(length).decode() if length else "{}")
        except Exception:
            raise ValueError("invalid_json")

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            return self.send_json(200, {
                "ok": True,
                "service": "uchiha-telegram-control-api",
                "activated": BOT_TOKEN_PATH.exists()
            })
        if path == "/api/setup/status":
            if not self.setup_authorized():
                return self.send_json(401, {"ok": False, "error": "unauthorized"})
            return self.send_json(200, {
                "ok": True,
                "activated": BOT_TOKEN_PATH.exists(),
                "setupAvailable": SETUP_HASH_PATH.exists()
            })
        user = self.user()
        if not user:
            return self.send_json(401, {"ok": False, "error": "unauthorized"})
        if path == "/api/dashboard":
            data = dashboard()
            data["user"] = {
                "id": user.get("id"),
                "username": user.get("username"),
                "first_name": user.get("first_name")
            }
            return self.send_json(200, data)
        if path.startswith("/api/logs/"):
            name = path[len("/api/logs/"):]
            try:
                item = safe_container_logs(name, 160)
                return self.send_json(200, {"ok":True,"item":item})
            except ValueError as e:
                return self.send_json(400, {"ok":False,"error":str(e)})
            except Exception:
                return self.send_json(500, {"ok":False,"error":"logs_failed"})
        return self.send_json(404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/setup/activate":
            if not self.setup_authorized():
                return self.send_json(401, {"ok": False, "error": "unauthorized"})
            try:
                body = self.read_body()
                bot = activate_bot(body.get("botToken"))
                return self.send_json(201, {"ok": True, "bot": bot})
            except ValueError as e:
                code = str(e)
                status = 409 if code == "already_activated" else 400
                return self.send_json(status, {"ok": False, "error": code})

        user = self.user()
        if not user:
            return self.send_json(401, {"ok": False, "error": "unauthorized"})
        try:
            body = self.read_body()
        except ValueError as e:
            code = str(e)
            return self.send_json(413 if code == "body_too_large" else 400, {"ok": False, "error": code})

        if path == "/api/secrets/put":
            try:
                item = put_secret(body.get("projectId"), body.get("key"), body.get("value"))
                return self.send_json(200, {"ok": True, "item": item})
            except ValueError as e:
                return self.send_json(400, {"ok": False, "error": str(e)})
        if path == "/api/secrets/delete":
            try:
                removed = delete_secret(body.get("projectId"), body.get("key"))
                return self.send_json(200, {"ok": True, "removed": removed})
            except ValueError as e:
                return self.send_json(400, {"ok": False, "error": str(e)})

        if path == "/api/ops/refresh":
            try:
                item = refresh_infrastructure()
                return self.send_json(200, {"ok":True,"infra":item})
            except Exception:
                return self.send_json(500, {"ok":False,"error":"infra_refresh_failed"})

        if path == "/api/ops/restart-container":
            if body.get("confirm") != "RESTART":
                return self.send_json(400, {"ok":False,"error":"confirmation_required"})
            try:
                item = restart_container(body.get("name"))
                refresh_infrastructure()
                return self.send_json(200, {"ok":True,"item":item})
            except ValueError as e:
                return self.send_json(400, {"ok":False,"error":str(e)})
            except Exception:
                return self.send_json(500, {"ok":False,"error":"container_restart_failed"})

        if path == "/api/ops/reload-nginx":
            if body.get("confirm") != "RELOAD":
                return self.send_json(400, {"ok":False,"error":"confirmation_required"})
            try:
                item = restart_nginx()
                return self.send_json(200, {"ok":True,"item":item})
            except Exception:
                return self.send_json(500, {"ok":False,"error":"nginx_reload_failed"})

        if path == "/api/backups/create":
            if body.get("confirm") != "BACKUP":
                return self.send_json(400, {"ok":False,"error":"confirmation_required"})
            try:
                item = create_database_backup()
                return self.send_json(201, {"ok":True,"item":item})
            except ValueError as e:
                return self.send_json(400, {"ok":False,"error":str(e)})
            except Exception:
                return self.send_json(500, {"ok":False,"error":"database_backup_failed"})

        if path == "/api/backups/delete":
            if body.get("confirm") != "DELETE":
                return self.send_json(400, {"ok":False,"error":"confirmation_required"})
            try:
                removed = delete_backup(body.get("name"))
                return self.send_json(200, {"ok":True,"removed":removed})
            except ValueError as e:
                return self.send_json(400, {"ok":False,"error":str(e)})

        if path == "/api/projects/upsert":
            try:
                item = upsert_project(body)
                return self.send_json(200, {"ok":True,"item":item})
            except ValueError as e:
                return self.send_json(400, {"ok":False,"error":str(e)})

        project_action = re.fullmatch(r"/api/projects/([a-z0-9-]{2,64})/(start|stop|billing|timer|paid|renew|version)", path)
        if project_action:
            project_id, action = project_action.group(1), project_action.group(2)
            try:
                if action == "start":
                    if body.get("confirm") != "START":
                        return self.send_json(400, {"ok":False,"error":"confirmation_required"})
                    item = start_project(project_id)
                elif action == "stop":
                    if body.get("confirm") != "STOP":
                        return self.send_json(400, {"ok":False,"error":"confirmation_required"})
                    item = stop_project(project_id, "telegram")
                elif action == "billing":
                    item = update_billing(project_id, body)
                elif action == "timer":
                    item = set_timer(project_id, body.get("expiresAt"), body.get("autoStop", True))
                elif action == "paid":
                    item = mark_paid(project_id, body.get("at"))
                elif action == "renew":
                    item = renew_project(project_id, body.get("days", 30))
                else:
                    item = add_version(project_id, body.get("version"), body.get("notes"), body.get("kind"))
                return self.send_json(200, {"ok":True,"item":item})
            except ValueError as e:
                return self.send_json(400, {"ok":False,"error":str(e)})
            except RuntimeError as e:
                return self.send_json(500, {"ok":False,"error":str(e)})

        return self.send_json(404, {"ok": False, "error": "not_found"})

if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()