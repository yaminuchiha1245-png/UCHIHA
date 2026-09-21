from __future__ import annotations

import hashlib
import hmac
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.parse import urlencode

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

from build_telegram_webapp import harden_runtime, replace_demo_arrays
from provider_store import ProviderStore
from telegram_auth import TelegramAuthError, verify_init_data


def signed(token: str,user_id: int,ts: int) -> str:
    values={"auth_date":str(ts),"query_id":"AA-test","user":json.dumps({"id":user_id,"first_name":"Test"},separators=(",",":"))}
    check="\n".join(f"{key}={values[key]}" for key in sorted(values))
    secret=hmac.new(b"WebAppData",token.encode(),hashlib.sha256).digest()
    values["hash"]=hmac.new(secret,check.encode(),hashlib.sha256).hexdigest()
    return urlencode(values)


class TelegramAuthTests(unittest.TestCase):
    def test_signature_and_expiry(self):
        token="123:abc"; ts=int(time.time())
        self.assertEqual(verify_init_data(signed(token,77,ts),token,now=ts).user_id,77)
        with self.assertRaises(TelegramAuthError):
            verify_init_data(signed(token,77,ts-901),token,now=ts,max_age_seconds=900)

    def test_tamper(self):
        token="123:abc"; ts=int(time.time())
        with self.assertRaises(TelegramAuthError):
            verify_init_data(signed(token,77,ts).replace("Test","Other"),token,now=ts)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.store=ProviderStore(Path(self.tmp.name)/"db.sqlite3")
        self.store.bootstrap_owner(101,provider_name="P1",provider_code="P1")
        self.store.bootstrap_owner(202,provider_name="P2",provider_code="P2")
        self.a1=self.store.resolve_telegram(101); self.a2=self.store.resolve_telegram(202)
        assert self.a1 and self.a2

    def tearDown(self): self.tmp.cleanup()

    def test_tenant_isolation(self):
        plan=self.store.create_plan(self.a1,{"name":"Home","download_mbps":50,"upload_mbps":10,"quota_gb":0,"duration_days":30,"price":20})
        self.store.create_subscriber(self.a1,{"full_name":"Alice User","username":"alice","plan_id":plan["id"]})
        self.assertEqual(len(self.store.list_subscribers(self.a1)),1)
        self.assertEqual(len(self.store.list_subscribers(self.a2)),0)
        self.assertEqual(self.store.dashboard(self.a1)["totals"]["subscribers"],1)
        self.assertEqual(self.store.dashboard(self.a2)["totals"]["subscribers"],0)

    def test_router_requires_private_ipv4(self):
        self.store.create_router(self.a1,{"name":"MT1","code":"MT1","management_ip":"192.168.88.1"})
        with self.assertRaises(ValueError):
            self.store.create_router(self.a1,{"name":"Bad","code":"Bad","management_ip":"8.8.8.8"})


class BuilderTests(unittest.TestCase):
    def test_demo_and_simulation_removed(self):
        fixture=('x jN=[{recordId:"ISP-DEMO-001"}],vN=[{recordId:"SUB-DEMO-001"}],gl=[{id:"SES-DEMO-001"}];function lR('
                 'x){window.__uchihaStorageMode="local";}'
                 'function z(){const v=lApplySessionRequest(o,u),g=lConnEntry({id:p,adapter:"preview",status:"simulated"});return{...v}}async function lVoucherProvision(x){}'
                 'function n(){return lConnEntry({id:u,adapter:"preview",endpoint:c,operation:"node-status",status:"simulated",nodeCode:n,nodeStatus:t,affectedSessions:o?.affected??0,disconnectedSessions:o?.disconnected??0,contractVersion:"1.0"})}')
        value=replace_demo_arrays(fixture)
        self.assertNotIn("ISP-DEMO",value)
        value=harden_runtime(value)
        self.assertIn("provider backend unavailable",value)
        self.assertNotIn('status:"simulated"',value)


if __name__=="__main__":
    unittest.main()
