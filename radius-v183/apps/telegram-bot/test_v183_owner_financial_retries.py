"""Offline owner-side financial replay tests (no credentials or network calls)."""
import time
import unittest

from v183_bot import ApiError
from v183_screens import V183ScreenBot


OWNER = 12345678
OTHER = 22345678
NONCE = "owner_finance_nonce"
KEY = "fdfba4e2-75e2-476e-93bb-f6081e6f8427"
INVOICE = "inv_1234567890abcdef"
PAYMENT_PATH = "/invoices/" + INVOICE + "/payments"


class OwnerWrites:
    def __init__(self):
        self.attempts = []
        self.commits = []
        self.results = {}
        self.fail_after_commit = set()
        self.fail_before_commit = set()

    def request(self, path, payload=None, method="GET", *, key=None):
        if method != "POST":
            raise AssertionError("Unexpected read request: " + path)
        self.attempts.append((path, payload, key))
        identity = (path, key)
        if identity in self.results:
            if self.results[identity]["body"] != payload:
                raise AssertionError("Same key was reused with a different body")
            return dict(self.results[identity]["result"])
        if path in self.fail_before_commit:
            self.fail_before_commit.remove(path)
            raise ApiError("Backend response unknown before a commit")
        result = {
            "id": "pay_000000001" if path == PAYMENT_PATH else "cus_000000001",
            "status": "paid" if path == PAYMENT_PATH else "pending",
        }
        self.commits.append((path, payload, key))
        self.results[identity] = {"body": payload, "result": result}
        if path in self.fail_after_commit:
            self.fail_after_commit.remove(path)
            raise ApiError("Backend committed but the response was lost")
        return dict(result)


class OwnerFinancialReplay(unittest.TestCase):
    def setUp(self):
        self.api = OwnerWrites()
        self.sent = []

        def telegram(method, body):
            self.sent.append((method, body))
            return {"ok": True}

        self.bot = V183ScreenBot(
            "bot-token-never-used", OWNER, api=self.api, telegram=telegram)

    def prepare(self, action, payload, target=""):
        self.bot.confirms[NONCE] = {
            "action": action, "payload": payload, "target": target,
            "time": time.monotonic(), "idempotency": KEY,
        }

    def tap(self, user=OWNER, group=False):
        chat_id = -100 if group else user
        self.bot.handle({
            "callback_query": {
                "id": "test_callback",
                "from": {"id": user, "first_name": "Test"},
                "data": "confirm:" + NONCE,
                "message": {
                    "chat": {"id": chat_id, "type": "group" if group else "private"},
                    "message_id": 88,
                },
            },
        })

    def last_screen(self):
        return [message for method, message in self.sent
                if method in ("editMessageText", "sendMessage")][-1]

    def callbacks(self):
        return [button.get("callback_data")
                for row in self.last_screen()["reply_markup"]["inline_keyboard"]
                for button in row]

    def test_cash_payment_lost_response_keeps_original_confirmation(self):
        body = {"amountMinor": 2650, "method": "cash", "reason": "Received in person"}
        self.prepare("payment", body, INVOICE)
        self.api.fail_after_commit.add(PAYMENT_PATH)
        self.tap()
        self.assertEqual(len(self.api.commits), 1)
        self.assertEqual(self.bot.confirms[NONCE]["idempotency"], KEY)
        self.assertIn("confirm:" + NONCE, self.callbacks())
        self.assertIn("ربما حُفظت", self.last_screen()["text"])
        self.tap()
        self.assertEqual(len(self.api.attempts), 2)
        self.assertEqual(len(self.api.commits), 1)
        self.assertEqual([row[2] for row in self.api.attempts], [KEY, KEY])
        self.assertEqual([row[1] for row in self.api.attempts], [body, body])
        self.assertNotIn(NONCE, self.bot.confirms)
        self.assertIn("تم تسجيل العملية", self.last_screen()["text"])
        self.tap()
        self.assertEqual(len(self.api.commits), 1)

    def test_subscriber_unknown_outcome_does_not_duplicate_creation(self):
        body = {"fullName": "Ahmed Offline", "username": "ahmed_offline"}
        self.prepare("subscriber", body)
        self.api.fail_after_commit.add("/subscribers")
        self.tap()
        self.assertEqual(len(self.api.commits), 1)
        self.assertIn("list:subscribers:0", self.callbacks())
        self.tap()
        self.assertEqual(len(self.api.commits), 1)
        self.assertEqual([row[2] for row in self.api.attempts], [KEY, KEY])
        self.assertNotIn(NONCE, self.bot.confirms)

    def test_no_server_commit_first_attempt_retries_same_key(self):
        body = {"amountMinor": 500, "method": "cash", "reason": "Confirmed cash"}
        self.prepare("payment", body, INVOICE)
        self.api.fail_before_commit.add(PAYMENT_PATH)
        self.tap()
        self.assertFalse(self.api.commits)
        self.assertEqual(self.bot.confirms[NONCE]["idempotency"], KEY)
        self.tap()
        self.assertEqual(len(self.api.commits), 1)
        self.assertEqual([attempt[2] for attempt in self.api.attempts], [KEY, KEY])
        self.assertNotIn(NONCE, self.bot.confirms)

    def test_plan_unknown_outcome_uses_same_key(self):
        body = {"name": "ISP Starter", "speedDownMbps": 25,
                "speedUpMbps": 10, "priceMinor": 1250,
                "billingCycle": "monthly"}
        self.prepare("plan", body)
        self.api.fail_after_commit.add("/plans")
        self.tap()
        self.assertIn("list:plans:0", self.callbacks())
        self.tap()
        self.assertEqual(len(self.api.commits), 1)
        self.assertEqual([attempt[2] for attempt in self.api.attempts], [KEY, KEY])

    def test_foreign_or_group_callback_never_reuses_owner_key(self):
        body = {"amountMinor": 500, "method": "cash", "reason": "cash"}
        self.prepare("payment", body, INVOICE)
        self.api.fail_after_commit.add(PAYMENT_PATH)
        self.tap()
        self.assertEqual(len(self.api.attempts), 1)
        self.tap(user=OTHER)
        self.tap(group=True)
        self.assertIn(NONCE, self.bot.confirms)
        self.assertEqual(len(self.api.attempts), 1)
        self.tap()
        self.assertEqual(len(self.api.commits), 1)

    def test_expired_unknown_outcome_cannot_be_replayed(self):
        body = {"amountMinor": 125, "method": "cash", "reason": "cash"}
        self.prepare("payment", body, INVOICE)
        self.api.fail_after_commit.add(PAYMENT_PATH)
        self.tap()
        self.bot.confirms[NONCE]["time"] -= 601
        self.tap()
        self.assertEqual(len(self.api.attempts), 1)
        self.assertEqual(len(self.api.commits), 1)
        self.assertNotIn(NONCE, self.bot.confirms)
        self.assertIn("انتهت صلاحية", self.last_screen()["text"])


if __name__ == "__main__":
    unittest.main()
