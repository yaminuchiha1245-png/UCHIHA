from __future__ import annotations

import hashlib
import hmac
import http.client
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import provider_api
from credential_vault import CredentialVault
from provider_api import Handler
from telegram_auth import verify_init_data


def signed_init_data(token: str, user_id: int, ts: int) -> str:
    values = {
        "auth_date": str(ts),
        "query_id": "AA-http-smoke",
        "user": json.dumps(
            {"id": user_id, "first_name": "Owner", "last_name": "Smoke"},
            separators=(",", ":"),
        ),
    }
    check = "\n".join(f"{key}={values[key]}" for key in sorted(values))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    values["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(values)


class ProviderHttpIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.token = "123456:TEST-TOKEN-FOR-CI"
        self.origin = "https://radius.uchiha-builder.com"
        self.key_file = Path(self.tmp.name) / "credential.key"
        self.key_file.write_bytes(CredentialVault.generate_key() + b"\n")
        self.key_file.chmod(0o600)
        env = {
            "TELEGRAM_BOT_TOKEN": self.token,
            "UCHIHA_RADIUS_OWNER_TELEGRAM_ID": "101",
            "UCHIHA_RADIUS_DEFAULT_PROVIDER_NAME": "Smoke ISP",
            "UCHIHA_RADIUS_DEFAULT_PROVIDER_CODE": "SMOKE",
            "UCHIHA_RADIUS_PROVIDER_DB": str(Path(self.tmp.name) / "provider.sqlite3"),
            "UCHIHA_RADIUS_PUBLIC_ORIGIN": self.origin,
            "UCHIHA_RADIUS_PROVIDER_CSRF_SECRET": "csrf-smoke-secret-abcdefghijklmnopqrstuvwxyz",
            "UCHIHA_RADIUS_CREDENTIAL_KEY_FILE": str(self.key_file),
            "UCHIHA_RADIUS_V37_HMAC_SECRET": "",
            "UCHIHA_RADIUS_V37_HMAC_SECRET_FILE": "",
        }
        self.env = patch.dict(os.environ, env, clear=False)
        self.env.start()
        self.previous_app = provider_api.APP
        provider_api.APP = provider_api.App()
        self.server = provider_api.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.host, self.port = self.server.server_address
        self.cookie = ""
        self.csrf = ""

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        provider_api.APP = self.previous_app
        self.env.stop()
        self.tmp.cleanup()

    def request(self, method: str, path: str, payload=None, *, auth=True, csrf=False):
        conn = http.client.HTTPConnection(self.host, self.port, timeout=5)
        headers = {"Accept": "application/json"}
        body = None
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":"))
            headers["Content-Type"] = "application/json"
        if auth and self.cookie:
            headers["Cookie"] = self.cookie
        if csrf:
            headers["Origin"] = self.origin
            headers["X-Uchiha-CSRF"] = self.csrf
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()
        raw = response.read()
        data = json.loads(raw.decode() or "{}")
        set_cookie = response.getheader("Set-Cookie")
        conn.close()
        return response.status, data, set_cookie

    def authenticate(self):
        now = int(time.time())
        init_data = signed_init_data(self.token, 101, now)
        self.assertEqual(verify_init_data(init_data, self.token, now=now).user_id, 101)
        status, data, set_cookie = self.request(
            "POST",
            "/telegram-api/radius-provider/auth/telegram",
            {"initData": init_data},
            auth=False,
        )
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        self.assertEqual(data["role"], "owner")
        self.assertTrue(data["csrfToken"])
        self.assertTrue(set_cookie)
        self.cookie = set_cookie.split(";", 1)[0]
        self.csrf = data["csrfToken"]

    def test_provider_http_runtime_end_to_end(self):
        self.authenticate()

        status, me, _ = self.request("GET", "/telegram-api/radius-provider/me")
        self.assertEqual(status, 200)
        self.assertEqual(me["provider"]["code"], "SMOKE")

        status, plan, _ = self.request(
            "POST",
            "/telegram-api/radius-provider/plans",
            {
                "name": "Home 50",
                "download_mbps": 50,
                "upload_mbps": 10,
                "quota_gb": 0,
                "duration_days": 30,
                "price": 20,
            },
            csrf=True,
        )
        self.assertEqual(status, 201)

        status, subscriber, _ = self.request(
            "POST",
            "/telegram-api/radius-provider/subscribers",
            {
                "full_name": "Alice Example",
                "username": "alice",
                "plan_id": plan["id"],
                "radius_password": "AliceRadius9",
            },
            csrf=True,
        )
        self.assertEqual(status, 201)
        self.assertEqual(subscriber["username"], "alice")
        self.assertEqual(subscriber["radiusPassword"], "AliceRadius9")
        self.assertTrue(subscriber["passwordShownOnce"])

        status, router, _ = self.request(
            "POST",
            "/telegram-api/radius-provider/routers",
            {
                "name": "MikroTik Lab",
                "code": "MT-LAB",
                "management_ip": "192.168.88.1",
                "region": "LAB",
            },
            csrf=True,
        )
        self.assertEqual(status, 201)

        status, issued, _ = self.request(
            "POST",
            f"/telegram-api/radius-provider/routers/{router['id']}/agent-token",
            {},
            csrf=True,
        )
        self.assertEqual(status, 201)
        agent_token = issued["agentToken"]
        self.assertTrue(agent_token.startswith("ura_"))

        conn = http.client.HTTPConnection(self.host, self.port, timeout=5)
        conn.request(
            "GET",
            "/api/radius-agent/config",
            headers={"Authorization": f"Bearer {agent_token}", "Accept": "application/json"},
        )
        response = conn.getresponse()
        agent_config = json.loads(response.read().decode())
        conn.close()
        self.assertEqual(response.status, 200)
        self.assertEqual(agent_config["router"]["id"], router["id"])
        self.assertEqual(len(agent_config["accounts"]), 1)
        self.assertEqual(agent_config["accounts"][0]["username"], "alice")
        self.assertEqual(agent_config["accounts"][0]["password"], "AliceRadius9")

        conn = http.client.HTTPConnection(self.host, self.port, timeout=5)
        body = json.dumps({
            "items": [{
                "externalId": "pppoe:*1",
                "username": "alice",
                "framedIp": "10.0.0.2",
                "accessKind": "PPPoE",
                "startedAt": int(time.time()) - 60,
                "inputOctets": 1000,
                "outputOctets": 2000,
            }]
        }, separators=(",", ":"))
        conn.request(
            "POST",
            "/api/radius-agent/sessions/sync",
            body=body,
            headers={
                "Authorization": f"Bearer {agent_token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        response = conn.getresponse()
        synced = json.loads(response.read().decode())
        conn.close()
        self.assertEqual(response.status, 200)
        self.assertEqual(synced["online"], 1)

        status, sessions, _ = self.request("GET", "/telegram-api/radius-provider/sessions")
        self.assertEqual(status, 200)
        self.assertEqual(len(sessions["items"]), 1)
        self.assertEqual(sessions["items"][0]["username"], "alice")
        self.assertEqual(sessions["items"][0]["status"], "online")

        status, dashboard, _ = self.request("GET", "/telegram-api/operations")
        self.assertEqual(status, 200)
        self.assertEqual(dashboard["totals"]["subscribers"], 1)
        self.assertEqual(dashboard["totals"]["nodes"], 1)
        self.assertEqual(dashboard["gateway"]["snapshot"]["activeSessions"], 1)

        status, rejected, _ = self.request(
            "POST",
            "/telegram-api/radius-provider/plans",
            {
                "name": "No CSRF",
                "download_mbps": 1,
                "upload_mbps": 1,
            },
            csrf=False,
        )
        self.assertEqual(status, 403)
        self.assertEqual(rejected["error"]["code"], "csrf_invalid")


if __name__ == "__main__":
    unittest.main()
