from __future__ import annotations

import unittest

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from client_admin_cleanup import _clean_admin_panel


class ClientAdminCleanupTests(unittest.TestCase):
    def test_conflicting_legacy_buttons_are_removed_and_core_controls_remain(self) -> None:
        def original(perms=None, super_admin=False):
            return InlineKeyboardMarkup(
                inline_keyboard=[
                    [
                        InlineKeyboardButton(text="المستخدمون", callback_data="admin_users"),
                        InlineKeyboardButton(text="المنتجات القديمة", callback_data="admin_products"),
                    ],
                    [
                        InlineKeyboardButton(text="الأقسام القديمة", callback_data="admin_categories"),
                        InlineKeyboardButton(text="الطلبات", callback_data="admin_orders"),
                    ],
                    [
                        InlineKeyboardButton(text="تحديث قديم", callback_data="admin_api_sync_now"),
                        InlineKeyboardButton(text="API جديد", callback_data="cli:providers"),
                    ],
                    [InlineKeyboardButton(text="الرئيسية", callback_data="main_menu")],
                ]
            )

        wrapped = _clean_admin_panel(original)
        result = wrapped({"can_manage_products": True}, False)
        callbacks = [
            button.callback_data
            for row in result.inline_keyboard
            for button in row
            if button.callback_data
        ]

        self.assertIn("admin_users", callbacks)
        self.assertIn("admin_orders", callbacks)
        self.assertIn("main_menu", callbacks)
        self.assertIn("cliadmin:home", callbacks)
        self.assertNotIn("admin_products", callbacks)
        self.assertNotIn("admin_categories", callbacks)
        self.assertNotIn("admin_api_sync_now", callbacks)
        self.assertNotIn("cli:providers", callbacks)
        self.assertEqual(callbacks.count("cliadmin:home"), 1)

    def test_existing_client_home_is_not_duplicated(self) -> None:
        def original(perms=None, super_admin=False):
            return InlineKeyboardMarkup(
                inline_keyboard=[
                    [InlineKeyboardButton(text="المتجر", callback_data="cliadmin:home")],
                    [InlineKeyboardButton(text="المتجر مكرر", callback_data="cliadmin:home")],
                    [InlineKeyboardButton(text="الرئيسية", callback_data="main_menu")],
                ]
            )

        wrapped = _clean_admin_panel(original)
        result = wrapped({"can_manage_products": True}, False)
        callbacks = [
            button.callback_data
            for row in result.inline_keyboard
            for button in row
            if button.callback_data
        ]
        self.assertEqual(callbacks.count("cliadmin:home"), 1)


if __name__ == "__main__":
    unittest.main()
