import json
import os
import re
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime,timedelta,timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"bot"))
import bot
import setup as setup_bot

UID="11111111-1111-4111-8111-111111111111"
TID="22222222-2222-4222-8222-222222222222"
OID="33333333-3333-4333-8333-333333333333"
ADMIN=12345678


class FakeTG:
    def __init__(self):
        self.messages=[]
        self.edits=[]
        self.answers=[]
    def send(self,chat,text,rows=None):
        self.messages.append((chat,text,rows or []))
    def edit(self,chat,mid,text,rows=None):
        self.edits.append((chat,mid,text,rows or []))
    def answer(self,cid,text=""):
        self.answers.append((cid,text))
    def send_proof(self,chat,proof):
        self.messages.append((chat,"image:"+proof,[]))


class FakeBackend:
    def __init__(self):
        self.actions=[]
        self.balance=Decimal("100.0000")
        self.replays={}
        self.topup_status="pending"
        self.orders_status="pending"
        self.new_codes=[]
        self.timeout_kind=""
        self.expires_at="2026-11-30T00:00:00+00:00"
        self.max_devices=1
        self.active_devices=1
        self.license_replays={}
    def call(self,action,args=None):
        args=args or {}
        self.actions.append((action,args.copy()))
        if action==self.timeout_kind:
            self.timeout_kind=""
            if action=="wallet_adjust":
                self._wallet(args)
            if action in ("renew_license","unlimited_license","set_max_devices"):
                self._license(action,args)
            raise bot.TransportError("unknown")
        if action=="dashboard":return {"ok":True,"users":1,"active_users":1,"wallet_total":str(self.balance),"pending_topups":1,"pending_orders":1}
        if action=="user":return {"ok":True,"user":{
            "id":UID,"label":"أحمد","phone":"123","active":True,"balance":str(self.balance),
            "max_devices":self.max_devices,"devices":self.active_devices,
            "expires_at":self.expires_at,"code_hint":"1234"}}
        if action in ("users","wallets"):return {"ok":True,"items":[{
            "id":UID,"label":"أحمد","active":True,"balance":str(self.balance)}],"total":1}
        if action=="user_code":return {"ok":True,"code":"0"*32,"label":"أحمد"}
        if action=="wallet_adjust":return self._wallet(args)
        if action in ("renew_license","unlimited_license","set_max_devices"):
            return self._license(action,args)
        if action=="code_create":
            self.new_codes.append(args)
            return {"ok":True,"license_id":UID,"code":"A"*32}
        if action=="topups":return {"ok":True,"items":[{"id":TID,"label":"أحمد",
            "status":self.topup_status,"amount_requested":"60"}]}
        if action=="topup_detail":return {"ok":True,"item":{"id":TID,
            "label":"أحمد","status":self.topup_status,"amount_requested":"60"}}
        if action=="topup_proof":return {"ok":True,"proof_data":"https://example.com/image.jpg"}
        if action=="topup_review":
            if self.topup_status!="pending":raise bot.ApiError("ALREADY_REVIEWED")
            self.topup_status=args["decision"]
            return {"ok":True,"status":self.topup_status}
        if action=="orders":return {"ok":True,"items":[{"id":OID,"label":"أحمد","product_name":"بطاقة",
            "amount":"9.00","status":self.orders_status,"provider_status":"PENDING"}]}
        if action=="order_detail":return {"ok":True,"item":{"id":OID,"label":"أحمد","product_name":"بطاقة",
            "amount":"9.00","status":self.orders_status,"provider_status":"PENDING"}}
        if action=="order_status":self.orders_status=args["status"];return {"ok":True}
        if action in ("audit","wallet_ledger"):return {"ok":True,"items":[]}
        if action=="ping":return {"ok":True}
        if action in ("user_toggle","user_reset_devices"):return {"ok":True}
        raise AssertionError("Unexpected action "+action)
    def _license(self,action,args):
        rid=args["request_id"]
        fingerprint=(action,tuple(sorted((k,str(v)) for k,v in args.items() if k!="request_id")))
        if rid in self.license_replays:
            old,result=self.license_replays[rid]
            if old!=fingerprint:raise bot.ApiError("REPLAY_CONFLICT")
            return {**result,"replayed":True}
        if action=="renew_license":
            if self.expires_at is None:raise bot.ApiError("ALREADY_UNLIMITED")
            ref=max(datetime.fromisoformat(self.expires_at),datetime.now(timezone.utc))
            self.expires_at=(ref+timedelta(days=int(args["days"]))).isoformat()
            result={"ok":True,"expires_at":self.expires_at,"days_added":args["days"],"replayed":False}
        elif action=="unlimited_license":
            if self.expires_at is None:raise bot.ApiError("ALREADY_UNLIMITED")
            self.expires_at=None
            result={"ok":True,"expires_at":None,"replayed":False}
        else:
            value=int(args["max_devices"])
            if value<self.active_devices:raise bot.ApiError("TOO_MANY_ACTIVE_DEVICES")
            self.max_devices=value
            result={"ok":True,"max_devices":value,"replayed":False}
        self.license_replays[rid]=(fingerprint,result)
        return result

    def _wallet(self,args):
        rid=args["request_id"]
        if rid in self.replays:
            return {"ok":True,"balance":str(self.balance),"replayed":True}
        self.balance+=Decimal(str(args["amount"]))
        self.replays[rid]=True
        return {"ok":True,"balance":str(self.balance),"replayed":False}


class AdminFlowTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.tg=FakeTG()
        self.backend=FakeBackend()
        self.db=bot.Storage(Path(self.tmp.name)/"bot.sqlite3")
        self.bot=bot.AdminBot(self.tg,self.backend,self.db,ADMIN)
    def cb(self,data,uid=ADMIN,private=True):
        self.bot.on_callback({"id":"cb-id","from":{"id":uid},
                              "message":{"chat":{"id":uid,"type":"private" if private else "group"},
                                         "message_id":42},"data":data})
    def msg(self,text,uid=ADMIN):
        self.bot.on_message({"from":{"id":uid},
                             "chat":{"id":uid,"type":"private"},"text":text})
    def last_confirm(self):
        data=self.tg.messages[-1][2][0][0][1]
        self.assertTrue(data.startswith("confirm:"))
        return data
    def test_unauthorized_button_cannot_touch_wallet_or_codes(self):
        self.cb("wa:+"+UID,uid=ADMIN+1)
        self.cb("code",uid=ADMIN+1)
        self.msg("/start",uid=ADMIN+1)
        self.assertEqual([],self.backend.actions)
        self.assertFalse(self.db.flow(ADMIN+1))
    def test_wallet_add_and_deduct_requires_confirm(self):
        self.cb("wa:+"+UID)
        self.assertEqual(self.db.flow(ADMIN)[0],"wa_amount")
        self.msg("25.125")
        self.msg("إضافة تجريبية")
        self.assertEqual(self.backend.balance,Decimal("100.0000"))
        confirm=self.last_confirm()
        self.cb(confirm)
        self.assertEqual(self.backend.balance,Decimal("125.1250"))
        self.cb(confirm)
        self.assertEqual(self.backend.balance,Decimal("125.1250"))
        self.cb("wa:-"+UID)
        self.msg("10")
        self.msg("تصحيح الرصيد")
        self.cb(self.last_confirm())
        self.assertEqual(self.backend.balance,Decimal("115.1250"))
        self.assertEqual(len(self.backend.replays),2)
    def test_uncertain_wallet_retry_keeps_same_request_id(self):
        self.cb("wa:+"+UID)
        self.msg("20")
        self.msg("شحن يدوي")
        confirm=self.last_confirm()
        self.backend.timeout_kind="wallet_adjust"
        self.cb(confirm)
        self.assertEqual(self.backend.balance,Decimal("120.0000"))
        opid=confirm.partition(":")[2]
        self.assertEqual(self.db.operation(opid)["status"],"uncertain")
        self.cb(confirm)
        self.assertEqual(self.backend.balance,Decimal("120.0000"))
        self.assertEqual(self.db.operation(opid)["status"],"done")
        self.assertEqual(len(self.backend.replays),1)
    def test_creation_flow_callbacks_not_cleared(self):
        self.cb("code")
        self.msg("علي")
        self.msg("تخطي")
        self.cb("cv:2")
        self.assertEqual(self.db.flow(ADMIN)[0],"code_expiry")
        self.cb("ce:30")
        confirm=self.last_confirm()
        self.cb(confirm)
        self.assertEqual(len(self.backend.new_codes),1)
        p=self.backend.new_codes[0]
        self.assertEqual(p["label"],"علي")
        self.assertEqual(p["phone"],"")
        self.assertEqual(p["max_devices"],2)
        self.assertRegex(p["expires_on"],r"^\d{4}-\d{2}-\d{2}$")
        self.cb(confirm)
        self.assertEqual(len(self.backend.new_codes),1)
    def test_code_uncertainty_never_auto_retries(self):
        self.cb("code");self.msg("صالح");self.msg("تخطي");self.cb("cv:1");self.cb("ce:0")
        confirm=self.last_confirm()
        self.backend.timeout_kind="code_create"
        self.cb(confirm)
        self.cb(confirm)
        self.assertEqual(len([a for a,args in self.backend.actions if a=="code_create"]),1)
    def test_topup_approved_exactly_once_and_proof(self):
        self.cb("topup:"+TID)
        self.cb("proof:"+TID)
        self.assertTrue(self.tg.messages[-1][1].startswith("image:"))
        self.cb("tapprove:"+TID)
        confirm=self.last_confirm()
        self.cb(confirm)
        self.cb(confirm)
        self.assertEqual(self.backend.topup_status,"approved")
        self.assertEqual(len([x for x,a in self.backend.actions if x=="topup_review"]),1)
    def test_order_status_is_manual_only(self):
        self.cb("order:"+OID)
        self.cb("os:processing:"+OID)
        self.msg("طلب قيد العمل")
        self.cb(self.last_confirm())
        self.assertEqual(self.backend.orders_status,"processing")
        self.assertNotIn("wallet_adjust",[x for x,a in self.backend.actions])
    def test_cancel_and_persistence(self):
        self.cb("wa:-"+UID);self.msg("5");self.msg("عملية غير مطلوبة")
        confirm=self.last_confirm()
        opid=confirm.partition(":")[2]
        self.cb("cancel:"+opid)
        self.cb(confirm)
        self.assertEqual(self.backend.balance,Decimal("100.0000"))
        self.db.advance_offset(15)
        second=bot.Storage(Path(self.tmp.name)/"bot.sqlite3")
        self.assertEqual(second.get_offset(),15)
        self.assertEqual(second.operation(opid)["status"],"cancelled")
        second.db.close()
    def test_money_rejects_nan_infinity_negative_and_zero(self):
        for val in ("NaN","Infinity","0","-1","1000001","0.000001"):
            with self.subTest(val=val):
                with self.assertRaises(ValueError):bot.money(val)
        self.assertEqual(bot.money("1.12345"),Decimal("1.1235"))
    def test_unprivileged_backend_rejects_invalid_key(self):
        with self.assertRaises(ValueError):
            bot.Backend("https://example.com","sb_publishable_public",ADMIN,"invalid")


    def test_pending_code_after_restart_never_replayed(self):
        self.cb("code");self.msg("مصطفى");self.msg("تخطي");self.cb("cv:1");self.cb("ce:30")
        confirm=self.last_confirm()
        opid=confirm.partition(":")[2]
        self.db.op_status(opid,"pending")
        # This is exactly what the old process leaves behind on SIGKILL.
        self.cb(confirm)
        self.assertEqual(len(self.backend.new_codes),0)
        self.assertEqual(self.db.operation(opid)["status"],"pending")

    def test_recover_pending_wallet_with_same_id(self):
        self.cb("wa:+"+UID);self.msg("7");self.msg("تعويض")
        confirm=self.last_confirm()
        opid=confirm.partition(":")[2]
        self.backend.timeout_kind="wallet_adjust"
        self.cb(confirm)
        self.assertEqual(self.backend.balance,Decimal("107.0000"))
        self.db.op_status(opid,"pending")
        self.cb(confirm)
        self.assertEqual(self.backend.balance,Decimal("107.0000"))
        self.assertEqual(len(self.backend.replays),1)

    def test_renewal_requires_confirmation_is_cumulative_and_exactly_once(self):
        self.cb("renew:"+UID)
        self.assertIn("rday:30:"+UID,str(self.tg.edits[-1][3]))
        self.assertIn("\n",self.tg.edits[-1][2])
        old=datetime.fromisoformat(self.backend.expires_at)
        self.cb("rday:30:"+UID)
        confirm=self.last_confirm()
        self.assertEqual(datetime.fromisoformat(self.backend.expires_at),old)
        self.cb(confirm)
        self.assertEqual(datetime.fromisoformat(self.backend.expires_at),old+timedelta(days=30))
        self.cb(confirm)
        self.assertEqual(datetime.fromisoformat(self.backend.expires_at),old+timedelta(days=30))
        self.assertEqual(len(self.backend.license_replays),1)
        self.assertEqual(self.backend.balance,Decimal("100.0000"))

    def test_safe_renewal_retry_after_unknown_network_response(self):
        self.cb("rday:90:"+UID)
        confirm=self.last_confirm()
        old=datetime.fromisoformat(self.backend.expires_at)
        self.backend.timeout_kind="renew_license"
        self.cb(confirm)
        opid=confirm.partition(":")[2]
        self.assertEqual(self.db.operation(opid)["status"],"uncertain")
        self.assertEqual(datetime.fromisoformat(self.backend.expires_at),old+timedelta(days=90))
        self.cb(confirm)
        self.assertEqual(datetime.fromisoformat(self.backend.expires_at),old+timedelta(days=90))
        self.assertEqual(self.db.operation(opid)["status"],"done")

    def test_unlimited_subscription_and_device_limit(self):
        self.cb("permanent:"+UID)
        confirm=self.last_confirm()
        self.assertIsNotNone(self.backend.expires_at)
        self.cb(confirm)
        self.assertIsNone(self.backend.expires_at)
        self.cb(confirm)
        self.assertEqual(len(self.backend.license_replays),1)
        self.cb("renew:"+UID)
        self.assertIn("بلا انتهاء",self.tg.messages[-1][1])
        self.backend.active_devices=2
        self.backend.max_devices=2
        self.cb("devices:"+UID)
        options=str(self.tg.edits[-1][3])
        self.assertNotIn("dmax:1:",options)
        self.assertIn("dmax:3:"+UID,options)
        self.cb("dmax:3:"+UID)
        self.cb(self.last_confirm())
        self.assertEqual(self.backend.max_devices,3)

    def test_new_admin_actions_use_separate_gated_rpc(self):
        class FakeHTTP:
            def __init__(self):self.routes=[]
            def post(self,url,payload,headers,timeout):
                self.routes.append((url,payload["p_action"]))
                return {"ok":True}
        http=FakeHTTP()
        api=bot.Backend("https://example.supabase.co","sb_publishable_example",ADMIN,"a"*64,http)
        api.call("ping")
        api.call("renew_license",{"request_id":"bot:"+"b"*32})
        api.call("set_max_devices",{"request_id":"bot:"+"c"*32})
        self.assertTrue(http.routes[0][0].endswith("/debt_telegram_admin_dispatch"))
        self.assertTrue(http.routes[1][0].endswith("/debt_telegram_admin_license_action"))
        self.assertTrue(http.routes[2][0].endswith("/debt_telegram_admin_license_action"))

