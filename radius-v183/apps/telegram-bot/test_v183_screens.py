import unittest
from v183_screens import V183ScreenBot


class FakeApi:
    def __init__(self):
        self.calls = []

    def request(self, url, *args, **kwargs):
        self.calls.append(url)
        if url == "/dashboard":
            return {"metrics": {"subscribers": 0, "activeSubscribers": 0,
                "activeSessions": 0, "devices": 0, "onlineDevices": 0,
                "openInvoices": 0}, "subscription": {"status": "trialing"}}
        if url == "/devices":
            return {"items": []}
        if url == "/radius/nodes":
            return {"items": []}
        if url == "/radius/overview":
            return {"status": "not_configured", "devices": 0,
                "onlineDevices": 0, "activeSessions": 0, "last24Hours": {}}
        raise AssertionError("Unknown API route " + url)


def callback(key, chat_id=12345678, message_id=77):
    return {"callback_query": {
        "id": "callback123", "from": {"id": chat_id}, "data": key,
        "message": {"message_id": message_id, "chat": {"id": chat_id, "type": "private"}},
    }}


class Screens(unittest.TestCase):
    def setUp(self):
        self.api = FakeApi()
        self.calls = []
        self.bot = V183ScreenBot("test-token", 12345678,
            api=self.api, telegram=lambda method, payload: (
                self.calls.append((method, payload)) or {"ok": True}))

    def screen(self):
        return [p for method, p in self.calls if method in ("editMessageText", "sendMessage")][-1]

    def test_mikrotik_is_dedicated_screen_with_real_empty_counts(self):
        self.bot.handle(callback("router:home"))
        self.assertEqual(self.api.calls, ["/devices", "/radius/nodes"])
        view = self.screen()
        self.assertIn("الراوترات المسجلة: <b>0</b>", view["text"])
        buttons = str(view["reply_markup"])
        self.assertIn("router:new", buttons)
        self.assertIn("router:setup", buttons)
        self.assertNotIn("📦 الباقات", buttons)
        self.assertEqual(self.calls[-1][0], "editMessageText")

    def test_registration_replaces_keyboard_and_requires_confirmation(self):
        self.bot.handle(callback("router:new"))
        panel = self.screen()
        self.assertIn("تسجيل MikroTik", panel["text"])
        self.assertIn("إلغاء", str(panel["reply_markup"]))
        self.assertNotIn("📦 الباقات", str(panel["reply_markup"]))
        self.assertEqual(self.api.calls, [])
        text = {"message": {"chat": {"id": 12345678, "type": "private"},
            "from": {"id": 12345678}, "text": "Main | 192.168.88.1"}}
        self.bot.handle(text)
        nonce = next(iter(self.bot.confirms))
        self.assertIn("تأكيد", self.screen()["text"])
        # The duplicate-prevention lookup is read-only; no router is created
        # before the owner explicitly confirms the pending registration.
        self.assertEqual(self.api.calls, ["/devices"])
        self.bot.handle(callback("cancel"))
        self.assertEqual(self.bot.confirms, {})
        self.assertEqual(self.api.calls, ["/devices"])

    def test_actual_status_not_fake_connected(self):
        self.bot.handle(callback("router:status"))
        self.assertIn("/radius/overview", self.api.calls)
        text = self.screen()["text"]
        self.assertIn("not_configured", text)
        self.assertIn("لا يوجد Site Agent متصل بعد", text)
        self.assertIn("router:setup", str(self.screen()["reply_markup"]))

    def test_unauthorized_router_buttons_do_not_call_backend(self):
        self.bot.handle(callback("router:home", chat_id=12345679))
        self.assertEqual(self.api.calls, [])
        self.assertEqual([method for method, _ in self.calls], ["answerCallbackQuery"])

    def test_dashboard_only_has_full_keyboard(self):
        self.bot.handle(callback("home"))
        self.assertIn("📦 الباقات", str(self.screen()["reply_markup"]))
        self.assertIn("router:home", str(self.screen()["reply_markup"]))
        self.bot.handle(callback("router:setup"))
        self.assertNotIn("📦 الباقات", str(self.screen()["reply_markup"]))

    def test_platform_owner_registers_by_bot_and_opens_same_router_in_web(self):
        identifier = "dev_owner_demo_1234567890abcdef"
        class WritableApi(FakeApi):
            def __init__(inner):
                super().__init__()
                inner.devices = []
                inner.posts = 0
            def request(inner, url, payload=None, method="GET", **kwargs):
                inner.calls.append(url)
                if url == "/dashboard":
                    return {"metrics": {}, "subscription": {"status": "active"}}
                if url == "/devices":
                    if method == "POST":
                        inner.posts += 1
                        device = {"id": identifier, "name": payload["name"],
                                  "host": payload["host"], "api_port": payload["apiPort"],
                                  "connection_method": "agent", "status": "pending"}
                        inner.devices.append(device)
                        return device
                    return {"items": [dict(item) for item in inner.devices]}
                if url == "/devices/" + identifier + "/direct-preflight":
                    return {"tlsVerified": True}
                raise AssertionError("Unexpected endpoint: " + url)
        self.api = WritableApi()
        self.bot.api = self.api
        self.bot.handle(callback("home"))
        first = self.screen()["reply_markup"]["inline_keyboard"][0]
        self.assertEqual(first[0]["callback_data"], "router:new")
        self.bot.handle(callback("router:new"))
        self.bot.handle({"message": {"chat": {"id": 12345678, "type": "private"},
            "from": {"id": 12345678}, "text": "ISP Main | 10.24.8.7"}})
        nonce = next(iter(self.bot.confirms))
        self.bot.handle(callback("confirm:" + nonce))
        self.assertEqual(self.api.posts, 1)
        links = [button["web_app"]["url"]
                 for row in self.screen()["reply_markup"]["inline_keyboard"]
                 for button in row if "web_app" in button]
        self.assertTrue(any("deviceId=" + identifier in link for link in links))
        self.bot.handle(callback("router:detail:" + identifier))
        self.bot.handle(callback("router:preflight:" + identifier))
        self.assertIn("TLS والشهادة نجح", self.screen()["text"])
        site_links = [button["web_app"]["url"]
                      for row in self.screen()["reply_markup"]["inline_keyboard"]
                      for button in row if "web_app" in button]
        self.assertTrue(any("?open=site-agent&deviceId=" + identifier in link
                            for link in site_links))
        self.assertEqual(self.api.posts, 1)
        self.bot.handle(callback("router:new"))
        self.bot.handle({"message": {"chat": {"id": 12345678, "type": "private"},
            "from": {"id": 12345678}, "text": "Duplicate ISP | 10.24.8.7"}})
        self.assertEqual(self.api.posts, 1)
        self.assertIn("مسجل سابقًا", self.screen()["text"])
        self.assertFalse(self.bot.confirms)


if __name__ == "__main__":
    unittest.main()
