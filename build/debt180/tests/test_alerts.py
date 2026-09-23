"""Offline regression tests: alerts do not modify financial records."""
import sys
import tempfile
import unittest
from pathlib import Path

from test_bot import ADMIN, UID, TID, OID
import bot


class ReadOnlyFeed:
    def __init__(self):
        self.topups=[self.topup(TID)]
        self.orders=[self.order(OID)]
        self.calls=[]

    @staticmethod
    def topup(id_, label="أحمد", amount="60"):
        return {
            "id":id_,"label":label,"amount_requested":amount,
            "status":"pending","proof_data":"NOT_ALLOWED_IN_ALERT"
        }

    @staticmethod
    def order(id_, label="أحمد", name="بطاقة"):
        return {"id":id_,"label":label,"product_name":name,
                "amount":"8","status":"pending","fields":"PRIVATE_ORDER_INPUT"}

    def call(self,action,args=None):
        self.calls.append(action)
        assert action in ("topups","orders","topup_detail","order_detail"), "notification must be read-only"
        args=args or {}
        rows=self.topups if action=="topups" else self.orders
        if action=="topup_detail":
            item=next((x for x in self.topups if x["id"]==args.get("topup_id")),None)
            if not item:raise bot.ApiError("NOT_FOUND")
            return {"ok":True,"item":item}
        if action=="order_detail":
            item=next((x for x in self.orders if x["id"]==args.get("order_id")),None)
            if not item:raise bot.ApiError("NOT_FOUND")
            return {"ok":True,"item":item}
        if action=="topups":rows=[x for x in rows if x["status"]=="pending"]
        else:rows=[x for x in rows if x["status"] in ("pending","processing","unknown")]
        offset=int(args.get("offset",0))
        return {"ok":True,"items":rows[offset:offset+15]}


class AlertTG:
    def __init__(self):
        self.messages=[]
        self.edits=[]
        self.answers=[]
        self.fail_next=False

    def send(self,chat,text,rows=None):
        if self.fail_next:
            self.fail_next=False
            raise bot.TransportError("Telegram outage")
        self.messages.append((chat,text,rows or []))

    def edit(self,chat,mid,text,rows=None):
        self.edits.append((chat,mid,text,rows or []))

    def answer(self,*args):
        self.answers.append(args)


class AlertTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/"bot.sqlite3"
        self.db=bot.Storage(self.path)
        self.backend=ReadOnlyFeed()
        self.tg=AlertTG()
        self.service=bot.AdminBot(self.tg,self.backend,self.db,ADMIN)

    def cb(self,data,uid=ADMIN):
        self.service.on_callback({
            "id":"test_cb","from":{"id":uid},
            "message":{"chat":{"id":uid,"type":"private"},"message_id":99},
            "data":data
        })

    def test_baseline_avoids_historical_spam_and_notifies_new_requests(self):
        self.service.poll_alerts()
        self.assertEqual([],self.tg.messages)
        self.assertTrue(self.db.alert_setting("topup")["seeded"])
        self.assertTrue(self.db.alert_setting("order")["seeded"])
        self.assertEqual(self.db.db.execute("select count(*) from alert_log").fetchone()[0],2)
        new_topup="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        new_order="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        self.backend.topups.insert(0,self.backend.topup(new_topup))
        self.backend.orders.insert(0,self.backend.order(new_order))
        self.service.poll_alerts()
        self.assertEqual(len(self.tg.messages),2)
        self.assertEqual({m[0] for m in self.tg.messages},{ADMIN})
        self.assertTrue(any("topup:"+new_topup in str(m[2]) for m in self.tg.messages))
        self.assertTrue(any("order:"+new_order in str(m[2]) for m in self.tg.messages))
        self.service.poll_alerts()
        self.assertEqual(len(self.tg.messages),2)
        reopened=bot.Storage(self.path)
        try:
            self.service.poll_alerts(reopened)
            self.assertEqual(len(self.tg.messages),2)
        finally:reopened.close()

    def test_muting_skips_alerts_without_catchup_flood(self):
        self.service.poll_alerts()
        self.cb("alert_toggle:topup")
        self.assertFalse(self.db.alert_setting("topup")["enabled"])
        new_id="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        self.backend.topups.insert(0,self.backend.topup(new_id))
        self.service.poll_alerts()
        self.assertFalse(any("طلب شحن جديد" in m[1] for m in self.tg.messages))
        self.cb("alert_toggle:topup")
        self.assertTrue(self.db.alert_setting("topup")["enabled"])
        self.service.poll_alerts()
        self.assertFalse(any("طلب شحن جديد" in m[1] for m in self.tg.messages))
        later="dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        self.backend.topups.insert(0,self.backend.topup(later))
        self.service.poll_alerts()
        self.assertEqual(len([m for m in self.tg.messages if "طلب شحن جديد" in m[1]]),1)
        self.assertTrue(any("topup:"+later in str(m[2]) for m in self.tg.messages))

    def test_failed_telegram_delivery_retries_without_losing_alert(self):
        self.service.poll_alerts()
        item="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
        self.backend.topups.insert(0,self.backend.topup(item))
        self.tg.fail_next=True
        with self.assertRaises(bot.TransportError):
            self.service.poll_alerts()
        queued=self.db.pending_alerts("topup")
        self.assertEqual(queued,[item])
        self.service.poll_alerts()
        self.assertEqual(self.db.pending_alerts("topup"),[])
        self.assertEqual(len(self.tg.messages),1)
        self.service.poll_alerts()
        self.assertEqual(len(self.tg.messages),1)

    def test_shutdown_restart_preserves_alert_queue(self):
        self.service.poll_alerts()
        item="ffffffff-ffff-4fff-8fff-ffffffffffff"
        self.backend.orders.insert(0,self.backend.order(item))
        self.tg.fail_next=True
        with self.assertRaises(bot.TransportError):
            self.service.poll_alerts()
        self.db.close()
        restored=bot.Storage(self.path)
        self.service.db=restored
        self.service.poll_alerts()
        self.assertEqual(len(self.tg.messages),1)
        self.assertTrue(any("order:"+item in str(m[2]) for m in self.tg.messages))

    def test_alert_only_contains_summary_escapes_user_input(self):
        self.service.poll_alerts()
        item="12345678-1234-4234-8234-123456789abc"
        self.backend.orders.insert(0,self.backend.order(item,label="<b>اسم مزيف</b>",name="<script>secret</script>"))
        self.service.poll_alerts()
        text=self.tg.messages[0][1]
        self.assertIn("&lt;b&gt;",text)
        self.assertIn("&lt;script&gt;",text)
        self.assertNotIn("PRIVATE_ORDER_INPUT",text)

    def test_queued_alert_is_not_lost_when_pagination_moves_it_out(self):
        self.service.poll_alerts()
        queued="abcdefab-cdef-4abc-8def-abcdefabcdef"
        self.backend.topups.insert(0,self.backend.topup(queued))
        self.tg.fail_next=True
        with self.assertRaises(bot.TransportError):
            self.service.poll_alerts()
        # A burst pushes the previously queued alert past the list limit.
        for n in range(95):
            uid=f"cafe{n:04x}-cafe-4afe-8afe-{n:012x}"
            self.backend.topups.insert(0,self.backend.topup(uid))
        self.service.poll_alerts()
        self.assertTrue(any("topup:"+queued in str(m[2]) for m in self.tg.messages))
        state=self.db.db.execute(
            "select state from alert_log where kind='topup' and item_id=?",
            (queued,)).fetchone()
        self.assertEqual(state,("sent",))
        # The other burst requests remain safely queued for later checks.
        self.assertGreater(len(self.db.pending_alerts("topup")),0)

    def test_no_side_effects_on_financial_operations(self):
        self.service.poll_alerts()
        self.cb("alerts",uid=ADMIN+1)
        self.cb("alert_toggle:topup",uid=ADMIN+1)
        self.cb("alert_test",uid=ADMIN+1)
        self.assertTrue(self.db.alert_setting("topup")["enabled"])
        self.assertFalse(self.tg.messages)
        self.assertEqual({x for x in self.backend.calls},{"orders","topups"})

    def test_settings_visible_via_inline_buttons(self):
        self.service.poll_alerts()
        self.cb("alerts")
        self.assertIn("تنبيهات بوت الديون",self.tg.edits[-1][2])
        self.assertIn("alert_toggle:topup",str(self.tg.edits[-1][3]))
        self.cb("alert_test")
        self.assertTrue(any("اختبار التنبيهات" in m[1] for m in self.tg.messages))
        self.assertEqual({x for x in self.backend.calls},{"orders","topups"})

    def test_independent_worker_sqlite_connection_reads_toggle(self):
        worker_db=bot.Storage(self.path)
        try:
            self.service.poll_alerts(worker_db)
            self.db.set_alert_enabled("order",False)
            self.assertFalse(worker_db.alert_setting("order")["enabled"])
            self.assertEqual(self.db.db.execute("select count(*) from operations").fetchone()[0],0)
        finally:
            worker_db.close()


if __name__=="__main__":
    unittest.main(verbosity=2)
