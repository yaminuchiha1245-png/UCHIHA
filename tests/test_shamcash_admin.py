from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

import shamcash_admin


class _Dispatcher:
    def __init__(self) -> None:
        self.routers = []

    def include_router(self, router) -> None:
        self.routers.append(router)


class _Store:
    def __init__(self, db_path: str = "") -> None:
        self.DB_PATH = db_path
        self.dp = _Dispatcher()

    @staticmethod
    def clean_api_text(value, limit=350):
        return " ".join(str(value or "").split())[:limit]

    @staticmethod
    def admin_panel_kb(perms=None, super_admin=False):
        return InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text="الرئيسية", callback_data="main_menu")]
            ]
        )

    @staticmethod
    def back_btn(callback_data="admin_panel", label="رجوع"):
        return InlineKeyboardButton(text=label, callback_data=callback_data)

    @staticmethod
    def _money(value):
        return str(value)

    @staticmethod
    async def is_admin(user_id: int) -> bool:
        return True

    @staticmethod
    async def is_super_admin(user_id: int) -> bool:
        return True

    @staticmethod
    async def get_admin_perms(user_id: int):
        return {"can_manage_payments": True}


class _FakeClient:
    async def accounts(self):
        return [{"id": "account-123456", "status": "active"}]

    async def balances(self, account_id: str):
        assert account_id == "account-123456"
        return [{"currency": "SYP", "amount": "1000"}]


class _LeakyFakeClient:
    async def accounts(self):
        raise RuntimeError("provider echoed super-secret-future-token")


class ShamCashAdminTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        shamcash_admin._STATE.update(
            last_ok="",
            last_error="",
            account_count=0,
            active_account_count=0,
            balance_count=0,
        )

    def test_https_validation_and_client_readiness(self) -> None:
        self.assertEqual(shamcash_admin._validate_base_url("https://api.example.com/v1"), (True, "api.example.com"))
        self.assertEqual(shamcash_admin._validate_base_url("http://api.example.com/v1"), (False, ""))
        self.assertEqual(shamcash_admin._validate_base_url("https://user:pass@example.com"), (False, ""))
        client = shamcash_admin.ShamCashReadOnlyClient(
            {
                "enabled": True,
                "token": "future-token",
                "base_url": "https://api.example.com/v1",
            }
        )
        self.assertTrue(client.ready)
        self.assertEqual(client._url("/accounts"), "https://api.example.com/v1/accounts")
        with self.assertRaises(ValueError):
            client._url("https://evil.example/accounts")

    async def test_future_token_connection_without_exposing_token(self) -> None:
        environment = {
            "SHAMCASH_API_ENABLED": "1",
            "SHAMCASH_API_TOKEN": "super-secret-future-token",
            "SHAMCASH_API_BASE_URL": "https://api.example.com/v1",
            "SHAMCASH_ACCOUNT_ID": "account-123456",
        }
        with patch.dict(os.environ, environment, clear=False), patch.object(
            shamcash_admin, "_client", return_value=_FakeClient()
        ):
            result = await shamcash_admin._test_connection(_Store())
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["accounts"], 1)
        self.assertEqual(result["active_accounts"], 1)
        self.assertEqual(result["balances"], 1)
        self.assertNotIn(environment["SHAMCASH_API_TOKEN"], str(result))

    async def test_provider_error_cannot_echo_token(self) -> None:
        environment = {
            "SHAMCASH_API_ENABLED": "1",
            "SHAMCASH_API_TOKEN": "super-secret-future-token",
            "SHAMCASH_API_BASE_URL": "https://api.example.com/v1",
            "SHAMCASH_ACCOUNT_ID": "",
        }
        with patch.dict(os.environ, environment, clear=False), patch.object(
            shamcash_admin, "_client", return_value=_LeakyFakeClient()
        ):
            result = await shamcash_admin._test_connection(_Store())
        self.assertFalse(result["ok"])
        self.assertNotIn(environment["SHAMCASH_API_TOKEN"], result["message"])
        self.assertIn("[hidden]", result["message"])

    async def test_missing_configuration_is_safe_and_actionable(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SHAMCASH_API_ENABLED": "0",
                "SHAMCASH_API_TOKEN": "",
                "SHAMCASH_API_BASE_URL": "",
            },
            clear=False,
        ):
            result = await shamcash_admin._test_connection(_Store())
        self.assertFalse(result["ok"])
        self.assertIn("SHAMCASH_API_TOKEN", result["message"])
        self.assertIn("SHAMCASH_API_BASE_URL", result["message"])

    async def test_dashboard_and_admin_button_exist_before_token(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = str(Path(temp_dir) / "store.db")
            connection = sqlite3.connect(db_path)
            try:
                connection.executescript(
                    """
                    CREATE TABLE payment_methods(
                        id INTEGER PRIMARY KEY,
                        name TEXT,
                        is_active INTEGER,
                        provider TEXT
                    );
                    CREATE TABLE deposit_requests(
                        id INTEGER PRIMARY KEY,
                        payment_method_id INTEGER,
                        status TEXT
                    );
                    INSERT INTO payment_methods(id,name,is_active,provider)
                    VALUES(1,'Sham Cash',1,'local');
                    INSERT INTO deposit_requests(id,payment_method_id,status)
                    VALUES(1,1,'pending');
                    """
                )
                connection.commit()
            finally:
                connection.close()

            store = _Store(db_path)
            shamcash_admin.install(store)
            panel = store.admin_panel_kb({"can_manage_payments": True}, False)
            buttons = [button for row in panel.inline_keyboard for button in row]
            self.assertTrue(any(button.callback_data == "admin_shamcash" for button in buttons))
            self.assertEqual(len(store.dp.routers), 1)

            with patch.dict(
                os.environ,
                {
                    "SHAMCASH_API_ENABLED": "0",
                    "SHAMCASH_API_TOKEN": "",
                    "SHAMCASH_API_BASE_URL": "",
                },
                clear=False,
            ):
                text, data = await shamcash_admin._dashboard_text(store)
            self.assertIn("مركز Sham Cash", text)
            self.assertIn("غير مضاف بعد", text)
            self.assertNotIn("SHAMCASH_API_TOKEN=", text)
            self.assertEqual(len(data["methods"]), 1)
            self.assertEqual(data["statuses"].get("pending"), 1)


if __name__ == "__main__":
    unittest.main()
