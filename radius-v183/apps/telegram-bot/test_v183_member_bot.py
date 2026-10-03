import unittest
from v183_bot import ApiError, V183Api, V183Bot, PUBLIC_WEBAPP
from v183_screens import V183ScreenBot

OWNER = 12345678
MEMBER = 22345678
CODE = "UCHL-" + "a" * 43

class MemberApi:
    def __init__(self, role="owner", writable=True, linked=True):
        self.role, self.writable, self.linked = role, writable, linked
        self.calls, self.claims = [], []
    def request(self, path, *args, **kwargs):
        self.calls.append(path)
        if not self.linked:
            raise ApiError("not linked")
        if path != "/auth/me":
            raise AssertionError("unexpected member API route " + path)
        return {"tenantId": "ten_provider_1", "tenantName": "Own ISP",
                "role": self.role, "canWrite": self.writable}
    def claim_link(self, code):
        self.claims.append(code)
        self.linked = True

def update(user=MEMBER, message="/start", callback=None, private=True):
    chat = {"id": user, "type": "private" if private else "group"}
    if callback is not None:
        return {"callback_query": {"from": {"id": user}, "id": "cb",
            "data": callback, "message": {"chat": chat, "message_id": 123}}}
    return {"message": {"from": {"id": user}, "chat": chat, "text": message}}

class MemberButtons(unittest.TestCase):
    def setUp(self):
        self.messages = []
        self.member = MemberApi()
        self.owner_calls = []
        class OwnerApi:
            def request(_, path, *a, **kw):
                self.owner_calls.append(path)
                if path == "/dashboard":
                    return {"metrics": {}, "subscription": {"status": "trialing"}}
                raise AssertionError("member must not use platform owner API")
        self.bot = V183ScreenBot("test-bot-token", OWNER, api=OwnerApi(),
            telegram=lambda method, data: self.messages.append((method, data)) or {"ok": True},
            member_api_factory=lambda _uid: self.member)
    def last(self):
        return [p for m, p in self.messages if m in ("sendMessage", "editMessageText")][-1]
    def links(self):
        return [b["web_app"]["url"] for row in self.last()["reply_markup"]["inline_keyboard"]
                for b in row if "web_app" in b]
    def test_owner_only_privileges_not_given_to_unlinked_users(self):
        self.member.linked = False
        self.bot.handle(update())
        self.assertIn("غير مرتبط", self.last()["text"])
        self.assertNotIn("add-mikrotik", str(self.last()["reply_markup"]))
        self.assertEqual(self.owner_calls, [])
    def test_provider_owner_has_native_mikrotik_addition_before_webapp(self):
        self.bot.handle(update())
        links = self.links()
        callbacks = [b.get("callback_data") for row in self.last()["reply_markup"]["inline_keyboard"]
                     for b in row]
        self.assertIn("mr:list:0", callbacks)
        self.assertNotIn(PUBLIC_WEBAPP + "?open=add-mikrotik", links)
        self.assertEqual(links, [PUBLIC_WEBAPP + "?open=dashboard"])
        self.assertIn("ms:new", callbacks)
        self.bot.handle(update(callback="member:advanced"))
        self.assertIn(PUBLIC_WEBAPP + "?open=site-agent", self.links())
        self.assertTrue(all(u.startswith(PUBLIC_WEBAPP) for u in links))
        self.assertEqual(self.owner_calls, [])
    def test_viewer_and_collector_cannot_get_network_write_shortcuts(self):
        self.member = MemberApi(role="viewer", writable=False)
        self.bot.handle(update())
        self.assertNotIn("?open=add-mikrotik", " ".join(self.links()))
        self.bot.handle(update(callback="member:advanced"))
        self.assertIn(PUBLIC_WEBAPP + "?open=mikrotik", self.links())
        self.member = MemberApi(role="collector", writable=False)
        self.bot.member_apis.clear()
        self.bot.handle(update())
        self.assertNotIn("?open=mikrotik", " ".join(self.links()))
        self.assertNotIn("ms:new", str(self.last()["reply_markup"]))
        self.bot.handle(update(callback="member:advanced"))
        self.assertNotIn("?open=mikrotik", " ".join(self.links()))
        self.assertIn(PUBLIC_WEBAPP + "?open=reports", self.links())
    def test_private_link_code_only_enables_that_users_own_membership(self):
        self.member = MemberApi(linked=False)
        self.bot.handle(update(message="/link " + CODE))
        self.assertEqual(self.member.claims, [CODE])
        self.assertIn("Own ISP", self.last()["text"])
        self.assertEqual(self.owner_calls, [])
        self.bot.handle(update(callback="router:home"))
        self.assertEqual(self.owner_calls, [])
    def test_group_or_another_users_bot_callback_does_not_read_owner_data(self):
        self.bot.handle(update(private=False))
        self.assertEqual(self.messages, [])
        self.bot.handle(update(callback="router:status"))
        self.assertEqual(self.owner_calls, [])
    def test_invalid_webapp_route_refused(self):
        with self.assertRaises(ValueError):
            V183Bot.btn("unsafe", web=True, route="https://attacker.example")

class MemberTransport(unittest.TestCase):
    def test_linked_provider_tenant_applies_before_auth_me(self):
        api = V183Api("test-token", MEMBER, require_platform_owner=False)
        observed = []
        def fake_transport(path, payload=None, method="GET", key=None, auth=True):
            observed.append((path, api.tenant_id, auth))
            if path == "/auth/telegram":
                return {"token": "member-session", "tenantId": "ten_second_provider"}
            if path == "/auth/me":
                return {"role": "owner", "tenantId": "ten_second_provider",
                        "user": {"platformRole": "none"}}
            raise AssertionError("Unexpected API call")
        api._transport = fake_transport
        result = api.login()
        self.assertEqual(result["tenantId"], "ten_second_provider")
        self.assertEqual(api.tenant_id, "ten_second_provider")
        self.assertEqual(observed[1], ("/auth/me", "ten_second_provider", True))

if __name__ == "__main__":
    unittest.main()
