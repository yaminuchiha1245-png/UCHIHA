import asyncio
import os
import sqlite3
import sys
import tempfile
import types
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


def _install_aiosqlite_fallback() -> None:
    """Small test-only fallback for sandboxes that cannot download PyPI wheels."""
    try:
        __import__("aiosqlite")
        return
    except ModuleNotFoundError:
        pass

    class AsyncCursor:
        def __init__(self, cursor):
            self._cursor = cursor

        @property
        def lastrowid(self):
            return self._cursor.lastrowid

        @property
        def rowcount(self):
            return self._cursor.rowcount

        async def fetchone(self):
            return self._cursor.fetchone()

        async def fetchall(self):
            return self._cursor.fetchall()

        async def close(self):
            self._cursor.close()

    class ExecuteContext:
        def __init__(self, connection, sql, params):
            self._connection = connection
            self._sql = sql
            self._params = params
            self._result = None

        def _run(self):
            if self._result is None:
                self._connection._raw.row_factory = self._connection.row_factory
                self._result = AsyncCursor(self._connection._raw.execute(self._sql, self._params))
            return self._result

        def __await__(self):
            async def resolve():
                return self._run()

            return resolve().__await__()

        async def __aenter__(self):
            return self._run()

        async def __aexit__(self, exc_type, exc, tb):
            if self._result is not None:
                await self._result.close()

        @property
        def lastrowid(self):
            return self._run().lastrowid

        @property
        def rowcount(self):
            return self._run().rowcount

        async def fetchone(self):
            return await self._run().fetchone()

        async def fetchall(self):
            return await self._run().fetchall()

    class Connection:
        def __init__(self, target, **kwargs):
            self._raw = sqlite3.connect(target, **kwargs)
            self.row_factory = None

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            if exc_type:
                self._raw.rollback()
            self._raw.close()

        def execute(self, sql, params=()):
            return ExecuteContext(self, sql, params)

        async def executescript(self, sql):
            self._raw.executescript(sql)

        async def executemany(self, sql, values):
            self._raw.row_factory = self.row_factory
            return AsyncCursor(self._raw.executemany(sql, values))

        async def commit(self):
            self._raw.commit()

        async def rollback(self):
            self._raw.rollback()

        async def close(self):
            self._raw.close()

    module = types.ModuleType("aiosqlite")
    module.Connection = Connection
    module.Row = sqlite3.Row
    module.Error = sqlite3.Error
    module.IntegrityError = sqlite3.IntegrityError
    module.OperationalError = sqlite3.OperationalError
    module.connect = lambda target, **kwargs: Connection(target, **kwargs)
    sys.modules["aiosqlite"] = module


_install_aiosqlite_fallback()

import storefront_core as core  # noqa: E402


class StorefrontCoreTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_file = Path(self.temp.name) / "store.db"
        os.environ["DB_PATH"] = str(self.db_file)
        os.environ["STOREFRONT_SESSION_SECRET"] = "test-secret-that-is-not-used-in-production"
        os.environ["STOREFRONT_ADMIN_USERNAME"] = "owner"
        os.environ["STOREFRONT_ADMIN_PASSWORD"] = "owner-test-password"
        await core.ensure_schema()

    async def asyncTearDown(self):
        self.temp.cleanup()

    @staticmethod
    def account_payload(**overrides):
        payload = {
            "first_name": "Uchiha",
            "last_name": "Customer",
            "username": "uchiha_user",
            "email": "user@example.com",
            "country": "TR",
            "phone": "+905551112233",
            "password": "strong-pass-123",
        }
        payload.update(overrides)
        return payload

    async def test_account_login_session_and_duplicate_guard(self):
        account = await core.create_account(self.account_payload())
        self.assertEqual(account["username"], "uchiha_user")
        self.assertEqual(account["balance"], 0)
        self.assertFalse(account["linked"])

        authenticated = await core.authenticate("USER@EXAMPLE.COM", "strong-pass-123")
        self.assertEqual(authenticated["id"], account["id"])
        token, issued = await core.issue_session(account_id=account["id"])
        session = await core.get_session(token, "customer")
        self.assertIsNotNone(session)
        self.assertEqual(session.account_id, account["id"])
        self.assertEqual(session.csrf_token, issued.csrf_token)
        await core.revoke_session(token)
        self.assertIsNone(await core.get_session(token))

        with self.assertRaises(core.StorefrontError) as caught:
            await core.create_account(self.account_payload(username="another_user"))
        self.assertEqual(caught.exception.code, "email_exists")

    async def test_bot_deep_link_is_one_time_and_preserves_wallet(self):
        account = await core.create_account(self.account_payload())
        with sqlite3.connect(self.db_file) as db:
            source_id = db.execute(
                "SELECT user_id FROM web_accounts WHERE id=?", (account["id"],)
            ).fetchone()[0]
            db.execute("UPDATE users SET balance=37.45 WHERE user_id=?", (source_id,))
            db.execute(
                "CREATE TABLE orders(id INTEGER PRIMARY KEY, user_id INTEGER, total_price REAL DEFAULT 0)"
            )
            db.execute("INSERT INTO orders(user_id,total_price) VALUES (?, 4.5)", (source_id,))

        link = await core.create_link_code(account["id"], "https://t.me/UchihaStoreBot")
        self.assertFalse(link["linked"])
        start = parse_qs(urlsplit(link["bot_url"]).query)["start"][0]
        self.assertTrue(start.startswith("link_"))
        result = await core.complete_bot_link(start.removeprefix("link_"), 777001, "uchiha_tg", "Uchiha Telegram")
        self.assertEqual(result["status"], "linked")

        linked_account = await core.get_account(account["id"])
        self.assertTrue(linked_account["linked"])
        self.assertEqual(linked_account["telegram_id"], 777001)
        self.assertEqual(linked_account["balance"], 37.45)
        with sqlite3.connect(self.db_file) as db:
            self.assertIsNone(db.execute("SELECT 1 FROM users WHERE user_id=?", (source_id,)).fetchone())
            self.assertEqual(db.execute("SELECT user_id FROM orders").fetchone()[0], 777001)

        reused = await core.complete_bot_link(start.removeprefix("link_"), 777001)
        self.assertEqual(reused["status"], "expired")

    async def test_owner_login_settings_and_default_branding(self):
        await core.authenticate_admin("OWNER", "owner-test-password")
        banners = await core.get_banners()
        self.assertEqual(len(banners), 3)
        self.assertEqual(
            [item["image_url"] for item in banners],
            [
                "/assets/hero-madara-v2.webp",
                "/assets/hero-obito-v2.webp",
                "/assets/hero-itachi-sasuke-v2.webp",
            ],
        )
        self.assertEqual(
            [item["title"] for item in banners],
            ["القوة تبدأ من الظلال", "حساب واحد، عالم واحد", "إرث لا ينطفئ"],
        )
        defaults = await core.get_settings()
        self.assertEqual(defaults["primary_color"], "#e4313f")
        self.assertEqual(defaults["secondary_color"], "#9f111b")
        self.assertEqual(defaults["accent_color"], "#d7d9de")
        settings = await core.update_settings(
            {"store_name": "Uchiha Store", "primary_color": "#18d8c5", "hero_interval_ms": "1800"}
        )
        self.assertEqual(settings["store_name"], "Uchiha Store")
        self.assertEqual(settings["hero_interval_ms"], "2500")
        with self.assertRaises(core.StorefrontError):
            await core.update_settings({"primary_color": "red"})

    def test_validation_and_purchase_fields(self):
        encoded = core.hash_password("valid-pass-123")
        self.assertTrue(core.verify_password("valid-pass-123", encoded))
        self.assertFalse(core.verify_password("wrong-pass", encoded))
        detail = {
            "min_qty": 1,
            "max_qty": 5,
            "fields": [{"key": "player_id", "label": "Player ID", "required": True, "options": []}],
        }
        quantity, fields, variant = core._validate_purchase(
            detail, {"quantity": 2, "fields": {"player_id": "123456"}}
        )
        self.assertEqual((quantity, variant), (2, 0))
        self.assertEqual(fields, {"player_id": "123456"})
        with self.assertRaises(core.StorefrontError):
            core._validate_purchase(detail, {"quantity": 2, "fields": {}})


if __name__ == "__main__":
    unittest.main()
