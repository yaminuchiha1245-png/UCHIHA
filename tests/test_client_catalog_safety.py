from __future__ import annotations

import os
import tempfile
import unittest
from types import SimpleNamespace

import aiosqlite

from client_catalog_safety import _effective_catalog_price, quarantine_invalid_priced_products


class ClientCatalogSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        handle = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        handle.close()
        self.db_path = handle.name
        self.store = SimpleNamespace(DB_PATH=self.db_path)
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                CREATE TABLE client_provider_products(
                    id INTEGER PRIMARY KEY,
                    sale_price REAL DEFAULT 0,
                    provider_price REAL DEFAULT 0,
                    status TEXT DEFAULT 'unorganized',
                    is_active INTEGER DEFAULT 1
                )
                """
            )
            await db.executemany(
                "INSERT INTO client_provider_products(id,sale_price,provider_price,status,is_active) VALUES(?,?,?,?,?)",
                [
                    (1, 0, 0, "organized", 1),
                    (2, 0, 4.5, "organized", 1),
                    (3, 9.0, 4.5, "organized", 1),
                    (4, 0, 0, "unorganized", 1),
                ],
            )
            await db.commit()

    async def asyncTearDown(self) -> None:
        try:
            os.unlink(self.db_path)
        except OSError:
            pass

    async def test_effective_price_prefers_sale_then_provider(self) -> None:
        self.assertEqual(await _effective_catalog_price(self.store, 1), 0.0)
        self.assertEqual(await _effective_catalog_price(self.store, 2), 4.5)
        self.assertEqual(await _effective_catalog_price(self.store, 3), 9.0)
        self.assertIsNone(await _effective_catalog_price(self.store, 999))

    async def test_only_organized_zero_price_rows_are_quarantined(self) -> None:
        changed = await quarantine_invalid_priced_products(self.store)
        self.assertGreaterEqual(changed, 1)
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute("SELECT id,is_active FROM client_provider_products ORDER BY id") as cursor:
                rows = await cursor.fetchall()
        self.assertEqual(rows, [(1, 0), (2, 1), (3, 1), (4, 1)])


if __name__ == "__main__":
    unittest.main()
