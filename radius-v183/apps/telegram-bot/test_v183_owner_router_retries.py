"""Offline regression coverage for the platform-owner MikroTik confirmation flow.

Only bot-level fake API responses are used; no Telegram credentials or routers.
"""
import time
import unittest

from v183_bot import ApiError, PUBLIC_WEBAPP
from v183_screens import V183ScreenBot


OWNER = 12345678
OTHER = 22345678
DEVICE_ID = "dev_abcdefabcdefabcdefabcdefabcdef12"
HOST = "10.23.45.67"
NONCE = "safe-owner-confirmation"
KEY = "2c662df0-fde6-46ba-a816-9ab783c78e29"


class OwnerRouterApi:
    def __init__(self):
        self.devices = []
        self.created_by_key = {}
        self.calls = []
        self.lose_first_response = False

    def request(self, path, payload=None, method="GET", *, key=None):
        self.calls.append((path, method, key))
        if path == "/devices" and method == "GET":
            return {"items": [dict(row) for row in self.devices]}
        if path == "/devices" and method == "POST":
            if key in self.created_by_key:
                return dict(self.created_by_key[key])
            item = {
                "id": DEVICE_ID, "name": payload["name"],
                "host": payload["host"], "site_id": None,
                "api_port": payload["apiPort"], "status": "pending",
            }
            self.devices.append(item)
            self.created_by_key[key] = item
            if self.lose_first_response:
                self.lose_first_response = False
                raise ApiError("server committed but response was lost")
            return dict(item)
        raise AssertionError("Unexpected owner API request: " + path)


class OwnerRouterRetryTests(unittest.TestCase):
    def setUp(self):
        self.api = OwnerRouterApi()
        self.sent = []

        def telegram(method, payload):
            self.sent.append((method, payload))
            return {"ok": True}

        self.bot = V183ScreenBot(
            "fake-bot-token", OWNER, api=self.api, telegram=telegram)
        self.bot.confirms[NONCE] = {
            "action": "device", "target": "",
            "payload": {
                "name": "Main MikroTik", "host": HOST,
                "apiPort": 8729, "connectionMethod": "agent",
            },
            "idempotency": KEY, "time": time.monotonic(),
        }

    def last_message(self):
        return [
            payload for method, payload in self.sent
            if method in ("sendMessage", "editMessageText")
        ][-1]

    def buttons(self):
        return [
            button
            for row in self.last_message()["reply_markup"]["inline_keyboard"]
            for button in row
        ]

    def test_successful_registration_opens_exact_device_and_its_agent(self):
        self.bot.confirm(OWNER, NONCE)
        self.assertNotIn(NONCE, self.bot.confirms)
        self.assertEqual(len(self.api.devices), 1)
        links = [button["web_app"]["url"] for button in self.buttons()
                 if "web_app" in button]
        self.assertIn(
            PUBLIC_WEBAPP + "?open=connect-mikrotik&deviceId=" + DEVICE_ID,
            links)
        self.assertIn(
            PUBLIC_WEBAPP + "?open=site-agent&deviceId=" + DEVICE_ID,
            links)
        self.assertNotIn(PUBLIC_WEBAPP + "?open=site-agent", links)
        self.assertEqual(self.api.devices[0]["status"], "pending")

    def test_dropped_response_replays_original_key_without_another_device(self):
        self.api.lose_first_response = True
        self.bot.confirm(OWNER, NONCE)
        self.assertEqual(len(self.api.devices), 1)
        self.assertTrue(self.bot.confirms[NONCE]["write_attempted"])
        self.assertIn("ربما حُفظ الجهاز", self.last_message()["text"])
        self.assertIn(
            "confirm:" + NONCE,
            [button.get("callback_data") for button in self.buttons()])
        self.bot.confirm(OWNER, NONCE)
        post_keys = [
            key for path, method, key in self.api.calls
            if path == "/devices" and method == "POST"
        ]
        self.assertEqual(post_keys, [KEY, KEY])
        self.assertEqual(len(self.api.devices), 1)
        self.assertNotIn(NONCE, self.bot.confirms)
        links = [button["web_app"]["url"] for button in self.buttons()
                 if "web_app" in button]
        self.assertIn(
            PUBLIC_WEBAPP + "?open=connect-mikrotik&deviceId=" + DEVICE_ID,
            links)
        self.assertIn(
            PUBLIC_WEBAPP + "?open=site-agent&deviceId=" + DEVICE_ID,
            links)

    def test_preexisting_router_is_reused_before_any_first_write(self):
        self.api.devices.append({
            "id": DEVICE_ID, "name": "Saved router", "host": HOST,
            "site_id": None, "api_port": 8728, "status": "pending",
        })
        self.bot.confirm(OWNER, NONCE)
        self.assertFalse(self.api.created_by_key)
        self.assertNotIn(NONCE, self.bot.confirms)
        self.assertIn("لم ننشئ جهازًا مكررًا", self.last_message()["text"])
        links = [button["web_app"]["url"] for button in self.buttons()
                 if "web_app" in button]
        self.assertIn(
            PUBLIC_WEBAPP + "?open=connect-mikrotik&deviceId=" + DEVICE_ID,
            links)
        self.assertIn(
            PUBLIC_WEBAPP + "?open=site-agent&deviceId=" + DEVICE_ID,
            links)

    def test_expired_confirmation_does_not_touch_backend(self):
        self.bot.confirms[NONCE]["time"] -= 601
        self.bot.confirm(OWNER, NONCE)
        self.assertEqual(self.api.calls, [])
        self.assertNotIn(NONCE, self.bot.confirms)
        self.assertIn("انتهت صلاحية", self.last_message()["text"])

    def test_another_telegram_account_cannot_use_owner_confirmation(self):
        update = {"callback_query": {
            "id": "forged_callback",
            "from": {"id": OTHER, "first_name": "Other"},
            "data": "confirm:" + NONCE,
            "message": {
                "message_id": 500,
                "chat": {"id": OTHER, "type": "private"},
            },
        }}
        self.bot.handle(update)
        self.assertIn(NONCE, self.bot.confirms)
        self.assertEqual(self.api.calls, [])
        self.assertFalse(self.api.created_by_key)


if __name__ == "__main__":
    unittest.main()
