"""Native provider-bot router flows: all writes must be tenant-scoped and confirmed."""
import unittest
from v183_bot import ApiError, V183Bot
from v183_screens import V183ScreenBot

PLATFORM_OWNER = 12345678
PROVIDER = 22345678
SECOND = 32345678
DEVICE_ID = "dev_1234567890abcdef1234567890abcdef"


class RouterApi:
    def __init__(self, *, tenant="ten_a", role="owner", can_write=True, devices=None):
        self.tenant, self.role, self.can_write = tenant, role, can_write
        self.devices = list(devices if devices is not None else [
            {"id": DEVICE_ID, "name": "Router A", "host": "192.168.88.1",
             "api_port": 8728, "status": "pending", "last_seen_at": None,
             "connection_method": "agent"}
        ])
        self.calls = []
        self.writes = []
        self.diagnostics_override = None

    def request(self, path, payload=None, method="GET", *, key=None):
        self.calls.append((path, method, key))
        if path == "/auth/me":
            return {"tenantId": self.tenant, "tenantName": "Provider " + self.tenant,
                    "role": self.role, "canWrite": self.can_write}
        if path == "/devices" and method == "GET":
            return {"items": [dict(row) for row in self.devices]}
        if path == "/devices/connection-diagnostics":
            if self.diagnostics_override is not None:
                return self.diagnostics_override
            counts = {}
            for item in self.devices:
                scope = (item.get("site_id"), item.get("host"), item.get("api_port"))
                counts[scope] = counts.get(scope, 0) + 1
            items = []
            for item in self.devices:
                scope = (item.get("site_id"), item.get("host"), item.get("api_port"))
                verified = item.get("status") == "online" and bool(item.get("last_seen_at"))
                items.append({
                    "id": item.get("id"), "verifiedOnline": verified,
                    "lastVerifiedAt": item.get("last_seen_at") if verified else None,
                    "issues": ["DUPLICATE_IN_SITE"] if counts[scope] > 1 else [],
                })
            return {"total": len(self.devices), "uniqueEndpoints": len(counts),
                    "verifiedOnline": sum(row["verifiedOnline"] for row in items),
                    "items": items}
        if path == "/radius/overview":
            return {"credentialConfigured": False, "agentConnected": False,
                    "lastSeenAt": None}
        if path.endswith("/direct-preflight") and method == "POST":
            if not self.can_write or self.role not in ("owner", "admin"):
                raise ApiError("Forbidden")
            return {"tlsVerified": True, "loginVerified": False, "routerIdentityVerified": False}
        if method in ("POST", "PATCH"):
            if not self.can_write or self.role not in ("owner", "admin"):
                raise ApiError("Forbidden")
            self.writes.append((path, dict(payload), method, key))
            if method == "POST":
                device = {"id": "dev_feedfacefeedfacefeedfacefeedface", "name": payload["name"],
                          "host": payload["host"], "api_port": payload["apiPort"],
                          "connection_method": "agent", "status": "pending",
                          "last_seen_at": None}
                self.devices.append(device)
                return dict(device)
            if path != "/devices/" + DEVICE_ID:
                raise ApiError("Other provider's device")
            device = self.devices[0]
            device.update({"name": payload["name"], "host": payload["host"],
                           "api_port": payload["apiPort"], "status": "pending"})
            return dict(device)
        raise AssertionError("Unexpected API call: " + path)


def update(uid=PROVIDER, *, text=None, action=None, private=True):
    chat = {"id": uid, "type": "private" if private else "group"}
    if action is not None:
        return {"callback_query": {"from": {"id": uid}, "id": "callback",
            "data": action, "message": {"chat": chat, "message_id": 81}}}
    return {"message": {"from": {"id": uid}, "chat": chat, "text": text or "/start"}}


