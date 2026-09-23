"""Private, read-only user-account summary PDF and simplified bot navigation."""
from __future__ import annotations

import io
import json
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from test_bot import ADMIN, UID, FakeBackend, FakeTG
import bot

try:
    from user_report_pdf import pdf_for_user
except ImportError:
    pdf_for_user = None


def snapshot(consent=True):
    return {
        "ok": True,
        "user": {
            "id":UID, "label":"أحمد الطويل متجر المدينة",
            "phone":"0999123456", "active":True,
            "expires_at":"2027-01-01T08:00:00+00:00",
            "max_devices":2, "devices":1,
            "created_at":"2026-07-01T00:00:00+00:00",
        },
        "wallet":{"balance":"15.75","recent":[
            {"amount":"25.00","kind":"manual","note":"تعبئة",
             "created_at":"2026-09-22T14:12:00+00:00"}
        ]},
        "orders":{"total":3,"open":1},
        "backup":({
            "status":"available",
            "shop":"متجر المدينة","clients":"9","entries":"13","products":"4",
            "created_at":"2026-09-22T14:12:00+00:00"
        } if consent else {"status":"no_consent"})
    }


class ReportHTTP:
    def __init__(self):
        self.calls=[]
    def post(self,url,payload,headers,timeout):
        self.calls.append((url,payload,headers))
        return snapshot()


class PDFTests(unittest.TestCase):
    @unittest.skipIf(pdf_for_user is None,"Install optional pinned PDF requirements")
    def test_render_one_page_with_user_data(self):
        from reportlab.lib.pagesizes import A4
        result=pdf_for_user(snapshot())
        self.assertTrue(result.startswith(b"%PDF-"))
        self.assertLess(len(result),1_000_000)
        try:
            import fitz
        except ImportError:
            return
        doc=fitz.open(stream=result,filetype="pdf")
        self.assertEqual(doc.page_count,1)
        self.assertAlmostEqual(doc[0].rect.width,A4[0],delta=0.2)
        txt=doc[0].get_text()
        self.assertIn("0999123456",txt)
        self.assertIn("15.75",txt)
        self.assertNotIn("DATABASE_PASSWORD",txt)
        doc.close()

    @unittest.skipIf(pdf_for_user is None,"Install optional pinned PDF requirements")
    def test_no_consent_has_no_snapshot_client_counts(self):
        base=snapshot(consent=False)
        base["user"]["label"]="<script>العميل</script>"
        pdf=pdf_for_user(base)
        self.assertTrue(pdf.startswith(b"%PDF-"))
        try:
            import fitz
        except ImportError:
            return
        txt=fitz.open(stream=pdf,filetype="pdf")[0].get_text()
        self.assertNotIn("متجر المدينة",txt)
        self.assertNotIn("9",base["backup"].values())
        self.assertIn("0999123456",txt)

    @unittest.skipIf(pdf_for_user is None,"Install optional pinned PDF requirements")
    def test_bad_and_out_of_scope_report_rejected(self):
        with self.assertRaises(ValueError):
            pdf_for_user({"ok":False})
        data=snapshot()
        data["user"]["id"]="not-a-real-license"
        with self.assertRaises(ValueError):
            pdf_for_user(data)

    def test_report_uses_distinct_gated_rpc_with_exact_customer_id(self):
        h=ReportHTTP()
        api=bot.Backend("https://example.supabase.co",
            "sb_publishable_test",ADMIN,"a"*64,h)
        result=api.call("user_report",{"license_id":UID})
        self.assertTrue(result["ok"])
        url,payload,headers=h.calls[0]
        self.assertTrue(url.endswith("/debt_telegram_admin_user_report"))
        self.assertEqual(payload["p_license_id"],UID)
        self.assertEqual(payload["p_telegram_id"],ADMIN)
        self.assertNotIn("p_action",payload)
        with self.assertRaises(bot.ApiError):
            api.call("user_report",{"license_id":"invalid"})
        self.assertEqual(len(h.calls),1)

    def test_only_owner_in_private_chat_can_request_report(self):
        class ReportBackend(FakeBackend):
            def call(self,action,args=None):
                if action=="user_report":
                    self.actions.append((action,args))
                    return snapshot()
                return super().call(action,args)
        class PDFTG(FakeTG):
            def __init__(self):
                super().__init__()
                self.documents=[]
            def send_pdf(self,chat,content,filename,caption):
                self.documents.append((chat,content,filename,caption))
        with tempfile.TemporaryDirectory() as d:
            storage=bot.Storage(Path(d)/"bot.sqlite3")
            tg=PDFTG()
            backend=ReportBackend()
            admin=bot.AdminBot(tg,backend,storage,ADMIN)
            def cb(uid,data,kind="private"):
                admin.on_callback({
                    "id":"callback","from":{"id":uid},
                    "message":{"chat":{"id":uid,"type":kind},"message_id":7},
                    "data":data
                })
            cb(ADMIN+1,"report:"+UID)
            cb(ADMIN,"report:"+UID,kind="group")
            self.assertFalse(tg.documents)
            self.assertFalse(any(a=="user_report" for a,_ in backend.actions))
            cb(ADMIN,"reports:0")
            self.assertIn("report:"+UID,str(tg.edits[-1][3]))
            cb(ADMIN,"report_search")
            admin.on_message({"from":{"id":ADMIN},"chat":{"id":ADMIN,"type":"private"},
                              "text":"أحمد"})
            self.assertEqual(admin.search_term,"أحمد")
            self.assertIn("البحث:",tg.messages[-1][1])
            if pdf_for_user is not None:
                cb(ADMIN,"report:"+UID)
                self.assertEqual(len(tg.documents),1)
                self.assertEqual(tg.documents[0][0],ADMIN)
                self.assertTrue(tg.documents[0][1].startswith(b"%PDF-"))
                self.assertIn(".pdf",tg.documents[0][2])
                self.assertNotIn("أحمد",tg.documents[0][2])
                self.assertEqual(len([a for a,_ in backend.actions if a=="user_report"]),1)
            storage.close()

    def test_send_document_multipart_is_binary_safe(self):
        class OKReply:
            def __enter__(self): return self
            def __exit__(self,*unused): return None
            def read(self,limit):return b'{"ok":true,"result":{}}'
        tg=bot.Telegram("12345678:"+"a"*30)
        data=b"%PDF-"+b"x"*3200
        with patch.object(bot.urllib.request,"urlopen",return_value=OKReply()) as open_:
            tg.send_pdf(ADMIN,data,"summary-12345678.pdf","Test")
        req=open_.call_args.args[0]
        self.assertTrue(req.full_url.endswith("/sendDocument"))
        self.assertIn(b"\r\nContent-Disposition: form-data;",req.data)
        self.assertIn(b"application/pdf\r\n\r\n%PDF-",req.data)
        self.assertIn(b'summary-12345678.pdf',req.data)
        self.assertIn(str(ADMIN).encode(),req.data)
        with self.assertRaises(ValueError):
            tg.send_pdf(ADMIN,data,"../../secret.pdf","Test")

    def test_main_menu_keeps_all_management_paths_with_fewer_rows(self):
        menu=bot.AdminBot.menu()
        self.assertLessEqual(len(menu),5)
        callbacks={cmd for row in menu for _text,cmd in row}
        self.assertTrue({"users:0","wallets:0","reports:0","code","topups:0",
                         "orders:0","alerts","settings","logs","home"}<=callbacks)


if __name__=="__main__":
    unittest.main()
