import asyncio
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import storefront_management as management


class FakeCore:
    def __init__(self, path: str):
        self._path = Path(path)

    def db_path(self):
        return self._path

    @staticmethod
    def now_text():
        return "2026-07-24 12:00:00"


class ManagementTests(unittest.TestCase):
    def test_exchange_rates_are_normalized(self):
        rates = management.parse_exchange_rates(
            '{"try": 34.5, "SYP": "13000", "bad": 0}',
            "USD",
        )
        self.assertEqual(rates["USD"], 1.0)
        self.assertEqual(rates["TRY"], 34.5)
        self.assertEqual(rates["SYP"], 13000.0)
        self.assertNotIn("BAD", rates)

    def test_customer_html_gets_branding_manifest_and_policies(self):
        fixture = '<html><head><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/app-icon.svg"><style></style></head><body><img src="/app-icon.svg"></body></html>'
        patched = management.patch_storefront_html(fixture)
        self.assertIn('/manifest-dynamic.webmanifest', patched)
        self.assertIn('/v1/storefront/branding/icon', patched)
        self.assertIn('/v1/storefront/branding/logo', patched)
        self.assertIn('uchiha-policy-links', patched)
        self.assertIn('/policies/refund', patched)

    def test_admin_html_gets_product_and_management_views(self):
        fixture = '''<html><style></style><body><button class="nav-btn" data-view="categories">▦ الأقسام</button><div class="content">      </div>\n    </main><script>const state={};function showView(name){const names={customers:'العملاء والأرصدة'};if(name==='customers')loadCustomers()}  </script></body></html>'''
        patched = management.patch_admin_html(fixture)
        self.assertIn('data-view="products"', patched)
        self.assertIn('data-page="management"', patched)
        self.assertIn('loadManagedProducts', patched)
        self.assertIn('saveManagementSettings', patched)
        self.assertIn('data-save-brand', patched)

    def test_schema_is_additive_and_seeds_defaults(self):
        async def run():
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "store.db"
                with sqlite3.connect(path) as db:
                    db.execute(
                        "CREATE TABLE storefront_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT '')"
                    )
                    db.execute("CREATE TABLE products (id INTEGER PRIMARY KEY,name TEXT)")
                    db.execute("INSERT INTO products(id,name) VALUES (7,'Keep me')")
                    db.commit()
                core = FakeCore(str(path))
                await management.ensure_management_schema(core)
                with sqlite3.connect(path) as db:
                    tables = {
                        row[0]
                        for row in db.execute(
                            "SELECT name FROM sqlite_master WHERE type='table'"
                        )
                    }
                    product = db.execute(
                        "SELECT name FROM products WHERE id=7"
                    ).fetchone()[0]
                    settings = dict(
                        db.execute(
                            "SELECT key,value FROM storefront_settings"
                        ).fetchall()
                    )
                self.assertIn("storefront_product_overrides", tables)
                self.assertIn("storefront_branding", tables)
                self.assertEqual(product, "Keep me")
                self.assertIn("privacy_policy", settings)
                self.assertIn("exchange_rates_json", settings)

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
