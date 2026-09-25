"""Shop debtor reports use uploaded user-authorized JSON, never cloud decryption."""
from __future__ import annotations

import io
import json
import sys
import tempfile
import time
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from test_bot import ADMIN, FakeTG, FakeBackend
import bot
from debtor_statement import (
    InvalidShopBackup, parse_backup, statement, recovery_json, render_pdf,
    one_client, LIMIT_BYTES
)


def fake_shop(count=3):
    clients=[{"id":"cl-"+str(i),"name":"زبون تجريبي "+str(i),
              "phone":"0000000"+str(i),
              "address":"عنوان تجريبي",
              "notes":"ملاحظة خاصة بالزبون"} for i in range(count)]
    entries=[
        {"id":"e1","clientId":"cl-0","type":"opening",
         "date":"2026-01-05","createdAt":"2026-01-05T10:00:00Z",
         "originalAmount":100,"originalCurrency":"USD",
         "usdAmount":100,"remainingUsd":60,"rateUsdTry":40,
         "description":"رصيد قديم"},
        {"id":"e2","clientId":"cl-1","type":"purchase",
         "date":"2026-01-06","createdAt":"2026-01-06T12:00:00Z",
         "originalAmount":200,"originalCurrency":"TRY",
         "usdAmount":5,"remainingUsd":5,"rateUsdTry":40,
         "description":"شراء منتج"},
        {"id":"e3","clientId":"cl-0","type":"payment",
         "date":"2026-01-07","createdAt":"2026-01-07T13:00:00Z",
         "originalAmount":40,"originalCurrency":"USD",
         "usdAmount":40,"remainingUsd":0,"description":"دفعة"},
    ]
    return {
        "setupDone":True,
        "shop":{"name":"متجر تجريبي أوتشيها","phone":"0000000","pdfFooter":"إيصال تجريبي"},
        "clients":clients,"entries":entries,"rates":{"usdTry":40,"usdSyp":12000},
        "accounts":[{"pinHash":"SENSITIVE_PRIVATE_PIN","session":"NEVER_COPY"}],
        "settings":{"secret":"NEVER_COPY"},"cloud":{"token":"NEVER_COPY"}
    }


