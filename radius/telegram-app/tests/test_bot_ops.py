from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

from credential_vault import CredentialVault
from v37_gateway import GatewayResponse


class FakeGateway:
    def __init__(self):
        self.calls=[]

    def request(self,method,target,*,actor,role,payload=None):
        self.calls.append({
            "method":method,
            "target":target,
            "actor":actor,
            "role":role,
            "payload":payload,
        })
        body={
            "ok":True,
            "status":"queued",
            "commandId":"CMD-BOT-TEST-001",
            "requestId":payload.get("requestId") if isinstance(payload,dict) else None,
        }
        return GatewayResponse(
            status=202,
            headers={"content-type":"application/json"},
            body=json.dumps(body,separators=(",",":")).encode(),
        )


class BotOpsTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        root=Path(self.tmp.name)
        key=root/"credential.key"
        key.write_bytes(CredentialVault.generate_key()+b"\n")
        key.chmod(0o600)
        env={
            "TELEGRAM_BOT_TOKEN":"123456:TEST",
            "UCHIHA_RADIUS_PROVIDER_DB":str(root/"provider.sqlite3"),
            "UCHIHA_RADIUS_CREDENTIAL_KEY_FILE":str(key),
            "UCHIHA_RADIUS_OWNER_TELEGRAM_ID":"101",
            "UCHIHA_RADIUS_DEFAULT_PROVIDER_NAME":"Bot ISP",
            "UCHIHA_RADIUS_DEFAULT_PROVIDER_CODE":"BOTISP",
            "UCHIHA_RADIUS_V37_BASE_URL":"http://127.0.0.1:8792",
            "UCHIHA_RADIUS_V37_HMAC_SECRET":"x"*48,
            "UCHIHA_RADIUS_V37_HMAC_KEY_ID":"telegram-provider",
        }
        self.env=patch.dict(os.environ,env,clear=False)
        self.env.start()
        spec=importlib.util.spec_from_file_location("radius_bot_test",ROOT/"bot.py")
        self.bot=importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(self.bot)
        self.access=self.bot.STORE.resolve_telegram(101)
        assert self.access is not None
        self.gateway=FakeGateway()
        self.bot.V37=self.gateway

        plan=self.bot.STORE.create_plan(self.access,{
            "name":"Home 50",
            "download_mbps":50,
            "upload_mbps":10,
            "quota_gb":0,
            "duration_days":30,
            "price":20,
        })
        self.bot.STORE.create_subscriber(self.access,{
            "full_name":"Alice Example",
            "username":"alice",
            "plan_id":plan["id"],
        })
        router=self.bot.STORE.create_router(self.access,{
            "name":"MikroTik Lab",
            "code":"MT-LAB",
            "management_ip":"192.168.88.1",
            "region":"LAB",
        })
        issued=self.bot.STORE.issue_site_agent(self.access,router["id"])
        agent=self.bot.STORE.resolve_site_agent(issued["token"])
        assert agent is not None
        self.bot.STORE.sync_site_sessions(agent,[{
            "externalId":"pppoe:*1",
            "username":"alice",
            "framedIp":"10.0.0.2",
            "accessKind":"PPPoE",
            "startedAt":int(time.time())-120,
            "inputOctets":1000,
            "outputOctets":2000,
        }])
        self.session=self.bot.STORE.list_sessions(self.access)[0]

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_disconnect_is_provider_routed_and_signed_via_v37(self):
        ok,message=self.bot.execute_session_operation(
            self.access,
            self.session["id"],
            "disconnect",
        )
        self.assertTrue(ok)
        self.assertIn("CMD-BOT-TEST-001",message)
        self.assertEqual(len(self.gateway.calls),1)
        call=self.gateway.calls[0]
        self.assertEqual(call["target"],"/api/connectors/radius")
        self.assertEqual(call["role"],"owner")
        self.assertEqual(call["payload"]["operation"],"disconnect")
        self.assertEqual(call["payload"]["session"]["user"],"alice")
        self.assertTrue(call["payload"]["session"]["nas"].startswith("@U:"))
        self.assertTrue(self.bot.STORE.command_owned(self.access,"CMD-BOT-TEST-001"))

    def test_viewer_cannot_disconnect(self):
        self.bot.STORE.bootstrap_owner(
            202,
            provider_name="Other",
            provider_code="OTHER",
            display_name="Viewer",
        )
        # Rebind the second identity into the same provider as viewer for this test.
        with self.bot.STORE.conn() as db:
            db.execute(
                "UPDATE telegram_identities SET provider_id=?,role='viewer' WHERE telegram_user_id=?",
                (self.access.provider_id,202),
            )
        viewer=self.bot.STORE.resolve_telegram(202)
        assert viewer is not None
        ok,message=self.bot.execute_session_operation(
            viewer,
            self.session["id"],
            "disconnect",
        )
        self.assertFalse(ok)
        self.assertIn("صلاحيتك",message)
        self.assertEqual(len(self.gateway.calls),0)

    def test_session_buttons_require_confirmation(self):
        keyboard=self.bot.session_action_keyboard(self.session["id"],True)
        callbacks=[
            button["callback_data"]
            for row in keyboard["inline_keyboard"]
            for button in row
            if "callback_data" in button
        ]
        self.assertIn(f"sact:disconnect:{self.session['id']}",callbacks)
        confirm=self.bot.session_confirmation_keyboard("disconnect",self.session["id"])
        self.assertEqual(
            confirm["inline_keyboard"][0][0]["callback_data"],
            f"sconfirm:disconnect:{self.session['id']}",
        )


if __name__=="__main__":
    unittest.main()
