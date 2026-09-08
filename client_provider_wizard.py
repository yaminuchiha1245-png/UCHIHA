from __future__ import annotations

from typing import Any

import aiosqlite
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message

from client_provider_admin import ensure_provider_schema
from client_services_store import ProviderStates, _encrypt
from client_store_admin import _allowed, _replace_named_handler


_NO_TOKEN_VALUES = {"-", "none", "no", "بدون", "بدون توكن", "لا يوجد", "public"}


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
        "سيتم حذف رسالتك بعد قراءتها وحفظ القيمة مشفّرة.\n\n"
        "إذا كان الـAPI عامًا ولا يحتاج مصادقة، أرسل: بدون"
    )


async def _provider_token(store: Any, message: Message, state: Any) -> None:
    if not await _allowed(store, message.from_user.id, "can_manage_products", "can_manage_sync"):
        await state.clear()
        return
    token = str(message.text or "").strip()
    if token.lower() in _NO_TOKEN_VALUES:
        await state.update_data(
            token_cipher="",
            token_fingerprint="",
            provider_auth_mode="none",
        )
        await state.set_state(ProviderStates.catalog_path)
        await message.answer(
            "🌐 تم اختيار مزوّد بدون مصادقة.\n"
            "📦 أرسل مسار الكتالوج، مثال: /api/products"
        )
        return
    if len(token) < 4:
        await message.answer("التوكن قصير جدًا. أرسل التوكن الصحيح أو كلمة «بدون» إذا كان الـAPI عامًا.")
        return
    cipher, fingerprint = _encrypt(store, token)
    await state.update_data(
        token_cipher=cipher,
        token_fingerprint=fingerprint,
        provider_auth_mode="auto",
    )
    await state.set_state(ProviderStates.catalog_path)
    try:
        await message.delete()
    except Exception:
        pass
    await message.answer("📦 أرسل مسار الكتالوج، مثال: /api/products")


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
    await ensure_provider_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO client_api_providers(
                name,base_url,catalog_path,token_cipher,token_fingerprint,created_by,auth_mode
            ) VALUES(?,?,?,?,?,?,?)
            """,
            (
                data.get("provider_name", "Provider"),
                data.get("provider_url", ""),
                catalog_path,
                data.get("token_cipher", ""),
                data.get("token_fingerprint", ""),
                message.from_user.id,
                data.get("provider_auth_mode", "auto"),
            ),
        )
        await db.commit()
        provider_id = int(cursor.lastrowid)
    await state.clear()
    no_auth = str(data.get("provider_auth_mode") or "auto") == "none"
    saved_note = "بدون توكن لأنه API عام" if no_auth else "بتوكن مشفّر"
    await message.answer(
        f"✅ تم حفظ المزوّد {saved_note}.\n\n"
        "الخطوة التالية: اختر طريقة المصادقة إن لم يكن الوضع الحالي مناسبًا، "
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

    async def provider_token(message: Message, state: Any) -> None:
        await _provider_token(store, message, state)

    async def provider_path(message: Message, state: Any) -> None:
        await _provider_path(store, message, state)

    _replace_named_handler(store.dp, "message", "provider_url", provider_url)
    _replace_named_handler(store.dp, "message", "provider_token", provider_token)
    _replace_named_handler(store.dp, "message", "provider_path", provider_path)
    store._client_provider_wizard_installed = True
