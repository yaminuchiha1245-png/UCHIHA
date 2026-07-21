#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Launch UCHIHA with the public web theme and Telegram product deep links."""

from __future__ import annotations

import logging
import os
import re
import runpy
import sys
from pathlib import Path
from typing import Any, Awaitable, Callable

import aiosqlite
from aiogram import BaseMiddleware
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message

from binance_compat import prepare_binance_environment

_PRODUCT_START_RE = re.compile(r"^/start(?:@\w+)?\s+product_(\d+)$", re.IGNORECASE)
_LOGGER = logging.getLogger("storefront_launcher")


class StorefrontProductStartMiddleware(BaseMiddleware):
    """Open a website-selected product before the normal /start handler."""

    def __init__(self, store_app: Any) -> None:
        self.store = store_app

    async def __call__(
        self,
        handler: Callable[[Message, dict[str, Any]], Awaitable[Any]],
        event: Message,
        data: dict[str, Any],
    ) -> Any:
        match = _PRODUCT_START_RE.fullmatch((getattr(event, "text", "") or "").strip())
        if not match:
            return await handler(event, data)

        state = data.get("state")
        if state is not None:
            await state.clear()

        user = event.from_user
        if user is None:
            return await handler(event, data)

        await self.store.create_or_update_user(user.id, user.username, user.full_name)
        if await self.store.get_setting("bot_status", "active") == "maintenance" and not await self.store.is_admin(user.id):
            await event.answer("🔧 البوت في وضع الصيانة حاليًا. يرجى المحاولة لاحقًا.")
            return None
        if await self.store.is_banned(user.id):
            await event.answer("🚫 تم حظرك من استخدام هذا البوت.")
            return None

        product_id = int(match.group(1))
        async with aiosqlite.connect(self.store.DB_PATH) as db:
            async with db.execute(
                "SELECT id, category_id, name, description, price, stock, is_active, "
                "COALESCE(product_type, 'stock'), COALESCE(delivery_time, ''), "
                "COALESCE(buy_button_1, ''), COALESCE(buy_button_2, ''), "
                "COALESCE(buy_button_3, ''), COALESCE(api_id, 0), "
                "COALESCE(api_provider, '') FROM products WHERE id = ?",
                (product_id,),
            ) as cursor:
                product = await cursor.fetchone()
            async with db.execute(
                "SELECT 1 FROM favorites WHERE user_id = ? AND product_id = ?",
                (user.id, product_id),
            ) as cursor:
                is_favorite = await cursor.fetchone() is not None

        if not product or int(product[6] or 0) != 1 or int(product[5] or 0) <= 0:
            await event.answer(
                "❌ هذا المنتج غير موجود أو غير متاح حاليًا.",
                reply_markup=self.store.back_to_main_kb(),
            )
            return None

        product_type = str(product[7] or "stock")
        delivery_time = str(product[8] or "فوري")
        custom_buttons = [product[9], product[10], product[11]]
        api_id = int(product[12] or 0)
        api_provider = str(product[13] or "")
        text = (
            f"🛍 {product[2]}\n\n"
            f"📝 {product[3] or 'منتج رقمي متوفر عبر UCHIHA STORE.'}\n\n"
            f"💰 السعر: {float(product[4] or 0):.2f} $\n"
            f"📦 المخزون: ✅ متوفر ({int(product[5] or 0)} قطعة)\n"
            f"🕒 وقت التسليم: {delivery_time}"
        )

        if api_id > 0 and api_provider == "js4card":
            keyboard = InlineKeyboardMarkup(
                inline_keyboard=[
                    [InlineKeyboardButton(text="🛒 متابعة شراء المنتج", callback_data=f"prod_{product_id}")],
                    [self.store.back_btn("main_menu", "🏠 الرئيسية")],
                ]
            )
        else:
            keyboard = self.store.product_detail_kb(
                product_id,
                int(product[1] or 0),
                is_favorite,
                product_type,
                custom_buttons,
            )

        await event.answer(text, reply_markup=keyboard)
        await self.store.log_activity(user.id, "storefront_product", f"فتح المنتج {product_id} من الموقع")
        return None


def _disable_legacy_platform_file() -> None:
    root = Path(__file__).resolve().parent
    legacy = root / "platform.py"
    if not legacy.is_file():
        return
    disabled = root / ".old_platform.py"
    if disabled.exists():
        disabled.unlink()
    legacy.replace(disabled)


def _prepare_binance() -> None:
    status = prepare_binance_environment()
    if not status["enabled"]:
        _LOGGER.info(
            "Binance auto payment disabled. Set BINANCE_AUTO_PAY_ENABLED=1 "
            "or legacy BINANCE_PAYMENT_ENABLED=1 to enable it."
        )
        return

    missing = [
        label
        for label, present in (
            ("BINANCE_API_KEY", status["api_key_present"]),
            ("BINANCE_API_SECRET", status["api_secret_present"]),
        )
        if not present
    ]
    if missing:
        _LOGGER.warning(
            "Binance auto payment requested but required Railway variables are missing: %s",
            ", ".join(missing),
        )
        return

    _LOGGER.info(
        "Binance auto payment configured: coin=%s network=%s address_source=%s",
        status["coin"],
        status["network"],
        "Railway variable" if status["deposit_address_present"] else "Binance Wallet API",
    )


def main() -> None:
    os.environ.setdefault("STOREFRONT_WEB_ENABLED", "1")
    os.environ.setdefault("STOREFRONT_API_ENABLED", "1")
    os.environ.setdefault("STOREFRONT_PUBLIC_CATALOG_ENABLED", "1")
    os.environ.setdefault("STOREFRONT_TELEGRAM_URL", "https://t.me/UchihaStoreBot")
    _prepare_binance()
    _disable_legacy_platform_file()

    from storefront_theme import STOREFRONT_HTML
    import storefront_api

    storefront_api._STOREFRONT_HTML = STOREFRONT_HTML

    import bot as store_app

    if not getattr(store_app, "_storefront_product_start_installed", False):
        store_app.dp.message.outer_middleware(StorefrontProductStartMiddleware(store_app))
        store_app._storefront_product_start_installed = True

    sys.argv[0] = "uchiha.py"
    runpy.run_path(str(Path(__file__).resolve().with_name("uchiha.py")), run_name="__main__")


if __name__ == "__main__":
    main()
