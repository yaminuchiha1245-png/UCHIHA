"""Read-only V1-83 bot/backend/Mini App contract checks.

These source-level regression checks catch a deleted route before release.
They neither start the API nor call Telegram or a production server.
"""
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
BOT = Path(__file__).resolve().parent
WEB = ROOT / "apps/provider-v183-runtime/runtime.js"
API = ROOT / "apps/api/src/app.js"


class MergedContract(unittest.TestCase):
    def test_every_static_bot_webapp_destination_is_supported(self):
        """All visible native-bot WebApp links must resolve in the same V1-83 UI."""
        js = WEB.read_text(encoding="utf-8")
        mapping = js.split("const miniAppDestinations=Object.freeze({", 1)[1].split("});", 1)[0]
        route_keys = {
            quoted or bare
            for quoted, bare in re.findall(
                r"(?:'([^']+)'|([a-z][a-z0-9-]*))\s*:\s*\[", mapping
            )
        }
        sources = "\n".join(
            (BOT / filename).read_text(encoding="utf-8")
            for filename in ("v183_screens.py", "v183_member_routers.py",
                             "v183_member_workflows.py")
        )
        linked = set(re.findall(r"\broute\s*=\s*['\"]([^'\"]+)['\"]", sources))
        self.assertTrue(linked, "Bot WebApp route extraction failed")
        self.assertFalse(linked - route_keys,
                         f"Bot buttons link to absent Mini App pages: {linked - route_keys}")
        self.assertTrue({"dashboard", "connect-mikrotik", "site-agent",
                         "subscribers", "invoices"}.issubset(route_keys))

    def test_device_deeplink_requires_authenticated_tenant_device(self):
        js = WEB.read_text(encoding="utf-8")
        self.assertIn("miniAppParams.get('deviceId')", js)
        self.assertIn("state.devices.some(row=>row.id===requestedDeviceId)", js)
        self.assertIn("data-v183-direct-connect", js)
        self.assertIn("miniAppRouteConsumed", js)
        self.assertIn("state.initialLiveReady", js)

    def test_native_bot_routes_still_exist_in_shared_api(self):
        js = API.read_text(encoding="utf-8")
        endpoints = {
            "get": ("auth/me", "subscribers", "subscribers/:id",
                    "invoices", "devices", "devices/connection-diagnostics",
                    "devices/direct-capabilities"),
            "post": ("auth/telegram", "auth/telegram-link/claim",
                     "subscribers", "invoices/:id/payments", "devices"),
        }
        for method, paths in endpoints.items():
            for path in paths:
                with self.subTest(method=method, path=path):
                    self.assertIn(f'app.{method}("/api/v1/{path}"', js)
        self.assertIn('idempotent(request, reply, "POST:/subscribers"', js)
        self.assertIn('POST:/invoices/${request.params.id}/payments', js)

    def test_collector_access_matches_server_permissions(self):
        contract = (ROOT / "packages/contracts/src/index.js").read_text(encoding="utf-8")
        collector = contract.split("collector: [", 1)[1].split("viewer: [", 1)[0]
        self.assertNotIn("PERMISSIONS.SESSION_READ", collector)
        self.assertIn("PERMISSIONS.BILLING_READ", collector)
        self.assertIn("PERMISSIONS.BILLING_WRITE", collector)
        bot = (BOT / "v183_screens.py").read_text(encoding="utf-8")
        self.assertIn('if role != "collector":', bot)
        self.assertIn('rows[0].append(self.btn("🌐 الجلسات"', bot)


if __name__ == "__main__":
    unittest.main()
