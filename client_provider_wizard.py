from __future__ import annotations

from typing import Any

import aiosqlite
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message

from client_services_store import ProviderStates, ensure_schema
from client_store_admin import _allowed, _replace_named_handler


async def _provider_url(store: Any, message: Message, state: Any) -> None:
    if not await _allowed(store, message.from_user.id, "can_manage_products", "can_manage_sync"):
        await state.clear()
        return
    url = str(message.text or "").strip().rstrip("/")
    if not url.startswith("https://"):
        await message.answer(
            "🔒 لأمان توكن المزوّد يجب أن يبدأ الرابط بـ https://\n"
            "مثال: https://api.example.com"
        )
        return
    await state.update_data(provider_url=url)
    await state.set_state(ProviderStates.token)
    await message.answer(
        "🔑 أرسل API Token / Key.\n"
        "سيتم حذف رسالتك بعد قراءتها وحفظ القيمة مشفّرة."
    )


async def _provider_path(store: Any, message: Message, state: Any) -> None:
    if not await _allowed(store, message.from_user.id, "can_manage_products", "can_manage_sync"):
        await state.clear()
        return
    path = str(message.text or "").strip()
    if not path:
        await message.answer("أرسل مسار الكتالوج، مثال: /api/products")
        return
    if path.startswith("http://"):
        await message.answer("الرابط الكامل للكتالوج يجب أن يستخدم HTTPS.")
        return
    if path.startswith("https://"):
        catalog_path = path
    else:
        catalog_path = path if path.startswith("/") else "/" + path

    data = await state.get_data()
    await ensure_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO client_api_providers(
                name,base_url,catalog_path,token_cipher,token_fingerprint,created_by
            ) VALUES(?,?,?,?,?,?)
            """,
            (
                data.get("provider_name", "Provider"),
                data.get("provider_url", ""),
                catalog_path,
                data.get("token_cipher", ""),
                data.get("token_fingerprint", ""),
                message.from_user.id,
            ),
        )
        await db.commit()
        provider_id = int(cursor.lastrowid)
    await state.clear()
    await message.answer(
        "✅ تم حفظ المزوّد والتوكن المشفّر.\n\n"
        "الخطوة التالية: اختر طريقة المصادقة إن لم يكن الوضع التلقائي مناسبًا، "
        "ثم جرّب مزامنة الكتالوج. المنتجات الجديدة ستدخل إلى «📥 غير مرتبة».",
        reply_markup=InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text="🔐 طريقة المصادقة", callback_data=f"cpadmin:auth:{provider_id}")],
                [InlineKeyboardButton(text="🔄 مزامنة الآن", callback_data=f"clisync:run:{provider_id}")],
                [InlineKeyboardButton(text="🔌 إدارة المزوّد", callback_data=f"cli:provider:{provider_id}")],
            ]
        ),
    )


def install(store: Any) -> None:
    if getattr(store, "_client_provider_wizard_installed", False):
        return

    async def provider_url(message: Message, state: Any) -> None:
        await _provider_url(store, message, state)

    async def provider_path(message: Message, state: Any) -> None:
        await _provider_path(store, message, state)

    _replace_named_handler(store.dp, "message", "provider_url", provider_url)
    _replace_named_handler(store.dp, "message", "provider_path", provider_path)
    store._client_provider_wizard_installed = True
