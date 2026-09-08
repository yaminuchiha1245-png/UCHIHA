from __future__ import annotations

import os
import tempfile
import unittest
from types import SimpleNamespace

import aiosqlite

from client_order_admin_safety import cancel_client_manual_order


class ClientOrderAdminSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        handle = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        handle.close()
        self.db_path = handle.name
        self.store = SimpleNamespace(DB_PATH=self.db_path)
        async with aiosqlite.connect(self.db_path) as db:
            await db.executescript(
                """
                CREATE TABLE users(user_id INTEGER PRIMARY KEY, balance REAL DEFAULT 0);
                CREATE TABLE orders(
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER,
                    total_price REAL,
                    status TEXT,
                    payment_state TEXT,
                    purchase_flow TEXT
                );
                CREATE TABLE balance_logs(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    amount REAL,
                    type TEXT,
                    reason TEXT,
                    date TEXT,
                    admin_id INTEGER
                );
                """
            )
            await db.execute("INSERT INTO users(user_id,balance) VALUES(10,25)")
            await db.execute(
                "INSERT INTO orders(id,user_id,total_price,status,payment_state,purchase_flow) "
                "VALUES(1,10,12.5,'pending','paid','client_manual')"
            )
            await db.execute(
                "INSERT INTO orders(id,user_id,total_price,status,payment_state,purchase_flow) "
                "VALUES(2,10,5,'completed','paid','client_manual')"
            )
            await db.commit()

    async def asyncTearDown(self) -> None:
        try:
            os.unlink(self.db_path)
        except OSError:
            pass

    async def test_cancel_refunds_once_and_marks_order_refunded(self) -> None:
        ok, message, user_id, refunded = await cancel_client_manual_order(
            self.store, order_id=1, admin_id=99
        )
        self.assertTrue(ok, message)
        self.assertEqual(user_id, 10)
        self.assertEqual(refunded, 12.5)

        async with aiosqlite.connect(self.db_path) as db:
            balance = float((await (await db.execute("SELECT balance FROM users WHERE user_id=10")).fetchone())[0])
            order = await (await db.execute("SELECT status,payment_state FROM orders WHERE id=1")).fetchone()
            logs = int((await (await db.execute("SELECT COUNT(*) FROM balance_logs WHERE user_id=10 AND type='refund'")).fetchone())[0])
        self.assertEqual(balance, 37.5)
        self.assertEqual(order, ("cancelled", "refunded"))
        self.assertEqual(logs, 1)

        ok, message, _, refunded_again = await cancel_client_manual_order(
            self.store, order_id=1, admin_id=99
        )
        self.assertTrue(ok, message)
        self.assertEqual(refunded_again, 0.0)
        async with aiosqlite.connect(self.db_path) as db:
            balance_again = float((await (await db.execute("SELECT balance FROM users WHERE user_id=10")).fetchone())[0])
            logs_again = int((await (await db.execute("SELECT COUNT(*) FROM balance_logs WHERE user_id=10 AND type='refund'")).fetchone())[0])
        self.assertEqual(balance_again, 37.5)
        self.assertEqual(logs_again, 1)

    async def test_completed_manual_order_cannot_be_cancelled_by_quick_action(self) -> None:
        ok, message, _, refunded = await cancel_client_manual_order(
            self.store, order_id=2, admin_id=99
        )
        self.assertFalse(ok)
        self.assertEqual(refunded, 5.0)
        self.assertIn("مكتمل", message)
        async with aiosqlite.connect(self.db_path) as db:
            balance = float((await (await db.execute("SELECT balance FROM users WHERE user_id=10")).fetchone())[0])
        self.assertEqual(balance, 25.0)


if __name__ == "__main__":
    unittest.main()
