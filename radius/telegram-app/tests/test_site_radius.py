from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from site_radius_db import SiteRadiusDB


class SiteRadiusTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "site-radius.sqlite3"
        self.db = SiteRadiusDB(self.db_path)
        self.db.sync(
            {
                "providerId": "ISP-TEST",
                "router": {
                    "id": "NODE-1",
                    "code": "MT-1",
                    "name": "Lab",
                    "managementIp": "192.168.88.1",
                },
                "accounts": [
                    {
                        "subscriberId": "SUB-1",
                        "username": "alice",
                        "password": "AliceRadius9",
                        "status": "active",
                        "planId": "PLAN-1",
                        "planName": "Home 50",
                        "downloadMbps": 50,
                        "uploadMbps": 10,
                        "quotaGb": 0,
                    }
                ],
            }
        )

    def tearDown(self):
        self.tmp.cleanup()

    def load_radius_module(self):
        fake = types.ModuleType("radiusd")
        fake.RLM_MODULE_OK = 2
        fake.RLM_MODULE_NOTFOUND = 7
        sys.modules["radiusd"] = fake
        os.environ["UCHIHA_SITE_RADIUS_DB"] = str(self.db_path)
        spec = importlib.util.spec_from_file_location(
            "freeradius_uchiha_test",
            ROOT / "freeradius_uchiha.py",
        )
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module, fake

    def test_sync_and_lookup(self):
        item = self.db.account("alice")
        self.assertIsNotNone(item)
        self.assertEqual(item["plan_name"], "Home 50")
        self.assertEqual(item["download_mbps"], 50)
        self.assertIsNone(self.db.account("missing"))

    def test_authorize_supplies_known_credential_and_rate(self):
        module, fake = self.load_radius_module()
        result = module.authorize(
            {
                "request": (("User-Name", "alice"),),
                "reply": (),
                "config": (),
                "session-state": (),
                "proxy-request": (),
                "proxy-reply": (),
            }
        )
        self.assertEqual(result[0], fake.RLM_MODULE_OK)
        update = result[1]
        self.assertIn(("Cleartext-Password", ":=", "AliceRadius9"), update["config"])
        self.assertIn(("Mikrotik-Rate-Limit", ":=", "50M/10M"), update["reply"])

    def test_authorize_rejects_unknown_account(self):
        module, fake = self.load_radius_module()
        result = module.authorize(
            {
                "request": (("User-Name", "nobody"),),
                "reply": (),
                "config": (),
                "session-state": (),
                "proxy-request": (),
                "proxy-reply": (),
            }
        )
        self.assertEqual(result, fake.RLM_MODULE_NOTFOUND)


if __name__ == "__main__":
    unittest.main()
