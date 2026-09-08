from __future__ import annotations

import os
import tempfile
import unittest
from types import SimpleNamespace

import aiosqlite
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from client_payment_policy import (
    _filter_admin_panel,
    _local_payment_methods,
    quarantine_legacy_payment_methods,
)
from client_runtime_policy import isolate_client_environment


class ClientRuntimeIsolationTests(unittest.TestCase):
    def test_legacy_provider_secrets_are_removed(self) -> None:
        env = {
            "BOT_TOKEN": "123456:test-client-token",
            "ADMIN_ID": "77",
            "CLIENT_STORE_NAME": "Client Store",
            "CLIENT_STORE_MASTER_KEY_FILE": "/safe/client_store.key",
            "CLIENT_STORE_MASTER_KEY": "stale-environment-fernet-key",
            "API_TOKEN": "old-js4card",
            "BINANCE_API_KEY": "old-binance-key",
            "BINANCE_API_SECRET": "old-binance-secret",
            "TRONGRID_API_KEY": "old-tron-key",
            "SHAMCASH_API_TOKEN": "old-sham-token",
            "BINANCE_AUTO_PAY_ENABLED": "true",
            "SHAMCASH_API_ENABLED": "1",
            "STOREFRONT_WEB_ENABLED": "1",
        }

        isolate_client_environment(env)

        for key in (
            "API_TOKEN",
            "BINANCE_API_KEY",
            "BINANCE_API_SECRET",
            "TRONGRID_API_KEY",
            "SHAMCASH_API_TOKEN",
            "CLIENT_STORE_MASTER_KEY",
        ):
            self.assertNotIn(key, env)
        self.assertEqual(env["BOT_TOKEN"], "123456:test-client-token")
        self.assertEqual(env["ADMIN_ID"], "77")
        self.assertEqual(env["CLIENT_STORE_NAME"], "Client Store")
        self.assertEqual(env["CLIENT_STORE_MASTER_KEY_FILE"], "/safe/client_store.key")
        self.assertEqual(env["BINANCE_AUTO_PAY_ENABLED"], "false")
        self.assertEqual(env["SHAMCASH_API_ENABLED"], "0")
        self.assertEqual(env["STOREFRONT_WEB_ENABLED"], "0")
        self.assertEqual(env["ORDER_STATUS_MONITOR_ENABLED"], "false")

    def test_admin_panel_hides_legacy_payment_centers(self) -> None:
        def original(perms=None, super_admin=False):
            return InlineKeyboardMarkup(
                inline_keyboard=[
                    [InlineKeyboardButton(text="طرق الدفع", callback_data="admin_payment_methods")],
                    [InlineKeyboardButton(text="Binance", callback_data="admin_binance")],
                    [InlineKeyboardButton(text="Sham", callback_data="admin_shamcash")],
                ]
            )

        markup = _filter_admin_panel(original)({}, True)
        callbacks = {
            button.callback_data
            for row in markup.inline_keyboard
            for button in row
        }
        self.assertIn("admin_payment_methods", callbacks)
        self.assertNotIn("admin_binance", callbacks)
        self.assertNotIn("admin_shamcash", callbacks)


class ClientPaymentMethodIsolationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        handle = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        handle.close()
        self.db_path = handle.name
        self.store = SimpleNamespace(DB_PATH=self.db_path)
        async with aiosqlite.connect(self.db_path) as db:
            await db.executescript(
                """
                CREATE TABLE payment_methods (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT,
                    details TEXT,
                    is_active INTEGER,
                    provider TEXT,
                    icon TEXT,
                    sort_order INTEGER,
                    last_synced TEXT,
                    min_amount REAL,
                    transfer_value TEXT,
                    payment_mode TEXT,
                    proof_mode TEXT
                );
                """
            )
            await db.executemany(
                """
                INSERT INTO payment_methods(
                    name,details,is_active,provider,icon,sort_order,last_synced,
                    min_amount,transfer_value,payment_mode,proof_mode
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                """,
                [
                    ("Local", "manual", 1, "local", "💳", 1, "", 1, "123", "manual", "either"),
                    ("Binance", "legacy", 1, "binance", "🟡", 2, "", 1, "", "auto", "transaction"),
                    ("Sham", "legacy", 1, "shamcash", "🟣", 3, "", 1, "", "auto", "transaction"),
                    ("Old JS4", "legacy", 1, "js4card", "🌐", 4, "", 1, "", "manual", "either"),
                ],
            )
            await db.commit()

    async def asyncTearDown(self) -> None:
        try:
            os.unlink(self.db_path)
        except OSError:
            pass

    async def test_only_local_manual_methods_are_visible(self) -> None:
        methods = await _local_payment_methods(self.store)
        self.assertEqual(len(methods), 1)
        self.assertEqual(methods[0][1], "Local")
        self.assertEqual(methods[0][4], "local")
        self.assertEqual(methods[0][10], "manual")

    async def test_legacy_rows_are_disabled_without_deleting_them(self) -> None:
        changed = await quarantine_legacy_payment_methods(self.store)
        self.assertGreaterEqual(changed, 3)
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute(
                "SELECT name,is_active FROM payment_methods ORDER BY id"
            ) as cursor:
                rows = await cursor.fetchall()
        self.assertEqual(rows[0], ("Local", 1))
        self.assertEqual(rows[1], ("Binance", 0))
        self.assertEqual(rows[2], ("Sham", 0))
        self.assertEqual(rows[3], ("Old JS4", 0))
        self.assertEqual(len(rows), 4)


if __name__ == "__main__":
    unittest.main()
