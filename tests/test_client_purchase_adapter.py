from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import aiosqlite

from client_purchase_adapter import _build_payload, _csv_set, _read_path, ensure_purchase_schema


class DummyStore:
    def __init__(self, db_path: str) -> None:
        self.DB_PATH = db_path


class PurchaseAdapterPureTests(unittest.TestCase):
    def test_nested_response_paths(self) -> None:
        payload = {"data": {"order": {"id": "A-42", "status": "pending"}}}
        self.assertEqual(_read_path(payload, "data.order.id"), "A-42")
        self.assertEqual(_read_path(payload, "data.order.status"), "pending")
        self.assertIsNone(_read_path(payload, "data.missing.id"))

    def test_payload_uses_only_configured_keys(self) -> None:
        payload = _build_payload(
            external_product_id="sku-1",
            customer_input="123456",
            quantity=2,
            product_key="service",
            input_key="player_id",
            quantity_key="qty",
        )
        self.assertEqual(payload, {"service": "sku-1", "player_id": "123456", "qty": 2})

        payload_without_optional = _build_payload(
            external_product_id="sku-2",
            customer_input="",
            quantity=1,
            product_key="service",
            input_key="",
            quantity_key="",
        )
        self.assertEqual(payload_without_optional, {"service": "sku-2"})

    def test_status_csv_normalization(self) -> None:
        self.assertEqual(_csv_set(" Success, pending ,DONE "), {"success", "pending", "done"})


class PurchaseAdapterSchemaTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.tmp.name) / "store.db")
        self.store = DummyStore(self.db_path)
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                CREATE TABLE users (
                    user_id INTEGER PRIMARY KEY,
                    username TEXT,
                    full_name TEXT,
                    balance REAL DEFAULT 0,
                    joined_date TEXT
                )
                """
            )
            await db.commit()
        await ensure_purchase_schema(self.store)

    async def asyncTearDown(self) -> None:
        self.tmp.cleanup()

    async def test_purchase_columns_default_to_disabled(self) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute("PRAGMA table_info(client_api_providers)") as cursor:
                columns = {row[1]: row for row in await cursor.fetchall()}
            async with db.execute("PRAGMA table_info(client_api_order_links)") as cursor:
                link_columns = {row[1] for row in await cursor.fetchall()}

        self.assertIn("purchase_enabled", columns)
        self.assertIn("purchase_path", columns)
        self.assertIn("purchase_method", columns)
        self.assertIn("purchase_payload_mode", columns)
        self.assertEqual(str(columns["purchase_enabled"][4]), "0")
        self.assertIn("request_token", link_columns)
        self.assertIn("raw_response", link_columns)


if __name__ == "__main__":
    unittest.main()
