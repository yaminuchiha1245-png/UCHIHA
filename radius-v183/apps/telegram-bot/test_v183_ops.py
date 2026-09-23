import unittest
from v183_screens import V183ScreenBot

TICKET = "tkt_123456789abc"
ALERT = "alt_123456789abc"

class FakeApi:
    def __init__(self):
        self.calls = []

    def request(self, url, payload=None, method="GET", *, key=None):
        self.calls.append((url, payload, method, key))
        if method != "GET":
            return {"status": "saved"}
        if url == "/support/tickets?limit=7&offset=0":
            return {"items": [{"id": TICKET, "number": "SUP-100",
                     "title": "<unsafe> problem", "priority": "high",
                     "status": "open"}],
                    "pagination": {"limit": 7, "offset": 0, "total": 1}}
        if url == "/support/tickets/" + TICKET:
            return {"id": TICKET, "number": "SUP-100", "title": "Connection",
                    "status": "open", "priority": "high",
                    "description": "<script>bad</script>", "events": [
                        {"eventType": "created", "body": "First request"}]}
        if url == "/alerts?limit=7&offset=0":
            return {"items": [{"id": ALERT, "title": "<unsafe> alarm",
                               "severity": "warning", "status": "open"}]}
        if url == "/voucher-batches?limit=7&offset=0":
            return {"items": [{"id": "vbt_aabbccddee00", "code": "B-123",
                               "planName": "Starter", "quantity": 10, "available": 8}],
                    "pagination": {"total": 1}}
        if url == "/resellers":
            return {"items": [{"id": "rsl_aabbccddee", "name": "Reseller",
                               "status": "active", "voucherBatches": 1}]}
        if url in ("/team", "/sites", "/integrations"):
            return {"items": []}
        if url == "/reports/summary":
            return {"subscribers": {"total": 5, "active": 4},
                    "sessions": {"total": 7},
                    "traffic": {"inputBytes": 300000000, "outputBytes": 700000000},
                    "billing": {"invoices": 3}, "support": {"open": 2},
                    "authentication": {"accepted": 9, "rejected": 1}}
        raise AssertionError("Unknown route " + url)

class OpsScreens(unittest.TestCase):
    def setUp(self):
        self.api, self.sent = FakeApi(), []
        self.bot = V183ScreenBot("test-token", 12345678, api=self.api,
                telegram=lambda method, payload: self.sent.append((method, payload)) or {"ok": True})

    def cb(self, data, owner=12345678):
        return {"callback_query": {"id": "callback", "data": data,
            "from": {"id": owner},
            "message": {"message_id": 123,
                        "chat": {"id": owner, "type": "private"}}}}

    def msg(self, content):
        return {"message": {"text": content, "from": {"id": 12345678},
            "chat": {"id": 12345678, "type": "private"}}}

    def last(self):
        return [p for m, p in self.sent if m in ("editMessageText", "sendMessage")][-1]

    def writes(self):
        return [call for call in self.api.calls if call[2] != "GET"]

    def test_extra_menu_has_all_real_management_routes(self):
        self.bot.handle(self.cb("ops:menu"))
        markup = str(self.last()["reply_markup"])
        for category in ("resellers", "vouchers", "team", "sites", "integrations"):
            self.assertIn("ops:list:" + category + ":0", markup)
        self.assertNotIn("📦 الباقات", markup)

    def test_support_listing_escapes_titles_and_detail(self):
        self.bot.handle(self.cb("ops:list:tickets:0"))
        self.assertIn("&lt;unsafe&gt;", self.last()["text"])
        self.assertIn("ops:ticket:" + TICKET, str(self.last()["reply_markup"]))
        self.bot.handle(self.cb("ops:ticket:" + TICKET))
        self.assertIn("&lt;script&gt;", self.last()["text"])
        self.assertIn("ops:reply:" + TICKET, str(self.last()["reply_markup"]))
        self.assertEqual(self.writes(), [])

    def test_ticket_reply_needs_confirmation_and_keeps_one_idempotency_key(self):
        self.bot.handle(self.cb("ops:reply:" + TICKET))
        self.bot.handle(self.msg("تمت مراجعة الاتصال"))
        self.assertEqual(self.writes(), [])
        nonce = next(iter(self.bot.confirms))
        self.bot.handle(self.cb("confirm:" + nonce))
        writes = self.writes()
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][:3], ("/support/tickets/" + TICKET + "/messages",
                                          {"body": "تمت مراجعة الاتصال"}, "POST"))
        self.assertTrue(writes[0][3])
        self.bot.handle(self.cb("confirm:" + nonce))
        self.assertEqual(len(self.writes()), 1)

    def test_ticket_status_requires_confirmation(self):
        self.bot.handle(self.cb("ops:resolve:" + TICKET))
        self.assertEqual(self.writes(), [])
        nonce = next(iter(self.bot.confirms))
        self.bot.handle(self.cb("confirm:" + nonce))
        self.assertEqual(self.writes()[0][0], "/support/tickets/" + TICKET)
        self.assertEqual(self.writes()[0][1]["status"], "resolved")
        self.assertEqual(self.writes()[0][2], "PATCH")

    def test_alert_ack_requires_confirmation(self):
        self.bot.handle(self.cb("ops:list:alerts:0"))
        self.assertIn("&lt;unsafe&gt;", self.last()["text"])
        self.bot.handle(self.cb("ops:ack:" + ALERT))
        self.assertEqual(self.writes(), [])
        self.bot.handle(self.cb("confirm:" + next(iter(self.bot.confirms))))
        self.assertEqual(self.writes()[0][0], "/alerts/" + ALERT + "/acknowledge")

    def test_reports_use_live_api_and_zero_information_is_not_invented(self):
        self.bot.handle(self.cb("ops:report"))
        self.assertEqual(self.api.calls[0][0], "/reports/summary")
        self.assertIn("1.000 GB", self.last()["text"])
        self.assertIn("التذاكر المفتوحة: 2", self.last()["text"])

    def test_unauthorized_actions_never_query_backend(self):
        self.bot.handle(self.cb("ops:menu", 12345679))
        self.bot.handle(self.cb("ops:resolve:" + TICKET, 12345679))
        self.assertEqual(self.api.calls, [])
        self.assertEqual([name for name, _ in self.sent], ["answerCallbackQuery"] * 2)

    def test_invalid_category_and_ticket_id_cannot_query_backend(self):
        with self.assertRaises(ValueError):
            self.bot.handle(self.cb("ops:list:unknown:0"))
        with self.assertRaises(ValueError):
            self.bot.handle(self.cb("ops:ticket:../other"))
        self.assertEqual(self.api.calls, [])

if __name__ == "__main__":
    unittest.main()