class RouterNativeFlows(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self.owner_calls = []
        class OwnerApi:
            def request(inner, path, *args, **kwargs):
                self.owner_calls.append(path)
                raise AssertionError("Owner credentials leaked to provider")
        self.member = RouterApi()
        self.second = RouterApi(tenant="ten_b", role="admin", devices=[])
        self.bot = V183ScreenBot("test-token", PLATFORM_OWNER, api=OwnerApi(),
            telegram=lambda method, data: self.sent.append((method, data)) or {"ok": True},
            member_api_factory=lambda uid: self.member if uid == PROVIDER else self.second)

    def last(self):
        return [p for method, p in self.sent if method in ("sendMessage", "editMessageText")][-1]

    def buttons(self):
        return [b.get("callback_data") for row in self.last()["reply_markup"]["inline_keyboard"]
                for b in row if b.get("callback_data")]

    def tap(self, action, uid=PROVIDER):
        self.bot.handle(update(uid, action=action))

    def message(self, text, uid=PROVIDER):
        self.bot.handle(update(uid, text=text))

    def test_linked_owner_has_real_native_router_pages_and_specific_detail(self):
        self.message("/start")
        self.assertIn("mr:list:0", self.buttons())
        self.tap("mr:list:0")
        self.assertIn("Router A", self.last()["text"])
        self.assertIn("mr:detail:" + DEVICE_ID, self.buttons())
        self.tap("mr:detail:" + DEVICE_ID)
        self.assertIn("192.168.88.1", self.last()["text"])
        self.assertIn("mr:edit:" + DEVICE_ID, self.buttons())
        self.assertNotIn("🟢 متصل فعليًا", self.last()["text"])
        self.assertEqual(self.owner_calls, [])
        links = [b["web_app"]["url"] for row in self.last()["reply_markup"]["inline_keyboard"]
                 for b in row if "web_app" in b]
        self.assertIn("https://radius.uchiha-builder.com/v183/?open=connect-mikrotik&deviceId=" +
                      DEVICE_ID, links)

    def test_native_slash_commands_use_actual_tenant_data(self):
        self.message("/mikrotik")
        self.assertIn("Router A", self.last()["text"])
        self.message("/status")
        self.assertIn("نبضات موقعة: ⚪ غير متصلة", self.last()["text"])
        self.assertEqual(self.owner_calls, [])

    def test_new_device_requires_confirmation_and_replay_cannot_double_create(self):
        self.tap("mr:new")
        self.message("Backbone | 10.20.30.40")
        keys = self.buttons()
        confirm = next(k for k in keys if k.startswith("mr:confirm:"))
        self.assertEqual(self.member.writes, [])
        self.tap(confirm)
        self.assertEqual(len(self.member.writes), 1)
        path, body, method, key = self.member.writes[0]
        self.assertEqual((path, method), ("/devices", "POST"))
        self.assertEqual(body["apiPort"], 8729)
        self.assertNotIn("password", body)
        self.assertTrue(key)
        links = [b["web_app"]["url"] for row in self.last()["reply_markup"]["inline_keyboard"]
                 for b in row if "web_app" in b]
        self.assertTrue(any("?open=connect-mikrotik&deviceId=" in link for link in links),
                        "Bot must open exactly the newly registered router in web")
        self.tap(confirm)
        self.assertEqual(len(self.member.writes), 1)
        self.assertEqual(self.owner_calls, [])

    def test_edit_legacy_port_resets_pending_without_sending_router_credentials(self):
        self.tap("mr:edit:" + DEVICE_ID)
        self.message("Router A fixed | 192.168.88.1 | 8729")
        confirm = next(k for k in self.buttons() if k.startswith("mr:confirm:"))
        self.tap(confirm)
        path, body, method, key = self.member.writes[-1]
        self.assertEqual((path, method), ("/devices/" + DEVICE_ID, "PATCH"))
        self.assertEqual(body["apiPort"], 8729)
        self.assertGreaterEqual(len(body["reason"]), 3)
        self.assertNotIn("secret", body)
        self.assertEqual(self.member.devices[0]["status"], "pending")

    def test_permissions_revocation_and_collector_no_access(self):
        self.member.role, self.member.can_write = "viewer", False
        self.tap("mr:list:0")
        self.assertNotIn("mr:new", self.buttons())
        self.tap("mr:new")
        self.assertEqual(len(self.member.writes), 0)
        self.member.role, self.member.can_write = "owner", True
        self.tap("mr:new")
        self.message("Router | 192.168.88.3")
        confirm = next(k for k in self.buttons() if k.startswith("mr:confirm:"))
        self.member.can_write = False
        self.tap(confirm)
        self.assertEqual(len(self.member.writes), 0)
        self.member.role = "collector"
        self.tap("mr:list:0")
        self.assertEqual(len(self.member.writes), 0)
        self.assertEqual(self.owner_calls, [])

    def test_cross_tenant_callback_isolated_and_own_confirm_only(self):
        self.tap("mr:new")
        self.message("Router next | 10.11.12.13")
        confirm = next(k for k in self.buttons() if k.startswith("mr:confirm:"))
        self.tap(confirm, SECOND)
        self.assertFalse(self.member.writes)
        self.assertFalse(self.second.writes)
        self.tap("mr:detail:" + DEVICE_ID, SECOND)
        self.assertIn("غير مسجل", self.last()["text"])
        self.tap(confirm)
        self.assertEqual(len(self.member.writes), 1)

    def test_stale_edit_is_blocked_and_bad_draft_does_not_write(self):
        self.tap("mr:new")
        self.message("Router | 192.168.88.1 | secret | extra")
        self.assertFalse(self.member.writes)
        self.tap("mr:edit:" + DEVICE_ID)
        self.message("Edited | 192.168.88.10 | 8729")
        confirm = next(k for k in self.buttons() if k.startswith("mr:confirm:"))
        self.member.devices[0]["host"] = "192.168.88.15"
        self.tap(confirm)
        self.assertFalse(self.member.writes)

    def test_real_status_does_not_invent_connection_and_group_is_ignored(self):
        self.tap("mr:status")
        self.assertIn("نبضات موقعة: ⚪ غير متصلة", self.last()["text"])
        self.assertIn("فحص MikroTik ناجح: <b>0</b>", self.last()["text"])
        prior = len(self.member.calls)
        self.bot.handle(update(PROVIDER, action="mr:list:0", private=False))
        self.assertEqual(len(self.member.calls), prior)

    def test_old_same_ip_different_port_reuses_registration_instead_of_creating_third(self):
        self.tap("mr:new")
        self.message("Another record | 192.168.88.1")
        self.assertFalse(self.member.writes)
        self.assertIn("مسجل سابقًا", self.last()["text"])
        self.assertIn("mr:detail:" + DEVICE_ID, self.buttons())
        links = [b["web_app"]["url"] for row in self.last()["reply_markup"]["inline_keyboard"]
                 for b in row if "web_app" in b]
        self.assertTrue(any("deviceId=" + DEVICE_ID in link for link in links))
        self.assertNotIn(PROVIDER, self.bot.member_router_drafts)

    def test_device_added_after_draft_but_before_confirmation_prevents_duplicate(self):
        self.tap("mr:new")
        self.message("New ISP | 10.9.8.7")
        confirm = next(k for k in self.buttons() if k.startswith("mr:confirm:"))
        self.member.devices.append({"id": "dev_existing_other", "name": "Old ISP",
                                    "host": "10.9.8.7", "api_port": 8728,
                                    "site_id": None, "status": "pending"})
        self.tap(confirm)
        self.assertFalse(self.member.writes)
        self.assertIn("لم ننشئ نسخة ثانية", self.last()["text"])
        self.assertEqual(self.owner_calls, [])

    def test_native_preflight_proves_only_tls_then_opens_the_same_router_in_web(self):
        self.tap("mr:detail:" + DEVICE_ID)
        self.assertIn("mr:preflight:" + DEVICE_ID, self.buttons())
        self.tap("mr:preflight:" + DEVICE_ID)
        self.assertIn("استجاب المنفذ المشفّر", self.last()["text"])
        self.assertIn("لم يتم اختبار اسم المستخدم", self.last()["text"])
        self.assertTrue(any(path == "/devices/" + DEVICE_ID + "/direct-preflight"
                            for path, _, _ in self.member.calls))
        self.assertEqual(self.member.writes, [])
        links = [b["web_app"]["url"] for row in self.last()["reply_markup"]["inline_keyboard"]
                 for b in row if "web_app" in b]
        self.assertTrue(any("deviceId=" + DEVICE_ID in link for link in links))
        self.assertTrue(any("?open=site-agent&deviceId=" + DEVICE_ID in link
                            for link in links))
        self.member.can_write = False
        self.tap("mr:preflight:" + DEVICE_ID)
        self.assertEqual(sum(path.endswith("/direct-preflight")
                             for path, _, _ in self.member.calls), 1)


    def test_saved_online_flag_without_verified_probe_is_not_reported_as_connected(self):
        self.member.devices[0]["status"] = "online"
        self.member.devices[0]["last_seen_at"] = None
        self.tap("mr:list:0")
        self.assertIn("الاتصال المثبت: <b>0</b>", self.last()["text"])
        self.assertIn("⚪ بانتظار التحقق", self.last()["text"])
        self.tap("mr:detail:" + DEVICE_ID)
        self.assertIn("لم يثبت الاتصال بعد", self.last()["text"])
        self.assertNotIn("🟢 متصل فعليًا", self.last()["text"])
        self.tap("mr:status")
        self.assertIn("فحص MikroTik ناجح: <b>0</b>", self.last()["text"])

    def test_duplicate_registration_shows_one_router_endpoint_without_deleting_history(self):
        self.member.devices.append({
            "id": "dev_deduplicated_test_1234", "name": "Repeated pairing",
            "host": "192.168.88.1", "api_port": 8728,
            "site_id": None, "status": "pending", "last_seen_at": None
        })
        self.tap("mr:list:0")
        self.assertIn("السجلات المحفوظة: <b>2</b>", self.last()["text"])
        self.assertIn("نقاط إدارة مميزة (IP + منفذ): <b>1</b>", self.last()["text"])
        self.assertIn("عناوين IP داخل المواقع: <b>1</b>", self.last()["text"])
        self.assertIn("الاتصال المثبت: <b>0</b>", self.last()["text"])
        self.assertIn("سجل مكرر أو عنوان مشترك", self.last()["text"])
        self.assertIn("تأكد هل هو الراوتر نفسه أو تحويل منافذ", self.last()["text"])
        self.tap("mr:status")
        self.assertIn("نقاط إدارة مميزة: <b>1</b>", self.last()["text"])
        self.assertIn("فحص MikroTik ناجح: <b>0</b>", self.last()["text"])
        self.tap("mr:detail:" + DEVICE_ID)
        self.assertIn("يوجد سجل آخر بنفس IP", self.last()["text"])
        self.assertFalse(self.member.writes)

    def test_same_ip_different_ports_is_flagged_without_merging_or_fabricating_connection(self):
        self.member.devices.append({
            "id": "dev_other_port_12345678", "name": "Router REST attempt",
            "host": "192.168.88.1", "api_port": 443,
            "site_id": None, "status": "online", "last_seen_at": None
        })
        self.tap("mr:list:0")
        message = self.last()["text"]
        self.assertIn("السجلات المحفوظة: <b>2</b>", message)
        self.assertIn("نقاط إدارة مميزة (IP + منفذ): <b>2</b>", message)
        self.assertIn("عناوين IP داخل المواقع: <b>1</b>", message)
        self.assertIn("الاتصال المثبت: <b>0</b>", message)
        self.assertIn("تحويل منافذ", message)
        self.tap("mr:detail:" + DEVICE_ID)
        self.assertIn("يوجد سجل آخر بنفس IP", self.last()["text"])
        self.assertFalse(self.member.writes)

    def test_server_signed_diagnostics_override_unreliable_saved_status(self):
        self.member.devices[0]["status"] = "online"
        self.member.diagnostics_override = {
            "total": 1, "uniqueEndpoints": 1, "verifiedOnline": 0,
            "items": [{"id": DEVICE_ID, "verifiedOnline": False,
                       "issues": ["ROUTER_NOT_VERIFIED"], "lastVerifiedAt": None}]
        }
        self.tap("mr:list:0")
        self.assertIn("الاتصال المثبت: <b>0</b>", self.last()["text"])
        self.tap("mr:detail:" + DEVICE_ID)
        self.assertIn("لم يثبت الاتصال بعد", self.last()["text"])
        self.assertEqual(self.owner_calls, [])

    def test_fresh_server_verified_identity_is_displayed_only_on_that_record(self):
        checked_at = "2026-09-25T20:00:00Z"
        self.member.diagnostics_override = {
            "total": 1, "uniqueEndpoints": 1, "verifiedOnline": 1,
            "items": [{"id": DEVICE_ID, "verifiedOnline": True,
                       "issues": [], "lastVerifiedAt": checked_at}]
        }
        self.tap("mr:list:0")
        self.assertIn("الاتصال المثبت: <b>1</b>", self.last()["text"])
        self.tap("mr:detail:" + DEVICE_ID)
        self.assertIn("🟢 متصل فعليًا", self.last()["text"])
        self.assertIn(checked_at, self.last()["text"])

if __name__ == "__main__":
    unittest.main()
