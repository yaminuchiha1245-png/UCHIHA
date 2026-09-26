"""Offline bot UX and authorization checks for MikroTik edit/delete."""

import unittest
from v183_bot import ApiError
from v183_screens import V183ScreenBot

OWNER = 12345678
MEMBER = 22345678
OTHER = 32345678
ID = "dev_11112222333344445555666677778888"
VERSION = "2026-09-26T01:02:03.000Z"


def update(uid, action=None, text=None):
    chat = {"id": uid, "type": "private"}
    if action is not None:
        return {"callback_query": {"id": "cb", "from": {"id": uid},
                "data": action, "message": {"message_id": 5, "chat": chat}}}
    return {"message": {"from": {"id": uid}, "chat": chat,
                        "text": text or "/start"}}


class FakeRouterApi:
    def __init__(self, tenant="ten_test", role="owner"):
        self.tenant, self.role, self.can_write = tenant, role, True
        self.devices = [{
            "id": ID, "name": "Main Router", "host": "10.20.30.40",
            "api_port": 8729, "connection_method": "agent",
            "status": "pending", "site_id": None, "updated_at": VERSION
        }]
        self.calls = []
        self.writes = []
        self.cached = {}
        self.drop_first_result = False

    def request(self, path, payload=None, method="GET", *, key=None):
        self.calls.append((path, method, key))
        if path == "/auth/me":
            return {"tenantId": self.tenant, "tenantName": "Own ISP",
                    "role": self.role, "canWrite": self.can_write}
        if path == "/devices" and method == "GET":
            return {"items": [dict(row) for row in self.devices]}
        if path == "/devices/connection-diagnostics":
            return {"items": [{"id": x["id"], "verifiedOnline": False}
                              for x in self.devices],
                    "uniqueEndpoints": len(self.devices)}
        if path == "/dashboard":
            return {"metrics": {}, "subscription": {"status": "active"}}
        if method in ("PATCH", "DELETE") and path == "/devices/" + ID:
            if self.role not in ("owner", "admin") or not self.can_write:
                raise ApiError("V1-83 API 403: forbidden")
            if key in self.cached:
                return dict(self.cached[key])
            current = next((x for x in self.devices if x["id"] == ID), None)
            if not current:
                raise ApiError("V1-83 API 404: missing")
            if method == "DELETE":
                if (payload["expectedHost"] != current["host"] or
                        payload["expectedUpdatedAt"] != current["updated_at"]):
                    raise ApiError("V1-83 API 409: stale record")
                result = {"id": ID, "deleted": True}
                self.devices.remove(current)
            else:
                current.update({"name": payload["name"], "host": payload["host"],
                                "api_port": payload["apiPort"], "updated_at": VERSION + ".new",
                                "status": "pending"})
                result = dict(current)
            self.writes.append((path, method, key, dict(payload)))
            self.cached[key] = dict(result)
            if self.drop_first_result:
                self.drop_first_result = False
                raise ApiError("connection closed after server committed")
            return dict(result)
        raise AssertionError("Unexpected fake API request " + method + " " + path)


