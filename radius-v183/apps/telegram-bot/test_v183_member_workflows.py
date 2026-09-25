"""Regression tests for tenant-isolated native Telegram subscriber and payment paths."""
import struct
import unittest
from pathlib import Path
from unittest.mock import patch

from v183_bot import ApiError, V183Bot, PUBLIC_WEBAPP
from v183_screens import V183ScreenBot

OWNER = 12345678
MEMBER = 22345678
OTHER = 32345678
SUB = "cus_" + "a"*16
INV = "inv_" + "b"*16

class MemberApi:
    def __init__(self, tenant="ten_provider_1", role="owner", writable=True, linked=True):
        self.tenant, self.role, self.writable, self.linked = tenant, role, writable, linked
        self.subscribers = []
        self.invoices = [{"id": INV, "number": "INV-100", "subscriberName": "Ahmad",
                          "amountMinor": 5000, "paidMinor": 0, "currency": "USD",
                          "status": "open"}]
        self.calls, self.writes = [], []

    def request(self, path, payload=None, method="GET", *, key=None):
        self.calls.append((path, method, key))
        if not self.linked:
            raise ApiError("not linked")
        if path == "/auth/me":
            return {"tenantId": self.tenant, "tenantName": "Sample ISP",
                    "role": self.role, "canWrite": self.writable}
        if path.startswith("/subscribers?"):
            import urllib.parse
            query = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
            if "q" in query:
                rows = [s for s in self.subscribers if query["q"][0].lower() in s["username"].lower()]
            else:
                rows = self.subscribers
            return {"items": rows, "pagination": {"total": len(rows)}}
        if path == "/subscribers" and method == "POST":
            self.writes.append((path, payload, key))
            row = {"id": SUB, "status": "pending", **payload}
            self.subscribers.append(row)
            return row
        if path == "/subscribers/" + SUB:
            return self.subscribers[0]
        if path.startswith("/invoices?"):
            return {"items": [dict(i) for i in self.invoices],
                    "pagination": {"total": len(self.invoices)}}
        if path == "/invoices/" + INV + "/payments" and method == "POST":
            self.writes.append((path, payload, key))
            self.invoices[0]["paidMinor"] += payload["amountMinor"]
            return {"id": "pay_test", "status": "paid"}
        raise AssertionError("Unexpected API route: "+path)

class OwnerApi:
    def __init__(self): self.calls = []
    def request(self, path, *args, **kw):
        self.calls.append(path)
        if path == "/dashboard":
            return {"metrics": {}, "subscription": {"status": "trialing"}}
        if path == "/auth/me":
            return {"role": "owner", "tenantId": "ten_platform",
                    "user": {"platformRole": "platform_owner"}}
        if path.startswith(("/subscribers?", "/invoices?")):
            return {"items": [], "pagination": {"total": 0}}
        raise AssertionError("member reached platform-owner API: "+path)

def event(uid=MEMBER, *, text=None, cb=None, name="Ahmad", username="isp_admin", group=False):
    actor={"id":uid,"first_name":name,"last_name":"Saleh","username":username}
    chat={"id":-101 if group else uid,"type":"group" if group else "private"}
    if cb is not None:
        return {"callback_query":{"id":"cb","from":actor,"data":cb,
                                  "message":{"chat":chat,"message_id":77}}}
    return {"message":{"from":actor,"chat":chat,"text":text or "/start"}}

