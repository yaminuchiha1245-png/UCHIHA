from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import aiosqlite

from client_api_purchase_runtime import _mark_uncertain, _refund_failed
from client_purchase_adapter import PurchaseResult


class DummyStore:
    def __init__(self, db_path: str) -> None:
        self.DB_PATH = db_path


class ApiPurchaseSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.tmp.name) / "store.db")
        self.store = DummyStore(self.db_path)
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("CREATE TABLE users(user_id INTEGER PRIMARY KEY,balance REAL DEFAULT 0)")
            await db.execute(
                """
                CREATE TABLE orders(
                    id INTEGER PRIMARY KEY,
                    status TEXT,
                    payment_state TEXT
                )
                """
            )
            await db.execute(
                """
                CREATE TABLE balance_logs(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    amount REAL,
                    type TEXT,
                    reason TEXT,
                    date TEXT,
                    admin_id INTEGER
                )
                """
            )
            await db.execute(
                """
                CREATE TABLE client_api_order_links(
                    local_order_id INTEGER PRIMARY KEY,
                    external_order_id TEXT DEFAULT '',
                    provider_status TEXT DEFAULT '',
                    raw_response TEXT DEFAULT '',
                    last_error TEXT DEFAULT '',
                    refund_applied INTEGER DEFAULT 0,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            await db.execute("INSERT INTO users(user_id,balance) VALUES(1,90)")
            await db.execute("INSERT INTO orders(id,status,payment_state) VALUES(10,'processing','paid')")
            await db.execute("INSERT INTO client_api_order_links(local_order_id,provider_status) VALUES(10,'reserved')")
            await db.commit()

    async def asyncTearDown(self) -> None:
        self.tmp.cleanup()

    async def _balance(self) -> float:
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute("SELECT balance FROM users WHERE user_id=1") as cursor:
                return float((await cursor.fetchone())[0])

    async def test_uncertain_result_keeps_funds_reserved(self) -> None:
        result = PurchaseResult(
            False,
            error="timeout",
            raw_response="",
            failure_is_definitive=False,
        )
        await _mark_uncertain(self.store, 10, result)
        self.assertEqual(await self._balance(), 90.0)
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute("SELECT status,payment_state FROM orders WHERE id=10") as cursor:
                order = await cursor.fetchone()
            async with db.execute("SELECT provider_status,refund_applied FROM client_api_order_links WHERE local_order_id=10") as cursor:
                link = await cursor.fetchone()
        self.assertEqual(order, ("processing", "paid"))
        self.assertEqual(link, ("uncertain", 0))

    async def test_definitive_rejection_refunds_exactly_once(self) -> None:
        result = PurchaseResult(
            False,
            provider_status="rejected",
            error="rejected",
            failure_is_definitive=True,
        )
        first = await _refund_failed(self.store, order_id=10, user_id=1, price=10, result=result)
        second = await _refund_failed(self.store, order_id=10, user_id=1, price=10, result=result)
        self.assertTrue(first)
        self.assertFalse(second)
        self.assertEqual(await self._balance(), 100.0)
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute("SELECT status,payment_state FROM orders WHERE id=10") as cursor:
                order = await cursor.fetchone()
            async with db.execute("SELECT refund_applied FROM client_api_order_links WHERE local_order_id=10") as cursor:
                refund = int((await cursor.fetchone())[0])
            async with db.execute("SELECT COUNT(*) FROM balance_logs WHERE type='refund'") as cursor:
                refund_logs = int((await cursor.fetchone())[0])
        self.assertEqual(order, ("cancelled", "refunded"))
        self.assertEqual(refund, 1)
        self.assertEqual(refund_logs, 1)


if __name__ == "__main__":
    unittest.main()
