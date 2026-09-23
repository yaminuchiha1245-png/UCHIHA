"""UCHIHA bot admin-state backups — no app ledger/financial data is copied."""
from __future__ import annotations

import os
import sqlite3
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path

import backup
import bot
from test_bot import ADMIN, FakeBackend, FakeTG


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.path=self.root/"bot.sqlite3"
        self.db=bot.Storage(self.path)
        self.backups=self.root/"backups"

    def tearDown(self):
        self.db.close()

    def test_online_consistent_private_backup_with_wal_uncheckpointed(self):
        opid=self.db.prepare(ADMIN,"wallet_adjust",
                             {"license_id":"customer","amount":"25","reason":"test"})
        self.db.op_status(opid,"done","OK")
        self.db.advance_offset(345)
        self.db.set_alert_enabled("topup",False)
        backup_path=backup.create_backup(self.path,self.backups)
        self.assertRegex(backup_path.name,backup.FILENAME)
        self.assertEqual(backup_path.stat().st_mode&0o777,0o600)
        self.assertEqual(self.backups.stat().st_mode&0o777,0o700)
        self.assertFalse(backup_path.is_symlink())
        with closing(sqlite3.connect("file:"+str(backup_path)+"?mode=ro",uri=True)) as copy:
            self.assertEqual(copy.execute("pragma integrity_check").fetchone()[0],"ok")
            self.assertEqual(copy.execute("pragma journal_mode").fetchone()[0],"delete")
            self.assertEqual(copy.execute("select value from state where key='offset'").fetchone(),("345",))
            self.assertEqual(copy.execute("select status from operations where id=?",(opid,)).fetchone(),("done",))
            self.assertEqual(copy.execute("select enabled from alert_settings where kind='topup'").fetchone(),(0,))
            self.assertTrue({"state","flow","operations","alert_settings","alert_log"}<={
                r[0] for r in copy.execute("select name from sqlite_master where type='table'")
            })
        self.assertEqual(len(backup.list_backups(self.backups)),1)
        self.assertEqual({x.name for x in self.backups.iterdir()},{backup_path.name})

    def test_retention_keeps_only_requested_newest(self):
        first=backup.create_backup(self.path,self.backups,keep=2)
        time.sleep(.01)
        second=backup.create_backup(self.path,self.backups,keep=2)
        time.sleep(.01)
        third=backup.create_backup(self.path,self.backups,keep=2)
        found=backup.list_backups(self.backups)
        self.assertEqual(len(found),2)
        self.assertIn(third,found)
        self.assertIn(second,found)
        self.assertFalse(first.exists())
        self.assertTrue(self.path.exists())

    def test_failed_backup_preserves_existing_copy_and_local_state(self):
        good=backup.create_backup(self.path,self.backups)
        invalid=self.root/"bad.sqlite3"
        invalid.write_bytes(b"not a sqlite database")
        with self.assertRaises((sqlite3.Error,RuntimeError)):
            backup.create_backup(invalid,self.backups,keep=1)
        self.assertTrue(good.exists())
        self.assertEqual(len(backup.list_backups(self.backups)),1)
        self.assertFalse(any(x.name.endswith(".tmp") for x in self.backups.iterdir()))

    def test_symlink_destination_is_rejected_before_mode_changes(self):
        other=self.root/"outside"
        other.mkdir(mode=0o755)
        other.chmod(0o755)
        link=self.root/"backups-link"
        link.symlink_to(other,target_is_directory=True)
        with self.assertRaises(ValueError):
            backup.create_backup(self.path,link)
        self.assertEqual(other.stat().st_mode&0o777,0o755)
        self.assertEqual(list(other.iterdir()),[])

    def test_invalid_source_retention_range_and_no_token_copy(self):
        env=self.root/".env"
        env.write_text("BOT_TOKEN=very-sensitive-test-token")
        with self.assertRaises(ValueError):
            backup.create_backup(self.path,self.backups,keep=0)
        backup_path=backup.create_backup(self.path,self.backups)
        self.assertNotIn(b"BOT_TOKEN",backup_path.read_bytes())
        self.assertFalse((self.backups/".env").exists())
        self.assertEqual(env.read_text(),"BOT_TOKEN=very-sensitive-test-token")

    def test_only_owner_may_request_backup_via_telegram(self):
        fake=FakeTG()
        api=FakeBackend()
        service=bot.AdminBot(fake,api,self.db,ADMIN)
        def cb(sender,data):
            service.on_callback({
                "id":"test","from":{"id":sender},
                "message":{"chat":{"id":sender,"type":"private"},"message_id":41},
                "data":data
            })
        cb(ADMIN+2,"backup:make")
        cb(ADMIN+2,"backup:status")
        self.assertFalse(self.backups.exists())
        cb(ADMIN,"backup:status")
        self.assertIn("النسخ الاحتياطي لحالة البوت",fake.edits[-1][2])
        cb(ADMIN,"backup:make")
        self.assertTrue(any("أُنشئت نسخة احتياطية" in x[1] for x in fake.messages))
        self.assertEqual(len(backup.list_backups(self.backups)),1)
        self.assertNotIn("wallet_adjust",[a for a,_ in api.actions])
        cb(ADMIN,"settings")
        self.assertIn("backup:status",str(fake.edits[-1][3]))


if __name__=="__main__":
    unittest.main(verbosity=2)