class ShopBackupTests(unittest.TestCase):
    def setUp(self):
        self.original=fake_shop()
        self.raw=json.dumps(self.original,ensure_ascii=False).encode()
        self.snapshot=parse_backup(self.raw)

    def test_parser_discards_all_passwords_tokens_and_unrelated_tables(self):
        snap=self.snapshot
        self.assertNotIn("accounts",snap)
        self.assertNotIn("settings",snap)
        self.assertNotIn("cloud",snap)
        self.assertNotIn(b"NEVER_COPY",json.dumps(snap,ensure_ascii=False).encode())
        self.assertNotIn("pinHash",str(snap))
        self.assertEqual(len(snap["clients"]),3)
        self.assertEqual(len(snap["entries"]),3)

    def test_app_native_summary_matches_purchases_payments_and_remaining(self):
        s=statement(self.snapshot,"cl-0")
        self.assertEqual(s["buy_usd"],Decimal("100"))
        self.assertEqual(s["paid_usd"],Decimal("40"))
        self.assertEqual(s["due_usd"],Decimal("60"))
        self.assertEqual(s["operations"],2)
        self.assertEqual([e["balance_usd"] for e in s["entries"]],
                         [Decimal("100"),Decimal("60")])
        self.assertEqual(s["entries"][0]["type"],"رصيد افتتاحي")
        other=statement(self.snapshot,"cl-1")
        self.assertEqual(other["entries"][0]["balance_currency"],Decimal("200"))
        self.assertEqual(other["due_usd"],Decimal("5"))

    def test_client_recovery_is_scoped_and_preserves_original_entry_ids(self):
        result=json.loads(recovery_json(self.snapshot,"cl-0"))
        self.assertEqual(result["format"],"uchiha-single-debtor-recovery-v1")
        self.assertEqual(result["client"]["id"],"cl-0")
        self.assertEqual({x["id"] for x in result["entries"]},{"e1","e3"})
        self.assertNotIn("pinHash",str(result))
        self.assertNotIn("cl-1",str(result["entries"]))
        self.assertNotIn("setupDone",str(result))
        self.assertEqual(result["record_count"],2)
        with self.assertRaises(InvalidShopBackup):
            recovery_json(self.snapshot,"nonexistent")

    def test_rejects_invalid_and_partial_app_backups(self):
        with self.assertRaises(InvalidShopBackup):
            parse_backup(b"{}")
        bad=fake_shop();bad["setupDone"]=False
        with self.assertRaises(InvalidShopBackup):
            parse_backup(json.dumps(bad).encode())
        bad=fake_shop();bad["clients"][1]["id"]="cl-0"
        with self.assertRaises(InvalidShopBackup):
            parse_backup(json.dumps(bad).encode())
        bad=fake_shop();bad["entries"][1]["id"]="e1"
        with self.assertRaises(InvalidShopBackup):
            parse_backup(json.dumps(bad).encode())
        with self.assertRaises(InvalidShopBackup):
            parse_backup(b"x"*(LIMIT_BYTES+1))
        with self.assertRaises(InvalidShopBackup):
            parse_backup(b'{"setupDone":true,"entries":[],"clients":[],"shop":{},"rate":NaN}')

    def test_brief_and_full_pdf_render_complete_readable_rows(self):
        import fitz
        brief=render_pdf(self.snapshot,"cl-0")
        full=render_pdf(self.snapshot,"cl-0",full=True)
        for blob in (brief,full):
            self.assertTrue(blob.startswith(b"%PDF-"))
            document=fitz.open(stream=blob,filetype="pdf")
            self.assertEqual(document.page_count,1)
            page=document[0]
            self.assertIn("100.00",page.get_text())
            self.assertIn("60.00",page.get_text())
            self.assertLess(len(blob),6_000_000)
            self.assertAlmostEqual(page.rect.width,595.28,delta=.2)
            document.close()

    def test_full_pdf_multipage_and_recent_short_pdf(self):
        raw=fake_shop(1)
        raw["entries"]=[]
        for i in range(45):
            raw["entries"].append({
                "id":"line-"+str(i),"clientId":"cl-0","type":"purchase",
                "date":"2026-01-01","createdAt":"2026-01-01T01:%02d:00Z"%i,
                "usdAmount":1,"originalAmount":1,
                "remainingUsd":1,"originalCurrency":"USD"
            })
        s=parse_backup(json.dumps(raw,ensure_ascii=False).encode())
        import fitz
        quick=fitz.open(stream=render_pdf(s,"cl-0"),filetype="pdf")
        full=fitz.open(stream=render_pdf(s,"cl-0",full=True),filetype="pdf")
        self.assertEqual(quick.page_count,1)
        self.assertEqual(full.page_count,3)
        self.assertIn("45",quick[0].get_text())
        self.assertEqual(statement(s,"cl-0")["due_usd"],Decimal("45"))
        self.assertTrue(all(abs(p.rect.height-841.89)<0.2 for p in full))
        full.close();quick.close()

    def test_admin_private_chat_upload_and_pdf_wizard(self):
        class TelegramMock(FakeTG):
            def __init__(self,raw):
                super().__init__()
                self.raw=raw
                self.docs=[]
                self.read_calls=0
            def download_json_backup(self,document):
                self.read_calls+=1
                return self.raw
            def send_pdf(self,chat,blob,filename,caption):
                self.docs.append((chat,blob,filename,caption,"application/pdf"))
            def send_document(self,chat,blob,filename,caption,mime):
                self.docs.append((chat,blob,filename,caption,mime))
        fake=TelegramMock(self.raw)
        with tempfile.TemporaryDirectory() as path:
            st=bot.Storage(Path(path)/"bot.sqlite3")
            backend=FakeBackend()
            instance=bot.AdminBot(fake,backend,st,ADMIN)
            def click(uid,data,kind="private"):
                instance.on_callback({
                    "id":"click","from":{"id":uid},
                    "message":{"message_id":10,"chat":{"id":uid,"type":kind}},
                    "data":data
                })
            def upload(uid,kind="private"):
                instance.on_message({
                    "from":{"id":uid},"chat":{"id":uid,"type":kind},
                    "document":{"file_name":"debt-backup.json",
                                "file_size":len(self.raw),"file_id":"mockfile"}
                })
            upload(ADMIN)
            self.assertEqual(fake.read_calls,0,"Unsolicited uploads must not be fetched")
            click(ADMIN+7,"debtor_upload")
            click(ADMIN,"debtor_upload",kind="group")
            self.assertIsNone(instance.upload_state)
            click(ADMIN,"debtor_upload")
            upload(ADMIN)
            self.assertEqual(fake.read_calls,0,"Explicit consent button required")
            click(ADMIN,"dbconsent")
            upload(ADMIN+3)
            self.assertEqual(fake.read_calls,0)
            upload(ADMIN)
            self.assertEqual(fake.read_calls,1)
            self.assertEqual(len(instance.upload_state["data"]["clients"]),3)
            self.assertFalse(any(x=="wallet_adjust" for x,_ in backend.actions))
            shown=instance.upload_state["shown_ids"]
            self.assertIn("cl-0",shown)
            stale=instance.upload_state["view_token"]
            click(ADMIN,"dbsearch")
            instance.on_message({
                "from":{"id":ADMIN},"chat":{"id":ADMIN,"type":"private"},
                "text":"تجريبي 0"
            })
            self.assertNotEqual(stale,instance.upload_state["view_token"])
            self.assertEqual(instance.upload_state["shown_ids"],["cl-0"])
            click(ADMIN,"dbchoose:0:"+stale)
            self.assertIsNone(instance.upload_state["selected_id"],"Stale buttons cannot select another user")
            token=instance.upload_state["view_token"]
            click(ADMIN,"dbchoose:0:"+token)
            opt=instance.upload_state["choice_token"]
            click(ADMIN,"dbout:brief:"+opt)
            self.assertEqual(len(fake.docs),1)
            self.assertEqual(fake.docs[-1][0],ADMIN)
            self.assertTrue(fake.docs[-1][1].startswith(b"%PDF-"))
            self.assertNotIn("زبون",fake.docs[-1][2])
            click(ADMIN,"dbout:json:"+opt)
            result=json.loads(fake.docs[-1][1])
            self.assertEqual(result["client"]["id"],"cl-0")
            self.assertEqual(fake.docs[-1][4],"application/json")
            click(ADMIN,"dbclear")
            self.assertIsNone(instance.upload_state)
            self.assertEqual(list(Path(path).glob("debt-backup*.json")),[])
            st.close()

    def test_temporary_session_expires_without_persistence(self):
        with tempfile.TemporaryDirectory() as t:
            st=bot.Storage(Path(t)/"bot.sqlite3")
            x=bot.AdminBot(FakeTG(),FakeBackend(),st,ADMIN)
            x.upload_state={"data":self.snapshot,"expires_at":time.monotonic()-2}
            self.assertIsNone(x.upload_session())
            self.assertIsNone(x.upload_state)
            self.assertNotIn("cl-0",str(st.recent(ADMIN)))
            st.close()


if __name__=="__main__":
    unittest.main()