class MikroTikManagementTests(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self.owner = FakeRouterApi(tenant="ten_owner")
        self.member = FakeRouterApi(tenant="ten_member")
        self.other = FakeRouterApi(tenant="ten_other")
        self.bot = V183ScreenBot(
            "offline-test-token", OWNER, api=self.owner,
            telegram=lambda method, data: self.sent.append((method, data)) or {"ok": True},
            member_api_factory=lambda uid: self.member if uid == MEMBER else self.other)

    def last(self):
        return [item for method, item in self.sent
                if method in ("editMessageText", "sendMessage")][-1]

    def buttons(self):
        return [button for row in self.last()["reply_markup"]["inline_keyboard"]
                for button in row]

    def callbacks(self):
        return [button["callback_data"] for button in self.buttons()
                if "callback_data" in button]

    def tap(self, user, name):
        self.bot.handle(update(user, action=name))

    def test_member_main_mikrotik_opens_registered_devices_with_wide_controls(self):
        self.bot.handle(update(MEMBER))
        keyboard = self.last()["reply_markup"]["inline_keyboard"]
        self.assertEqual(keyboard[0][0]["web_app"]["url"].split("?")[1], "open=dashboard")
        self.assertIn("mr:list:0", self.callbacks())
        self.assertNotIn("mr:new", self.callbacks())
        self.assertTrue(all(len(row) == 1 for row in keyboard))
        self.tap(MEMBER, "mr:list:0")
        self.assertIn("mr:detail:" + ID, self.callbacks())
        self.assertIn("mr:new", self.callbacks())
        self.tap(MEMBER, "mr:detail:" + ID)
        self.assertIn("mr:edit:" + ID, self.callbacks())
        self.assertIn("mr:d:" + ID, self.callbacks())
        self.assertEqual(self.owner.calls, [])

    def test_member_delete_needs_confirmation_and_only_its_own_api(self):
        self.tap(MEMBER, "mr:d:" + ID)
        confirm = next(k for k in self.callbacks() if k.startswith("mr:del:"))
        self.assertEqual(self.member.writes, [])
        self.tap(OTHER, confirm)
        self.assertEqual(self.other.writes, [])
        self.assertEqual(self.member.writes, [])
        self.tap(MEMBER, confirm)
        self.assertEqual(len(self.member.writes), 1)
        path, method, key, payload = self.member.writes[0]
        self.assertEqual((path, method), ("/devices/" + ID, "DELETE"))
        self.assertEqual(payload["expectedHost"], "10.20.30.40")
        self.assertEqual(payload["expectedUpdatedAt"], VERSION)
        self.assertTrue(key)
        self.assertFalse(self.member.devices)
        self.assertIn("حُذف", self.last()["text"])
        self.assertEqual(self.owner.calls, [])

    def test_member_stale_version_and_revoked_permission_never_delete(self):
        self.tap(MEMBER, "mr:d:" + ID)
        confirm = next(k for k in self.callbacks() if k.startswith("mr:del:"))
        self.member.devices[0]["updated_at"] = VERSION + ".changed"
        self.tap(MEMBER, confirm)
        self.assertFalse(self.member.writes)
        self.member.devices[0]["updated_at"] = VERSION
        self.tap(MEMBER, "mr:d:" + ID)
        confirm = next(k for k in self.callbacks() if k.startswith("mr:del:"))
        self.member.can_write = False
        self.tap(MEMBER, confirm)
        self.assertFalse(self.member.writes)
        self.assertEqual(self.owner.calls, [])

    def test_lost_delete_response_retries_same_idempotency_key_without_second_delete(self):
        self.member.drop_first_result = True
        self.tap(MEMBER, "mr:d:" + ID)
        confirm = next(k for k in self.callbacks() if k.startswith("mr:del:"))
        self.tap(MEMBER, confirm)
        self.assertEqual(len(self.member.writes), 1)
        self.assertIn(confirm, self.callbacks())
        self.tap(MEMBER, confirm)
        self.assertEqual(len(self.member.writes), 1)
        calls = [x for x in self.member.calls
                 if x[0] == "/devices/" + ID and x[1] == "DELETE"]
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][2], calls[1][2])
        self.assertFalse(self.member.devices)

    def test_owner_edits_and_deletes_from_same_registered_router_detail(self):
        self.bot.handle(update(OWNER))
        self.assertIn("router:list", self.callbacks())
        self.assertNotIn("router:new", self.callbacks())
        self.tap(OWNER, "router:list")
        self.assertIn("router:detail:" + ID, self.callbacks())
        self.tap(OWNER, "router:detail:" + ID)
        self.assertIn("router:edit:" + ID, self.callbacks())
        self.assertIn("router:d:" + ID, self.callbacks())
        self.tap(OWNER, "router:edit:" + ID)
        self.assertFalse(self.owner.writes)
        self.bot.handle(update(OWNER, text="Updated Router | 10.20.30.44 | 8729"))
        yes = next(k for k in self.callbacks() if k.startswith("router:yes:"))
        self.tap(OWNER, yes)
        self.assertEqual(self.owner.writes[0][1], "PATCH")
        self.assertEqual(self.owner.devices[0]["host"], "10.20.30.44")
        self.tap(OWNER, "router:detail:" + ID)
        self.tap(OWNER, "router:d:" + ID)
        yes = next(k for k in self.callbacks() if k.startswith("router:yes:"))
        self.tap(OWNER, yes)
        self.assertEqual(self.owner.writes[-1][1], "DELETE")
        self.assertFalse(self.owner.devices)
        self.assertEqual(self.member.calls, [])

    def test_owner_canceled_delete_keeps_saved_router_and_forged_button_is_ignored(self):
        self.tap(OWNER, "router:d:" + ID)
        yes = next(k for k in self.callbacks() if k.startswith("router:yes:"))
        self.tap(OTHER, yes)
        self.assertFalse(self.owner.writes)
        self.tap(OWNER, "router:cancel")
        self.assertFalse(self.owner.writes)
        self.assertEqual(len(self.owner.devices), 1)
        self.tap(OWNER, yes)
        self.assertFalse(self.owner.writes)


    def test_router_lists_show_seven_wide_buttons_per_page_with_navigation(self):
        seed = dict(self.owner.devices[0])
        extras = [
            {**seed, "id": "dev_" + format(i, "032x"),
             "name": "Router " + str(i), "host": "10.50.0." + str(i)}
            for i in range(1, 9)
        ]
        self.owner.devices.extend(extras)
        self.member.devices = [dict(item) for item in self.owner.devices]
        self.tap(OWNER, "router:list")
        self.assertIn("router:list:7", self.callbacks())
        self.assertTrue(all(len(row) == 1 for row in
                            self.last()["reply_markup"]["inline_keyboard"]))
        self.tap(OWNER, "router:list:7")
        self.assertIn("router:list:0", self.callbacks())
        self.tap(MEMBER, "mr:list:0")
        self.assertIn("mr:list:7", self.callbacks())
        self.assertTrue(all(len(row) == 1 for row in
                            self.last()["reply_markup"]["inline_keyboard"]))
        self.tap(MEMBER, "mr:list:7")
        self.assertIn("mr:list:0", self.callbacks())
        self.assertEqual(self.member.writes, [])
        self.assertEqual(self.owner.writes, [])


if __name__ == "__main__":
    unittest.main()
