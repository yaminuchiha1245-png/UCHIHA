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
from provider_store import Access, ProviderStore
from provider_api import Handler
from site_routing import decode_route, encode_route, sanitize_routes
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
        self.assertTrue(self.store.plan_owned(self.a1,plan["id"]))
        self.assertTrue(self.store.plan_owned(self.a1,"Home"))
        self.assertFalse(self.store.plan_owned(self.a2,plan["id"]))

    def test_router_requires_private_ipv4(self):
        self.store.create_router(self.a1,{"name":"MT1","code":"MT1","management_ip":"192.168.88.1"})
        with self.assertRaises(ValueError):
            self.store.create_router(self.a1,{"name":"Bad","code":"Bad","management_ip":"8.8.8.8"})

    def test_site_agent_is_bound_to_provider_router(self):
        router=self.store.create_router(self.a1,{"name":"MT1","code":"MT1","management_ip":"192.168.88.1"})
        issued=self.store.issue_site_agent(self.a1,router["id"])
        agent=self.store.resolve_site_agent(issued["token"])
        self.assertIsNotNone(agent)
        self.assertEqual(agent.provider_id,self.a1.provider_id)
        self.assertEqual(agent.router_id,router["id"])
        self.assertFalse(self.store.site_agent_status(self.a2,router["id"])["registered"])

        command=self.store.queue_site_agent_command(self.a1.provider_id,router["id"],"review",{"session":{"user":"alice"}})
        claimed=self.store.poll_site_agent(agent)
        self.assertEqual(claimed["id"],command)
        self.assertTrue(self.store.finish_site_agent_command(agent,command,{"ok":True,"effect":"reviewed"}))
        result=self.store.site_agent_command_result(self.a1.provider_id,command)
        self.assertEqual(result["status"],"completed")
        self.assertEqual(result["result"]["effect"],"reviewed")


class ProviderBoundaryTests(unittest.TestCase):
    def test_roles_are_mapped_to_v37_roles(self):
        self.assertEqual(Handler.gateway_role(Access("P",1,"owner","")), "owner")
        self.assertEqual(Handler.gateway_role(Access("P",1,"admin","")), "operator")
        self.assertEqual(Handler.gateway_role(Access("P",1,"operator","")), "operator")
        self.assertEqual(Handler.gateway_role(Access("P",1,"viewer","")), "auditor")

    def test_global_connector_ledgers_are_not_exposed(self):
        self.assertTrue(Handler.connector_read_allowed("/api/connectors/radius/health"))
        self.assertTrue(Handler.connector_read_allowed("/api/connectors/radius/production-readiness"))
        self.assertFalse(Handler.connector_read_allowed("/api/connectors/radius/requests"))
        self.assertFalse(Handler.connector_read_allowed("/api/connectors/radius/audit"))
        self.assertFalse(Handler.connector_read_allowed("/api/connectors/radius/commands"))

    def test_only_provider_safe_connector_writes_are_allowed(self):
        self.assertEqual(Handler.connector_write_kind("/api/connectors/radius"), "session")
        self.assertEqual(Handler.connector_write_kind("/api/connectors/radius/node-status"), "node-status")
        self.assertEqual(Handler.connector_write_kind("/api/connectors/radius/voucher-batches"), "voucher")
        self.assertEqual(Handler.connector_write_kind("/api/connectors/radius/commands/CMD-1/retry"), "owned-command")
        self.assertIsNone(Handler.connector_write_kind("/api/connectors/radius/backups"))

    def test_telegram_namespace_normalizes_without_touching_main_api(self):
        self.assertEqual(Handler.normalize_path("/telegram-api/catalog"),"/api/catalog")
        self.assertEqual(Handler.normalize_path("/telegram-api/connectors/radius/health"),"/api/connectors/radius/health")
        self.assertEqual(Handler.normalize_path("/api/catalog"),"/api/catalog")

    def test_site_route_round_trip_and_sanitization(self):
        value=encode_route("ISP-ABC","NODE-XYZ","MTK:A")
        self.assertEqual(decode_route(value),("ISP-ABC","NODE-XYZ","MTK:A"))
        self.assertEqual(sanitize_routes({"nas":value,"nested":[value]}),{"nas":"MTK:A","nested":["MTK:A"]})


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
