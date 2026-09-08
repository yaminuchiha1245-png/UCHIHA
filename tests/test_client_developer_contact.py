from __future__ import annotations

import unittest

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from client_developer_contact import (
    DEVELOPER_BUTTON_TEXT,
    DEVELOPER_WHATSAPP_NUMBER,
    _wrap_main_menu,
    developer_whatsapp_url,
)


class ClientDeveloperContactTests(unittest.TestCase):
    def test_developer_url_targets_requested_whatsapp_number(self) -> None:
        url = developer_whatsapp_url()
        self.assertEqual(DEVELOPER_WHATSAPP_NUMBER, "963942586044")
        self.assertTrue(url.startswith("https://wa.me/963942586044?text="))
        self.assertIn("ZIKO%20STORE", url)

    def test_button_is_added_before_admin_and_only_once(self) -> None:
        def original(is_admin_user: bool = False) -> InlineKeyboardMarkup:
            rows = [
                [InlineKeyboardButton(text="الرئيسية", callback_data="home")],
            ]
            if is_admin_user:
                rows.append(
                    [InlineKeyboardButton(text="لوحة الإدارة", callback_data="admin_panel")]
                )
            return InlineKeyboardMarkup(inline_keyboard=rows)

        first = _wrap_main_menu(original)
        second = _wrap_main_menu(first)
        markup = second(True)

        flattened = [button for row in markup.inline_keyboard for button in row]
        developer_buttons = [
            button for button in flattened if button.text == DEVELOPER_BUTTON_TEXT
        ]
        self.assertEqual(len(developer_buttons), 1)
        self.assertEqual(developer_buttons[0].url, developer_whatsapp_url())

        callbacks = [button.callback_data for button in flattened]
        developer_index = flattened.index(developer_buttons[0])
        admin_index = callbacks.index("admin_panel")
        self.assertLess(developer_index, admin_index)


if __name__ == "__main__":
    unittest.main()
