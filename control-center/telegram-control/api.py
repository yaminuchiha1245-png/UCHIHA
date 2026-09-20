#!/usr/bin/env python3
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

sys.path.insert(0, "/opt/uchiha/telegram-control")
from common import dashboard, validate_init_data, put_secret, delete_secret

HOST = os.environ.get("TELEGRAM_CONTROL_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("TELEGRAM_CONTROL_API_PORT", "8790"))

class Handler(BaseHTTPRequestHandler):
    server_version = "UCHIHA-Telegram-Control/1.0"

    def log_message(self, fmt, *args):
        return

    def send_json(self, status, data):
        raw = json.dumps(data, ensure_ascii=False, separators=(",",":")).encode()
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(raw)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Referrer-Policy","no-referrer")
        self.end_headers()
        self.wfile.write(raw)

    def user(self):
        init_data = self.headers.get("X-Telegram-Init-Data","")
        return validate_init_data(init_data)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            return self.send_json(200, {"ok":True,"service":"uchiha-telegram-control-api"})
        user = self.user()
        if not user:
            return self.send_json(401, {"ok":False,"error":"unauthorized"})
        if path == "/api/dashboard":
            data = dashboard()
            data["user"] = {"id":user.get("id"),"username":user.get("username"),"first_name":user.get("first_name")}
            return self.send_json(200, data)
        return self.send_json(404, {"ok":False,"error":"not_found"})

    def do_POST(self):
        path = urlparse(self.path).path
        user = self.user()
        if not user:
            return self.send_json(401, {"ok":False,"error":"unauthorized"})
        try:
            length = int(self.headers.get("Content-Length","0"))
        except Exception:
            length = 0
        if length < 0 or length > 65536:
            return self.send_json(413, {"ok":False,"error":"body_too_large"})
        try:
            body = json.loads(self.rfile.read(length).decode() if length else "{}")
        except Exception:
            return self.send_json(400, {"ok":False,"error":"invalid_json"})
        if path == "/api/secrets/put":
            try:
                item = put_secret(body.get("projectId"), body.get("key"), body.get("value"))
                return self.send_json(200, {"ok":True,"item":item})
            except ValueError as e:
                return self.send_json(400, {"ok":False,"error":str(e)})
        if path == "/api/secrets/delete":
            try:
                removed = delete_secret(body.get("projectId"), body.get("key"))
                return self.send_json(200, {"ok":True,"removed":removed})
            except ValueError as e:
                return self.send_json(400, {"ok":False,"error":str(e)})
        return self.send_json(404, {"ok":False,"error":"not_found"})

if __name__ == "__main__":
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()