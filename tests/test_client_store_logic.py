from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

import aiosqlite

from client_api_sync import _auth_request_parts, _decrypt_token, _extract_items, _price
from client_services_store import _encrypt, ensure_schema
from client_store_admin import _effective_price, ensure_admin_schema
from client_ui_refinement import _display_price


class DummyStore:
    def __init__(self, db_path: str) -> None:
        self.DB_PATH = db_path


class ClientStorePureTests(unittest.TestCase):
    def test_extract_items_from_nested_payload(self) -> None:
        payload = {"success": True, "data": {"products": [{"id": 1, "name": "Panel", "price": "12.50"}]}}
        items = _extract_items(payload)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["name"], "Panel")
        self.assertEqual(_price(items[0]["price"]), 12.5)

    def test_token_roundtrip_uses_local_key_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "store.db")
            key_path = str(Path(tmp) / "client.key")
            old = os.environ.get("CLIENT_STORE_MASTER_KEY_FILE")
            os.environ["CLIENT_STORE_MASTER_KEY_FILE"] = key_path
            try:
                store = DummyStore(db_path)
                cipher, fingerprint = _encrypt(store, "secret-provider-token")
                self.assertNotIn("secret-provider-token", cipher)
                self.assertEqual(len(fingerprint), 10)
                self.assertEqual(_decrypt_token(store, cipher), "secret-provider-token")
            finally:
                if old is None:
                    os.environ.pop("CLIENT_STORE_MASTER_KEY_FILE", None)
                else:
                    os.environ["CLIENT_STORE_MASTER_KEY_FILE"] = old

    def test_provider_auth_modes(self) -> None:
        headers, params = _auth_request_parts("bearer", "abc", "api_key")
        self.assertEqual(headers["Authorization"], "Bearer abc")
        self.assertNotIn("X-API-Key", headers)
        self.assertEqual(params, {})

        headers, params = _auth_request_parts("x_api_key", "abc", "api_key")
        self.assertEqual(headers["X-API-Key"], "abc")
        self.assertEqual(params, {})

        headers, params = _auth_request_parts("query", "abc", "token")
        self.assertEqual(params, {"token": "abc"})
        self.assertNotIn("Authorization", headers)

        headers, params = _auth_request_parts("none", "abc", "api_key")
        self.assertEqual(headers, {"Accept": "application/json"})
        self.assertEqual(params, {})

    def test_catalog_display_pricing(self) -> None:
        self.assertEqual(_display_price(100, 80, 0, rank="customer", discount=20), 100)
        self.assertEqual(_display_price(100, 80, 0, rank="reseller", discount=10), 90)
        self.assertEqual(_display_price(100, 80, 75, rank="reseller", discount=10), 75)


class ClientStoreAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.tmp.name) / "store.db")
        self.store = DummyStore(self.db_path)
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                CREATE TABLE users (
                    user_id INTEGER PRIMARY KEY,
                    username TEXT,
                    full_name TEXT,
                    balance REAL DEFAULT 0,
                    joined_date TEXT
                )
            """)
            await db.execute("""
                CREATE TABLE products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    category_id INTEGER,
                    name TEXT,
                    description TEXT,
                    price REAL,
                    stock INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    created_at TEXT,
                    product_type TEXT DEFAULT 'manual',
                    delivery_info TEXT DEFAULT '',
                    api_id INTEGER DEFAULT 0,
                    api_provider TEXT DEFAULT ''
                )
            """)
            await db.commit()
        await ensure_schema(self.store)
        await ensure_admin_schema(self.store)

    async def asyncTearDown(self) -> None:
        self.tmp.cleanup()

    async def test_schema_contains_client_catalog_extensions(self) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute("PRAGMA table_info(client_provider_products)") as cursor:
                columns = {row[1] for row in await cursor.fetchall()}
        self.assertIn("reseller_price", columns)
        self.assertIn("source_type", columns)
        self.assertIn("local_product_id", columns)

    async def test_reseller_discount_and_fixed_price(self) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT INTO users(user_id,balance,account_rank,reseller_discount) VALUES(1,100,'reseller',10)"
            )
            await db.commit()

        row = ("Example", 100.0, 80.0, 0.0, "ios", "files", "organized", 1, "manual", "manual", "", 1, 0, "Manual", 1)
        price, rank, discount = await _effective_price(self.store, 1, row)
        self.assertEqual(rank, "reseller")
        self.assertEqual(discount, 10.0)
        self.assertEqual(price, 90.0)

        row_fixed = ("Example", 100.0, 80.0, 75.0, "ios", "files", "organized", 1, "manual", "manual", "", 1, 0, "Manual", 1)
        price, rank, _ = await _effective_price(self.store, 1, row_fixed)
        self.assertEqual(rank, "reseller")
        self.assertEqual(price, 75.0)


if __name__ == "__main__":
    unittest.main()
