#!/usr/bin/env python3
"""Offline regression checks: no provider calls or production state are used."""
import hashlib
import hmac
import json
import pathlib
import tempfile
import time
import unittest
from unittest import mock

import cloud_monitor as cm


class CloudMonitorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = mock.patch.object(cm, "DB", pathlib.Path(self.temp.name) / "cloud.sqlite3")
        self.db.start()
        self.addCleanup(self.db.stop)
        self.project = mock.patch.object(cm, "get_project", return_value={"id": "test-app"})
        self.project.start()
        self.addCleanup(self.project.stop)

    def test_link_registry_has_no_fabricated_metrics(self):
        key = cm.add_link("test-app", "supabase", "abc123test")
        view = cm.snapshot(key)
        self.assertEqual(view["metrics"], {})
        self.assertEqual(view["limits"], {})
        self.assertIsNone(view["fixed_usd"])
        self.assertIsNone(view["active_devices_15m"])
        self.assertTrue(cm.remove_link(key))
        self.assertIsNone(cm.get_link(key))

    def test_project_and_provider_input_validation(self):
        with self.assertRaises(ValueError):
            cm.add_link("../secret", "supabase", "abc123test")
        with self.assertRaises(ValueError):
            cm.add_link("test-app", "unknown", "abc123test")
        with self.assertRaises(ValueError):
            cm.add_link("test-app", "firebase", "http://evil-host")
        key = cm.add_link("test-app", "firebase", "gcp-test")
        with self.assertRaises(ValueError):
            cm.add_link("test-app", "firebase", "gcp-test")
        with self.assertRaises(ValueError):
            cm.change_link(key, fixed_usd=-1)

    def test_thresholds_are_measured_not_guessed(self):
        key = cm.add_link("test-app", "firebase", "gcp-test")
        cm.set_limit(key, "rtdb_monthly_egress", 1000)
        with cm.connect() as db:
            stamp = int(time.time())
            db.execute("""INSERT INTO samples(link_id,metric,value,unit,period,source,at,epoch)
                           VALUES(?,?,?,?,?,?,?,?)""",
                       (key, "rtdb_monthly_egress", 850, "bytes", "latest",
                        "google-cloud-monitoring", cm.iso(), stamp))
            db.commit()
        warnings = cm.cloud_alerts()
        self.assertEqual(len(warnings), 1)
        self.assertIn("85", warnings[0]["detail"])
        cm.change_link(key, alerts=False)
        self.assertEqual(cm.cloud_alerts(), [])

    def test_invalid_heartbeat_signature_rejected(self):
        body = json.dumps({"projectId":"test-app", "deviceId":"a", "sync":"ok"}).encode()
        now = str(int(time.time()))
        with mock.patch.object(cm, "_secret", return_value="secret-for-test"):
            self.assertIsNone(cm.verify_heartbeat(body, now, "wrong"))
            digest = hmac.new(b"secret-for-test", now.encode()+b"."+body, hashlib.sha256).hexdigest()
            self.assertEqual(cm.verify_heartbeat(body, now, digest), ("test-app", "a", "ok"))
            self.assertIsNone(cm.verify_heartbeat(body, str(int(now)-1000), digest))

    def test_heartbeat_reports_devices_only_after_actual_calls(self):
        key = cm.add_link("test-app", "other", "custom-db")
        with mock.patch.object(cm, "_secret", return_value="secret-for-test"):
            cm.record_heartbeat("test-app", "device-01", "ok")
            cm.record_heartbeat("test-app", "device-02", "error")
        view = cm.snapshot(key)
        self.assertEqual(view["active_devices_15m"], 2)
        self.assertEqual(view["sync"]["state"], "error")
        self.assertTrue(any("مزامنة" in x["detail"] for x in cm.cloud_alerts()))

    def test_supabase_vendor_window_is_not_monthly_quota(self):
        key = cm.add_link("test-app", "supabase", "abc123test")
        with mock.patch.object(cm, "_secret", return_value="fake-test-token"), mock.patch.object(
                cm, "_json_get", side_effect=[{"id":"abc123test"}, {"result":[{"count":120}]}]):
            self.assertTrue(cm.sample_link(key, force=True))
        view = cm.snapshot(key)
        measured = view["metrics"]["api_requests_window"]
        self.assertEqual(measured["value"], 120)
        self.assertEqual(measured["period"], "provider-window")
        cm.set_limit(key, "api_requests_window", 100)
        self.assertEqual(cm.cloud_alerts(), [])

    def test_reports_do_not_sum_snapshots_as_total_usage(self):
        key = cm.add_link("test-app", "other", "custom-db")
        now = int(time.time())
        with cm.connect() as db:
            for value in (30, 60):
                db.execute("""INSERT INTO samples(link_id,metric,value,unit,period,source,at,epoch)
                              VALUES(?,?,?,?,?,?,?,?)""",
                           (key, "db_bytes", value, "bytes", "latest", "internal-test", cm.iso(), now))
            db.commit()
        report = cm.usage_report(1)["samples"]
        self.assertEqual(report[0]["low"], 30)
        self.assertEqual(report[0]["high"], 60)
        self.assertNotIn("total", report[0])


if __name__ == "__main__":
    unittest.main()
