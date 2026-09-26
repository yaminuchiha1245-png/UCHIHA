"""Definitive HTTP rejection must not be presented as an uncertain POST.

All cases run against fake tenant/owner APIs; no network or Telegram token.
"""
import time
import unittest

from v183_bot import ApiError, explicitly_rejected_write
import test_v183_owner_financial_retries as owner_finance
import test_v183_owner_router_retries as owner_router
import test_v183_member_workflows as member_workflows
import test_v183_member_routers as member_routers


class ApiWriteRejectionTests(unittest.TestCase):
    def test_known_client_rejections_are_definitive(self):
        for status in (400, 401, 403, 404, 409, 410, 412, 422):
            with self.subTest(status=status):
                self.assertTrue(explicitly_rejected_write(
                    ApiError(f"V1-83 API {status}: request rejected")))

    def test_lost_response_and_transient_http_status_remain_uncertain(self):
        for message in (
            "تعذر الاتصال بخادم V1-83: TimeoutError",
            "V1-83 API 408: request timeout",
            "V1-83 API 425: too early",
            "V1-83 API 429: retry later",
            "V1-83 API 500: internal error",
            "V1-83 API 503: temporarily unavailable",
            "role revoked without an HTTP response",
        ):
            with self.subTest(message=message):
                self.assertFalse(explicitly_rejected_write(ApiError(message)))

    def test_owner_cash_422_has_review_but_no_useless_retry(self):
        scenario = owner_finance.OwnerFinancialReplay(methodName="test_cash_payment_lost_response_keeps_original_confirmation")
        scenario.setUp()
        scenario.prepare("payment", {"amountMinor": 3000, "method": "cash", "reason": "cash"}, owner_finance.INVOICE)
        original = scenario.api.request
        def reject(path, payload=None, method="GET", *, key=None):
            if path == owner_finance.PAYMENT_PATH and method == "POST":
                raise ApiError("V1-83 API 422: invalid invoice amount")
            return original(path, payload, method, key=key)
        scenario.api.request = reject
        scenario.tap()
        self.assertNotIn("owner_finance_nonce", scenario.bot.confirms)
        self.assertNotIn("confirm:owner_finance_nonce", scenario.callbacks())
        self.assertIn("list:invoices:0", scenario.callbacks())
        self.assertIn("رفض الخادم", scenario.last_screen()["text"])

    def test_owner_router_409_clears_confirmation_and_keeps_review(self):
        scenario = owner_router.OwnerRouterRetryTests(methodName="test_successful_registration_opens_exact_device_and_its_agent")
        scenario.setUp()
        original = scenario.api.request
        def reject(path, payload=None, method="GET", *, key=None):
            if path == "/devices" and method == "POST":
                raise ApiError("V1-83 API 409: duplicate registration")
            return original(path, payload, method, key=key)
        scenario.api.request = reject
        scenario.bot.confirm(scenario.bot.owner, owner_router.NONCE)
        self.assertNotIn(owner_router.NONCE, scenario.bot.confirms)
        callbacks = [button.get("callback_data") for button in scenario.buttons()]
        self.assertNotIn("confirm:" + owner_router.NONCE, callbacks)
        self.assertIn("router:list", callbacks)
        self.assertIn("رفض الخادم", scenario.last_message()["text"])

    def test_member_cash_403_clears_key_and_offers_ledger(self):
        scenario = member_workflows.Workflows(methodName="test_minimal_home_buttons_and_authenticated_profile")
        scenario.setUp()
        uid = member_workflows.MEMBER
        nonce = "member_cash_rejection"
        scenario.bot.member_workflow_confirms[uid] = {
            "nonce": nonce, "kind": "payment", "tenant": scenario.member.tenant,
            "invoice": scenario.member.invoices[0]["id"], "offset": 0,
            "payload": {"amountMinor": 300, "method": "cash", "reason": "cash"},
            "time": time.monotonic(), "key": "key-403-member",
        }
        original = scenario.member.request
        def reject(path, payload=None, method="GET", *, key=None):
            if method == "POST" and path.endswith("/payments"):
                raise ApiError("V1-83 API 403: collector role revoked")
            return original(path, payload, method, key=key)
        scenario.member.request = reject
        scenario.bot.member_workflow_confirm(uid, uid, nonce)
        self.assertNotIn(uid, scenario.bot.member_workflow_confirms)
        buttons = [b.get("callback_data") for b in scenario.buttons()]
        self.assertNotIn("mw:confirm:" + nonce, buttons)
        self.assertIn("mb:list:0", buttons)
        self.assertIn("رفض الخادم", scenario.screen()["text"])

    def test_member_router_409_conflict_has_no_retry(self):
        scenario = member_routers.RouterNativeFlows(methodName="test_linked_owner_has_real_native_router_pages_and_specific_detail")
        scenario.setUp()
        uid = member_routers.PROVIDER
        nonce = "member_device_rejection"
        scenario.bot.member_router_confirms[uid] = {
            "nonce": nonce, "kind": "new", "tenantId": scenario.member.tenant,
            "payload": {"name": "Other router", "host": "10.77.44.33",
                        "apiPort": 8729, "connectionMethod": "agent"},
            "time": time.monotonic(), "idempotency": "key-409-device",
        }
        original = scenario.member.request
        def reject(path, payload=None, method="GET", *, key=None):
            if path == "/devices" and method == "POST":
                raise ApiError("V1-83 API 409: device conflict")
            return original(path, payload, method, key=key)
        scenario.member.request = reject
        scenario.bot.member_router_confirm(uid, uid, nonce)
        self.assertNotIn(uid, scenario.bot.member_router_confirms)
        self.assertNotIn("mr:confirm:" + nonce, scenario.buttons())
        self.assertIn("mr:list:0", scenario.buttons())
        self.assertIn("رفض الخادم", scenario.last()["text"])

    def test_owner_503_still_offers_original_same_key_retry(self):
        scenario = owner_finance.OwnerFinancialReplay(methodName="test_cash_payment_lost_response_keeps_original_confirmation")
        scenario.setUp()
        scenario.prepare("payment", {"amountMinor": 500, "method": "cash", "reason": "cash"}, owner_finance.INVOICE)
        def reject(path, payload=None, method="GET", *, key=None):
            raise ApiError("V1-83 API 503: response uncertain")
        scenario.api.request = reject
        scenario.tap()
        self.assertIn("owner_finance_nonce", scenario.bot.confirms)
        self.assertIn("confirm:owner_finance_nonce", scenario.callbacks())
        self.assertIn("ربما حُفظت", scenario.last_screen()["text"])


if __name__ == "__main__":
    unittest.main()