class Workflows(unittest.TestCase):
    def setUp(self):
        self.member=MemberApi()
        self.owner=OwnerApi()
        self.sent=[]
        def telegram(method,payload):
            self.sent.append((method,payload))
            if method=="getUserProfilePhotos":
                return {"ok":True,"result":{"photos":[]}}
            return {"ok":True}
        self.bot=V183ScreenBot("fake-token",OWNER,api=self.owner,telegram=telegram,
                               member_api_factory=lambda uid:self.member)
    def screen(self):
        return [p for m,p in self.sent if m in ("sendMessage","editMessageText")][-1]
    def buttons(self):
        return [b for row in self.screen()["reply_markup"]["inline_keyboard"] for b in row]
    def press(self, code, uid=MEMBER):
        self.bot.handle(event(uid,cb=code))
    def send(self, value, uid=MEMBER):
        self.bot.handle(event(uid,text=value))
    def test_platform_owner_main_buttons_and_advanced_role_boundary(self):
        self.bot.handle(event(OWNER, text="/start", name="Platform", username="owner_id"))
        rows=self.screen()["reply_markup"]["inline_keyboard"]
        self.assertEqual(rows[0][0]["web_app"]["url"], PUBLIC_WEBAPP+"?open=dashboard")
        self.assertEqual([row[0].get("callback_data") for row in rows[1:]],
                         ["router:new","new:subscriber","list:subscribers:0",
                          "list:invoices:0","owner:advanced"])
        self.bot.handle(event(OWNER,cb="owner:advanced"))
        self.assertIn("ops:menu",[b.get("callback_data") for b in self.buttons()])
        self.assertIn("router:home",[b.get("callback_data") for b in self.buttons()])
        self.bot.handle(event(OWNER,cb="list:subscribers:0"))
        self.assertIn("subscribers",self.owner.calls[-1])
        self.bot.handle(event(OWNER,cb="list:invoices:0"))
        self.assertIn("invoices",self.owner.calls[-1])
        self.bot.handle(event(OWNER,cb="new:subscriber"))
        self.assertIn("إضافة مشترك",self.screen()["text"])
        self.bot.handle(event(OWNER,cb="router:new"))
        self.assertIn("MikroTik",self.screen()["text"])
        self.assertFalse(self.member.calls)
    def test_menu_button_and_all_webapp_links_stay_on_v183(self):
        self.bot.configure()
        commands=[p for m,p in self.sent if m=="setMyCommands"][0]["commands"]
        self.assertIn("payments",[row["command"] for row in commands])
        menu_buttons=[p for m,p in self.sent if m=="setChatMenuButton"]
        self.assertEqual(len(menu_buttons),2)
        self.assertTrue(all(p["menu_button"]["web_app"]["url"]==PUBLIC_WEBAPP
                            for p in menu_buttons))
        self.send("/start")
        self.press("member:advanced")
        urls=[b["web_app"]["url"] for b in self.buttons() if "web_app" in b]
        self.assertTrue(urls)
        self.assertTrue(all(url.startswith(PUBLIC_WEBAPP+"?open=") for url in urls))
        self.assertRaises(ValueError,V183Bot.btn,"bad",web=True,
                          route="https://other.example/steal")
    def test_minimal_home_buttons_and_authenticated_profile(self):
        self.send("/start")
        rows=self.screen()["reply_markup"]["inline_keyboard"]
        self.assertEqual(rows[0][0]["text"],"🚀 فتح لوحة التحكم")
        self.assertEqual(rows[0][0]["web_app"]["url"],PUBLIC_WEBAPP+"?open=dashboard")
        self.assertEqual([r[0]["callback_data"] for r in rows[1:]],
                         ["mr:new","ms:new","ms:list:0","mb:list:0","member:advanced"])
        self.assertIn("Ahmad Saleh",self.screen()["text"])
        self.assertIn("@isp_admin",self.screen()["text"])
        self.assertIn(str(MEMBER),self.screen()["text"])
        self.assertEqual(self.owner.calls,[])
    def test_advanced_is_provider_only_with_working_web_routes(self):
        self.press("member:advanced")
        keys=self.buttons()
        urls=[k["web_app"]["url"] for k in keys if "web_app" in k]
        self.assertIn(PUBLIC_WEBAPP+"?open=mikrotik",urls)
        self.assertIn(PUBLIC_WEBAPP+"?open=site-agent",urls)
        self.assertFalse(any(k.get("callback_data")=="ops:menu" for k in keys))
    def test_subscriber_native_draft_confirmation_and_no_duplicate_retry(self):
        self.press("ms:new")
        self.send("New User | new_user")
        self.assertEqual(self.member.writes,[])
        nonce=self.bot.member_workflow_confirms[MEMBER]["nonce"]
        self.press("mw:confirm:"+nonce)
        self.assertEqual(len(self.member.writes),1)
        path,payload,key=self.member.writes[0]
        self.assertEqual((path,payload),("/subscribers",
                         {"fullName":"New User","username":"new_user"}))
        self.assertTrue(key)
        self.assertNotIn("password",str(payload).lower())
        self.press("mw:confirm:"+nonce)
        self.assertEqual(len(self.member.writes),1)
        self.press("ms:new")
        self.send("Again | NEW_user")
        nonce=self.bot.member_workflow_confirms[MEMBER]["nonce"]
        self.press("mw:confirm:"+nonce)
        self.assertEqual(len(self.member.writes),1)
        self.assertIn("مسجل مسبقًا",self.screen()["text"])
        self.assertEqual(self.owner.calls,[])
    def test_member_lists_and_details_use_only_own_api(self):
        self.member.subscribers.append({"id":SUB,"fullName":"Ahmad","username":"ahmad",
                                        "status":"pending","plan":{"name":"Starter"}})
        self.press("ms:list:0")
        self.assertIn("ms:detail:"+SUB,[b.get("callback_data") for b in self.buttons()])
        self.press("ms:detail:"+SUB)
        self.assertIn("Starter",self.screen()["text"])
        self.assertEqual(self.owner.calls,[])
    def test_collection_requires_real_invoice_confirmation_and_prevents_overpayment(self):
        self.press("mb:list:0")
        self.assertIn("INV-100",self.screen()["text"])
        self.press("mb:invoice:0:"+INV)
        self.assertIn("mb:pay:0:"+INV,[b.get("callback_data") for b in self.buttons()])
        self.press("mb:pay:0:"+INV)
        self.send("60.00")
        self.assertFalse(self.bot.member_workflow_confirms)
        self.assertFalse(self.member.writes)
        self.send("25.50")
        nonce=self.bot.member_workflow_confirms[MEMBER]["nonce"]
        self.member.invoices[0]["paidMinor"]=2600
        self.press("mw:confirm:"+nonce)
        self.assertEqual(self.member.writes,[])
        self.assertIn("تغير رصيد",self.screen()["text"])
        self.member.invoices[0]["paidMinor"]=0
        self.press("mb:pay:0:"+INV)
        self.send("25.50")
        nonce=self.bot.member_workflow_confirms[MEMBER]["nonce"]
        self.press("mw:confirm:"+nonce)
        self.assertEqual(self.member.invoices[0]["paidMinor"],2550)
        self.press("mw:confirm:"+nonce)
        self.assertEqual(len(self.member.writes),1)
        self.assertEqual(self.member.writes[0][1]["method"],"cash")
        self.assertTrue(self.member.writes[0][2])
    def test_permission_revocation_and_tenant_switch_stop_pending_writes(self):
        self.press("ms:new")
        self.send("New | new_user")
        nonce=self.bot.member_workflow_confirms[MEMBER]["nonce"]
        self.member.tenant="ten_another_provider"
        self.press("mw:confirm:"+nonce)
        self.assertFalse(self.member.writes)
        self.assertIn("تغيرت الشبكة",self.screen()["text"])
        self.member.tenant="ten_provider_1"
        self.press("ms:new")
        self.send("New | second_user")
        nonce=self.bot.member_workflow_confirms[MEMBER]["nonce"]
        self.member.writable=False
        self.press("mw:confirm:"+nonce)
        self.assertFalse(self.member.writes)
    def test_viewer_cannot_forge_write_callbacks_collector_can_record_payment(self):
        self.member.role="viewer"; self.member.writable=False
        self.send("/start")
        self.assertNotIn("ms:new",[b.get("callback_data") for b in self.buttons()])
        self.press("ms:new")
        self.assertFalse(self.member.writes)
        self.press("mb:pay:0:"+INV)
        self.assertFalse(self.member.writes)
        self.member.role="collector"; self.member.writable=True
        self.bot.member_apis.clear()
        self.send("/start")
        self.assertNotIn("mr:new",[b.get("callback_data") for b in self.buttons()])
        self.assertNotIn("ms:new",[b.get("callback_data") for b in self.buttons()])
        self.press("mb:pay:0:"+INV)
        self.send("5.00")
        nonce=self.bot.member_workflow_confirms[MEMBER]["nonce"]
        self.press("mw:confirm:"+nonce)
        self.assertEqual(len(self.member.writes),1)
    def test_return_to_home_discards_unfinished_native_drafts(self):
        self.press("ms:new")
        self.send("New User | test_user")
        self.assertTrue(self.bot.member_workflow_confirms)
        self.press("member:menu")
        self.assertFalse(self.bot.member_workflow_confirms)
        self.assertFalse(self.bot.member_workflow_drafts)
        self.send("Accidental | late_user")
        self.assertFalse(self.member.writes)

    def test_collector_advanced_hides_unavailable_sessions(self):
        self.member.role = "collector"
        self.member.writable = True
        self.press("member:advanced")
        urls = [button["web_app"]["url"] for button in self.buttons()
                if "web_app" in button]
        self.assertNotIn(PUBLIC_WEBAPP + "?open=sessions", urls)
        self.assertNotIn(PUBLIC_WEBAPP + "?open=mikrotik", urls)
        self.assertIn(PUBLIC_WEBAPP + "?open=reports", urls)

    def test_group_and_unlinked_users_never_reach_private_data(self):
        self.bot.handle(event(group=True, cb="ms:list:0"))
        self.assertFalse(self.member.calls)
        self.assertFalse(self.owner.calls)
        self.member.linked=False
        self.send("/start")
        self.assertIn("غير مرتبط",self.screen()["text"])
        self.assertFalse(self.member.writes)
    def test_telegram_real_photo_or_bundled_default(self):
        self.send("/start",uid=MEMBER)
        self.press("member:profile")
        photo=[p for m,p in self.sent if m=="sendPhoto"][-1]
        self.assertEqual(photo["photo"],"attach://avatar")
        self.assertIn(str(MEMBER),photo["caption"])
        self.assertIn("@isp_admin",photo["caption"])
        self.assertTrue((Path(__file__).with_name("assets")/"profile-default.png").is_file())
        blob=(Path(__file__).with_name("assets")/"profile-default.png").read_bytes()
        self.assertEqual(blob[:8],bytes.fromhex("89504e470d0a1a0a"))
        self.assertEqual(struct.unpack(">II",blob[16:24]),(384,384))
        self.sent.clear()
        def tg(method,payload):
            self.sent.append((method,payload))
            if method=="getUserProfilePhotos":
                return {"result":{"photos":[[{"file_id":"original"},{"file_id":"largest"}]]}}
            return {"ok":True}
        self.bot.telegram=tg
        self.press("member:profile")
        self.assertEqual([p for m,p in self.sent if m=="sendPhoto"][-1]["photo"],"largest")

    def test_expired_telegram_photo_falls_back_to_bundled_avatar(self):
        self.send("/start")
        self.sent.clear()
        def telegram(method, payload):
            self.sent.append((method, payload))
            if method == "getUserProfilePhotos":
                return {"result": {"photos": [[{"file_id": "stale_file_id"}]]}}
            if method == "sendPhoto" and payload["photo"] == "stale_file_id":
                raise RuntimeError("photo id expired")
            return {"ok": True}
        self.bot.telegram = telegram
        self.press("member:profile")
        attempted = [row["photo"] for method, row in self.sent if method == "sendPhoto"]
        self.assertEqual(attempted, ["stale_file_id", "attach://avatar"])

class MultipartDefault(unittest.TestCase):
    def test_default_avatar_upload_uses_only_local_png(self):
        bot=V183Bot("test-token",OWNER,api=OwnerApi())
        class Reply:
            def __enter__(self): return self
            def __exit__(self,*a): return None
            def read(self,*args): return b'{"ok":true}'
        seen=[]
        def capture(req,timeout):
            seen.append(req)
            return Reply()
        with patch("urllib.request.urlopen",side_effect=capture):
            bot._telegram_call("sendPhoto",{"chat_id":OWNER,"photo":"attach://avatar",
                                           "caption":"Hello","reply_markup":{"inline_keyboard":[]}})
        body=seen[0].data
        self.assertIn(b"image/png",body)
        self.assertIn(bytes.fromhex("89504e470d0a1a0a"),body)
        self.assertNotIn(b"attach://avatar",body)
        self.assertIn("multipart/form-data",seen[0].headers["Content-type"])

if __name__ == "__main__":
    unittest.main()

