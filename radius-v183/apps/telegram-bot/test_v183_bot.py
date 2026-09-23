import importlib.util
import json
import unittest
import urllib.parse
from pathlib import Path

spec = importlib.util.spec_from_file_location("v183bot", Path(__file__).with_name("v183_bot.py"))
bot_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bot_module)


class FakeApi:
    def __init__(self):
        self.calls = []
        self.rows = []
        self.invoices = []

    def request(self, path, payload=None, method="GET", *, key=None):
        self.calls.append((path, payload, method, key))
        if path == "/dashboard":
            return {"metrics": {"subscribers": 0, "activeSubscribers": 0,
                "activeSessions": 0, "devices": 0, "onlineDevices": 0, "openInvoices": 0},
                "subscription": {"status": "trialing"}}
        if path.startswith("/subscribers/") and path.count("/") == 2 and method == "GET":
            return {"id": path.split("/")[-1], "username": "test-12", "fullName": "Test",
                "status": "active", "plan": {"name": "Home"}}
        if path.startswith("/subscribers?"):
            return {"items": self.rows, "pagination": {"total": len(self.rows)}}
        if path.startswith("/invoices?"):
            return {"items": self.invoices, "pagination": {"total": len(self.invoices)}}
        if path in ("/subscribers", "/plans", "/devices", "/sessions", "/invoices", "/audit"):
            if method == "POST":
                return {"status": "pending"}
            return {"items": self.rows, "pagination": {"total": len(self.rows)}}
        if method == "POST":
            return {"status": "pending"}
        raise AssertionError("Unexpected API route: " + path)


def owner_callback(data, callback_id="cb1"):
    return {"callback_query": {"id": callback_id, "from": {"id": 12345678},
        "message": {"chat": {"id": 12345678, "type": "private"}}, "data": data}}


def owner_text(value):
    return {"message": {"from": {"id": 12345678}, "chat": {
        "id": 12345678, "type": "private"}, "text": value}}


class BotTest(unittest.TestCase):
    def setUp(self):
        self.api = FakeApi()
        self.sent = []

        def telegram(method, payload):
            self.sent.append((method, payload))
            return {"ok": True, "result": {}}

        self.bot = bot_module.V183Bot("test-token", 12345678, api=self.api, telegram=telegram)

    def messages(self):
        return [v for k, v in self.sent if k == "sendMessage"]

    def test_owner_start_has_real_zero_metrics_and_v183_link(self):
        self.bot.handle(owner_text("/start"))
        messages = self.messages()
        self.assertEqual(len(messages), 1)
        self.assertIn("V1-83", messages[0]["text"])
        self.assertIn("0", messages[0]["text"])
        self.assertEqual(self.api.calls[0][0], "/dashboard")
        keyboard = json.dumps(messages[0]["reply_markup"], ensure_ascii=False)
        self.assertIn("https://radius.uchiha-builder.com/v183/", keyboard)
        self.assertNotIn("/telegram/", keyboard)

    def test_private_owner_only_and_no_group_leak(self):
        self.bot.handle({"message": {"from": {"id": 12345679},
            "chat": {"id": 12345679, "type": "private"}, "text": "/start"}})
        self.bot.handle({"message": {"from": {"id": 12345678},
            "chat": {"id": -10012, "type": "supergroup"}, "text": "/start"}})
        self.assertEqual(self.api.calls, [])
        self.assertEqual(self.messages(), [])

    def test_owner_can_list_and_search_tenant_scoped_records(self):
        self.api.rows = [{"id": "cus_aaaaaaaaaaaa", "fullName": "Ahmad",
            "username": "ahmad", "status": "active"}]
        self.bot.handle(owner_callback("list:subscribers:0"))
        self.assertIn("Ahmad", self.messages()[-1]["text"])
        self.assertEqual(self.api.calls[0][0], "/subscribers?limit=7&offset=0")
        self.bot.handle(owner_text("/find Ahmad"))
        self.assertTrue(self.api.calls[-1][0].startswith("/subscribers?q=Ahmad"))
        self.assertIn("sub:cus_aaaaaaaaaaaa", json.dumps(self.messages()[-1]))

    def test_draft_not_written_until_owner_confirmation(self):
        self.bot.handle(owner_callback("new:plan"))
        self.bot.handle(owner_text("Family | 25 | 5 | 12.50"))
        self.assertEqual(self.api.calls, [])
        nonce = next(iter(self.bot.confirms))
        self.bot.handle(owner_callback("confirm:" + nonce))
        self.assertEqual(len(self.api.calls), 1)
        path, payload, method, key = self.api.calls[0]
        self.assertEqual((path, method), ("/plans", "POST"))
        self.assertEqual(payload["priceMinor"], 1250)
        self.assertTrue(key)
        self.assertNotIn(nonce, self.bot.confirms)

    def test_invalid_payment_prevented_and_cancel_no_write(self):
        self.bot.handle(owner_callback("new:payment:inv_abc"))
        self.bot.handle(owner_text("-12"))
        self.assertEqual(self.api.calls, [])
        self.bot.handle(owner_text("/cancel"))
        self.assertFalse(self.bot.drafts)
        self.assertFalse(self.bot.confirms)

    def test_unconfirmed_subscriber_never_receives_fake_password(self):
        self.bot.handle(owner_callback("new:subscriber"))
        self.bot.handle(owner_text("New Customer | new-custom"))
        nonce = next(iter(self.bot.confirms))
        self.assertEqual(self.bot.confirms[nonce]["payload"], {
            "fullName": "New Customer", "username": "new-custom"})
        self.bot.handle(owner_callback("confirm:" + nonce))
        path, payload, method, key = self.api.calls[-1]
        self.assertEqual(path, "/subscribers")
        self.assertEqual(payload["username"], "new-custom")
        self.assertNotIn("radiusPassword", payload)
        self.assertIn("بانتظار", self.messages()[-1]["text"])

    def test_acknowledges_unauthorized_callback_without_private_data(self):
        unknown = owner_callback("home")
        unknown["callback_query"]["from"]["id"] = 44445555
        self.bot.handle(unknown)
        self.assertEqual(self.api.calls, [])
        self.assertEqual(len(self.messages()), 0)
        self.assertEqual([i[0] for i in self.sent], ["answerCallbackQuery"])

    def test_signup_payload_requires_signed_data(self):
        params = urllib.parse.parse_qs(bot_module.signed_init_data(
            "8120730186:1234567890_abcdefghijklmnopqrstuvwxyz", 12345678, 1790000000))
        self.assertEqual(set(params), {"auth_date", "query_id", "user", "hash"})
        self.assertEqual(json.loads(params["user"][0])["id"], 12345678)


if __name__ == "__main__":
    unittest.main()
