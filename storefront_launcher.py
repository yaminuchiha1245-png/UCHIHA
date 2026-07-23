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
_LINK_START_RE = re.compile(
    r"^/start(?:@\w+)?\s+link_([A-Za-z0-9_-]{20,48})$",
    re.IGNORECASE,
)
_LOGGER = logging.getLogger("storefront_launcher")


class StorefrontAccountLinkMiddleware(BaseMiddleware):
    """Consume a secure one-time website link before the regular /start flow."""

    async def __call__(
        self,
        handler: Callable[[Message, dict[str, Any]], Awaitable[Any]],
        event: Message,
        data: dict[str, Any],
    ) -> Any:
        match = _LINK_START_RE.fullmatch((getattr(event, "text", "") or "").strip())
        if not match:
            return await handler(event, data)
        user = event.from_user
        if user is None:
            return await handler(event, data)
        state = data.get("state")
        if state is not None:
            await state.clear()
        from storefront_core import complete_bot_link

        result = await complete_bot_link(
            match.group(1),
            user.id,
            user.username or "",
            user.full_name or "",
        )
        result_status = str(result.get("status") or "")
        if result_status == "linked":
            await event.answer(
                "✅ تم ربط حساب Uchiha Store بنجاح.\n\n"
                "رصيدك وطلباتك الآن مشتركة تلقائيًا بين الموقع والبوت."
            )
        elif result_status == "already_linked":
            await event.answer("ℹ️ هذا الحساب مرتبط مسبقًا بحساب تيليجرام آخر.")
        elif result_status == "telegram_in_use":
            await event.answer("ℹ️ حساب تيليجرام هذا مرتبط بحساب متجر آخر.")
        else:
            await event.answer(
                "⌛ انتهت صلاحية رابط الربط أو تم استخدامه.\n"
                "ارجع إلى الموقع واضغط «ربط البوت» لإنشاء رابط جديد."
            )
        return None


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

    provider = str(status.get("verification_provider") or "auto")
    use_trongrid = provider == "trongrid" or (
        provider == "auto"
        and status["trongrid_api_key_present"]
        and status["deposit_address_present"]
        and status["coin"] == "USDT"
        and status["network"] == "TRX"
    )
    requirements = (
        (
            ("TRONGRID_API_KEY", status["trongrid_api_key_present"]),
            ("BINANCE_DEPOSIT_ADDRESS", status["deposit_address_present"]),
        )
        if use_trongrid
        else (
            ("BINANCE_API_KEY", status["api_key_present"]),
            ("BINANCE_API_SECRET", status["api_secret_present"]),
        )
    )
    missing = [label for label, present in requirements if not present]
    if missing:
        _LOGGER.warning(
            "Binance auto payment requested but required Railway variables are missing: %s",
            ", ".join(missing),
        )
        return

    _LOGGER.info(
        "Binance auto payment configured: coin=%s network=%s verification=%s address_source=%s",
        status["coin"],
        status["network"],
        "TronGrid" if use_trongrid else "Binance Wallet API",
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
    from binance_admin import install as install_binance_admin
    from js4card_purchase_options import install as install_js4card_purchase_options
    from js4card_price_precision import install as install_js4card_price_precision
    from shamcash_admin import install as install_shamcash_admin

    install_js4card_purchase_options(store_app)
    install_js4card_price_precision(store_app)
    install_binance_admin(store_app)
    install_shamcash_admin(store_app)

    if not getattr(store_app, "_storefront_account_link_installed", False):
        store_app.dp.message.outer_middleware(StorefrontAccountLinkMiddleware())
        store_app._storefront_account_link_installed = True

    if not getattr(store_app, "_storefront_product_start_installed", False):
        store_app.dp.message.outer_middleware(StorefrontProductStartMiddleware(store_app))
        store_app._storefront_product_start_installed = True

    sys.argv[0] = "uchiha.py"
    runpy.run_path(str(Path(__file__).resolve().with_name("uchiha.py")), run_name="__main__")


if __name__ == "__main__":
    main()
