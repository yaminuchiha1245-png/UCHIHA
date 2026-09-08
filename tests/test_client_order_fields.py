from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import aiosqlite

from client_order_fields import ensure_field_schema


class DummyStore:
    def __init__(self, db_path: str) -> None:
        self.DB_PATH = db_path


class ClientOrderFieldSchemaTests(unittest.IsolatedAsyncioTestCase):
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

    async def asyncTearDown(self) -> None:
        self.tmp.cleanup()

    async def test_order_field_columns_are_created_idempotently(self) -> None:
        await ensure_field_schema(self.store)
        await ensure_field_schema(self.store)
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute("PRAGMA table_info(client_provider_products)") as cursor:
                columns = {row[1] for row in await cursor.fetchall()}
        self.assertIn("customer_input_required", columns)
        self.assertIn("customer_input_label", columns)
        self.assertIn("customer_input_hint", columns)


if __name__ == "__main__":
    unittest.main()
