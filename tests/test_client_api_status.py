from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import aiosqlite

from client_api_status import StatusResult, _apply_status_result


class DummyStore:
    def __init__(self, db_path: str) -> None:
        self.DB_PATH = db_path


class ApiStatusTransitionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.tmp.name) / "store.db")
        self.store = DummyStore(self.db_path)
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("CREATE TABLE users(user_id INTEGER PRIMARY KEY,balance REAL DEFAULT 0)")
            await db.execute("CREATE TABLE orders(id INTEGER PRIMARY KEY,status TEXT,payment_state TEXT)")
            await db.execute(
                """
                CREATE TABLE balance_logs(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,amount REAL,type TEXT,reason TEXT,date TEXT,admin_id INTEGER
                )
                """
            )
            await db.execute(
                """
                CREATE TABLE client_api_order_links(
                    local_order_id INTEGER PRIMARY KEY,
                    external_order_id TEXT DEFAULT '',provider_status TEXT DEFAULT '',
                    raw_response TEXT DEFAULT '',last_error TEXT DEFAULT '',
                    refund_applied INTEGER DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            await db.execute("INSERT INTO users(user_id,balance) VALUES(1,90)")
            await db.execute("INSERT INTO orders(id,status,payment_state) VALUES(10,'processing','paid')")
            await db.execute("INSERT INTO client_api_order_links(local_order_id,provider_status) VALUES(10,'pending')")
            await db.commit()

    async def asyncTearDown(self) -> None:
        self.tmp.cleanup()

    async def test_completed_status_closes_order_without_touching_balance(self) -> None:
        outcome = await _apply_status_result(
            self.store,
            order_id=10,
            user_id=1,
            price=10,
            result=StatusResult(True, status="completed", completed=True, raw_response="{}"),
        )
        self.assertEqual(outcome, "completed")
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute("SELECT status FROM orders WHERE id=10") as cursor:
                status = str((await cursor.fetchone())[0])
            async with db.execute("SELECT balance FROM users WHERE user_id=1") as cursor:
                balance = float((await cursor.fetchone())[0])
        self.assertEqual(status, "completed")
        self.assertEqual(balance, 90.0)

    async def test_failed_status_refunds_reserved_purchase(self) -> None:
        outcome = await _apply_status_result(
            self.store,
            order_id=10,
            user_id=1,
            price=10,
            result=StatusResult(True, status="failed", failed=True, raw_response='{"status":"failed"}'),
        )
        self.assertEqual(outcome, "refunded")
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute("SELECT status,payment_state FROM orders WHERE id=10") as cursor:
                order = await cursor.fetchone()
            async with db.execute("SELECT balance FROM users WHERE user_id=1") as cursor:
                balance = float((await cursor.fetchone())[0])
            async with db.execute("SELECT refund_applied FROM client_api_order_links WHERE local_order_id=10") as cursor:
                refunded = int((await cursor.fetchone())[0])
        self.assertEqual(order, ("cancelled", "refunded"))
        self.assertEqual(balance, 100.0)
        self.assertEqual(refunded, 1)


if __name__ == "__main__":
    unittest.main()
