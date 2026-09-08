from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from client_customer_center import _order_badge
from client_identity import _clean_title, _support_keyboard_wrapper


class ClientCustomerExperienceTests(unittest.TestCase):
    def test_store_title_is_normalized_and_bounded(self) -> None:
        self.assertEqual(_clean_title("  متجر   العميل  "), "متجر العميل")
        self.assertEqual(_clean_title(""), "متجر الخدمات")
        self.assertLessEqual(len(_clean_title("x" * 200)), 80)

    def test_order_badges_prioritize_uncertain_and_refunded_states(self) -> None:
        # id, name, total, status, date, flow, payment_state, provider_status, external_id
        uncertain = (1, "Product", 10, "processing", "", "client_api_generic", "paid", "uncertain", "")
        refunded = (2, "Product", 10, "cancelled", "", "client_api_generic", "refunded", "failed", "A1")
        completed = (3, "Product", 10, "completed", "", "client_api_generic", "paid", "completed", "A2")
        self.assertEqual(_order_badge(uncertain), "⚠️ تحقق")
        self.assertEqual(_order_badge(refunded), "↩️ مسترجع")
        self.assertEqual(_order_badge(completed), "✅ مكتمل")


class ClientSupportExperienceTests(unittest.IsolatedAsyncioTestCase):
    async def test_whatsapp_prefill_uses_client_store_name(self) -> None:
        async def original(user_id: int) -> InlineKeyboardMarkup:
            return InlineKeyboardMarkup(
                inline_keyboard=[
                    [InlineKeyboardButton(text="WhatsApp", url="https://wa.me/963900000000?text=old")],
                    [InlineKeyboardButton(text="رجوع", callback_data="main_menu")],
                ]
            )

        with patch("client_identity.get_store_title", new=AsyncMock(return_value="متجر زيكو")):
            markup = await _support_keyboard_wrapper(SimpleNamespace(), original)(123)

        whatsapp = markup.inline_keyboard[0][0]
        self.assertIn("wa.me/963900000000", whatsapp.url)
        self.assertIn("%D9%85%D8%AA%D8%AC%D8%B1%20%D8%B2%D9%8A%D9%83%D9%88", whatsapp.url)
        self.assertNotIn("UCHIHA", whatsapp.url.upper())
        self.assertEqual(markup.inline_keyboard[1][0].callback_data, "main_menu")


if __name__ == "__main__":
    unittest.main()