class SetupTests(unittest.TestCase):
    def test_preprovisioned_setup_requires_only_token(self):
        with tempfile.TemporaryDirectory() as d:
            from contextlib import redirect_stdout
            import io
            path=Path(d)/".env"
            path.write_text(
                "ADMIN_TELEGRAM_ID=8120730186\n"
                "SUPABASE_URL=https://example.supabase.co\n"
                "SUPABASE_PUBLISHABLE_KEY=sb_publishable_dummy\n"
                "BOT_RPC_SECRET="+"a"*64+"\n"
            )
            calls=[]
            def fake_api(url,body,headers=None,timeout=25):
                calls.append((url.split("/")[-1],body.get("p_action","")))
                if url.endswith("/getMe"):
                    return {"ok":True,"result":{"is_bot":True,"username":"DebtDemoBot"}}
                if url.endswith("/getWebhookInfo"):
                    return {"ok":True,"result":{"url":""}}
                if url.endswith("/debt_telegram_admin_dispatch"):
                    self.assertEqual(body["p_telegram_id"],8120730186)
                    return {"ok":True}
                raise AssertionError("Unexpected API")
            fake="12345678:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234"
            result=io.StringIO()
            with patch.object(setup_bot,"ENV",path),patch.object(setup_bot,"HERE",Path(d)),\
                 patch.object(setup_bot,"api",side_effect=fake_api),\
                 patch.object(setup_bot.getpass,"getpass",return_value=fake) as prompt,\
                 patch("builtins.input",side_effect=AssertionError("Extra setup question")),\
                 redirect_stdout(result):
                setup_bot.main()
            self.assertEqual(prompt.call_count,1)
            self.assertTrue((Path(d)/".configured.ready").exists())
            self.assertEqual(path.stat().st_mode & 0o777,0o600)
            self.assertIn("BOT_TOKEN="+fake,path.read_text())
            self.assertEqual(
                [name for name,_ in calls],
                ["getMe","getWebhookInfo","debt_telegram_admin_dispatch"]
            )
            self.assertNotIn(fake,result.getvalue())

    def test_initial_setup_provisions_once_and_never_saves_service_key(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/".env"
            answers=iter(["24680","نعم","","",""])
            secrets_in=iter(["123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345","sb_secret_one_time_key"])
            calls=[]
            def api(url,body,headers=None,timeout=25):
                calls.append((url,body,headers))
                if url.endswith("/getMe"):return {"ok":True,"result":{"username":"testbot"}}
                if url.endswith("/debt_telegram_admin_provision"):
                    self.assertEqual(headers["apikey"],"sb_secret_one_time_key")
                    return {"ok":True}
                if url.endswith("/debt_telegram_admin_dispatch"):return {"ok":True}
                raise AssertionError(url)
            with patch.object(setup_bot,"ENV",path),patch.object(setup_bot,"api",side_effect=api),\
                 patch("builtins.input",side_effect=lambda x="":next(answers)),\
                 patch.object(setup_bot.getpass,"getpass",side_effect=lambda x="":next(secrets_in)):
                setup_bot.main()
            text=path.read_text()
            self.assertIn("BOT_TOKEN=123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345",text)
            self.assertNotIn("sb_secret_one_time_key",text)
            self.assertRegex(text,r"BOT_RPC_SECRET=[0-9a-f]{64}")
            self.assertEqual(path.stat().st_mode&0o777,0o600)
            self.assertEqual(len([c for c in calls if c[0].endswith("/debt_telegram_admin_provision")]),1)


if __name__=="__main__":
    unittest.main(verbosity=2)
