from __future__ import annotations

import html
from typing import Any

import aiosqlite
from aiogram import F, Router
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from client_services_store import _encrypt, _short, ensure_schema
from client_store_admin import _allowed, _replace_named_handler


class ProviderEditStates(StatesGroup):
    token = State()
    base_url = State()
    catalog_path = State()
    query_key = State()


async def ensure_provider_schema(store: Any) -> None:
    await ensure_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        for sql in (
            "ALTER TABLE client_api_providers ADD COLUMN auth_mode TEXT DEFAULT 'auto'",
            "ALTER TABLE client_api_providers ADD COLUMN token_query_key TEXT DEFAULT 'api_key'",
        ):
            try:
                await db.execute(sql)
            except Exception:
                pass
        await db.commit()


async def _edit(store: Any, callback: CallbackQuery, text: str, rows: list[list[InlineKeyboardButton]]) -> None:
    markup = InlineKeyboardMarkup(inline_keyboard=rows)
    try:
        await store.safe_edit_message(callback.message, text, markup)
    except Exception:
        try:
            await callback.message.edit_text(text, reply_markup=markup)
        except Exception:
            await callback.message.answer(text, reply_markup=markup)


async def _provider_row(store: Any, provider_id: int) -> tuple[Any, ...] | None:
    await ensure_provider_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT id,name,base_url,catalog_path,token_fingerprint,is_active,
                   last_sync_status,last_sync_at,last_error,adapter_key,
                   COALESCE(auth_mode,'auto'),COALESCE(token_query_key,'api_key')
            FROM client_api_providers WHERE id=?
            """,
            (provider_id,),
        ) as cursor:
            return await cursor.fetchone()


async def _render_list(store: Any, callback: CallbackQuery) -> None:
    await ensure_provider_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT id,name,is_active,last_sync_status,adapter_key
            FROM client_api_providers
            WHERE adapter_key<>'manual'
            ORDER BY id DESC
            """
        ) as cursor:
            providers = await cursor.fetchall()
    rows = [
        [
            InlineKeyboardButton(
                text=f"{'🟢' if int(row[2] or 0) else '⚫'} {_short(row[1], 27)}",
                callback_data=f"cli:provider:{int(row[0])}",
            )
        ]
        for row in providers
    ]
    if not rows:
        rows.append([InlineKeyboardButton(text="لا يوجد مزودون بعد", callback_data="cli:noop")])
    rows.extend(
        [
            [InlineKeyboardButton(text="➕ إضافة مزوّد API", callback_data="cli:provider_add")],
            [store.back_btn("cliadmin:home", "🔙 إدارة المتجر")],
        ]
    )
    await _edit(
        store,
        callback,
        "🔌 مزودو API\n\n"
        "كل مزوّد يحتفظ بتوكنه مشفّرًا. يمكنك تغيير طريقة المصادقة أو تعطيله بدون حذف المنتجات المرتبة.",
        rows,
    )


async def _render_provider(store: Any, callback: CallbackQuery, provider_id: int) -> None:
    row = await _provider_row(store, provider_id)
    if not row:
        return await callback.answer("المزوّد غير موجود.", show_alert=True)
    auth_labels = {
        "auto": "تلقائي (Bearer + X-API-Key)",
        "bearer": "Authorization: Bearer",
        "x_api_key": "X-API-Key",
        "query": f"Query: {row[11]}",
        "none": "بدون توكن",
    }
    token = f"محفوظ •••• {str(row[4])[-6:]}" if row[4] else "غير مضاف"
    last_error = str(row[8] or "").strip()
    text = (
        f"🔌 {html.escape(str(row[1]))}\n\n"
        f"الحالة: {'🟢 مفعّل' if int(row[5] or 0) else '⚫ متوقف'}\n"
        f"Base URL: {html.escape(str(row[2] or '—'))}\n"
        f"Catalog: {html.escape(str(row[3] or '—'))}\n"
        f"Token: {html.escape(token)}\n"
        f"المصادقة: {html.escape(auth_labels.get(str(row[10]), str(row[10])))}\n"
        f"آخر مزامنة: {html.escape(str(row[7] or 'لم تتم'))}\n"
        f"النتيجة: {html.escape(str(row[6] or 'never'))}"
    )
    if last_error:
        text += f"\nآخر خطأ: {html.escape(_short(last_error, 180))}"
    rows = [
        [
            InlineKeyboardButton(text="🔄 مزامنة الآن", callback_data=f"clisync:run:{provider_id}"),
            InlineKeyboardButton(
                text="⚫ إيقاف" if int(row[5] or 0) else "🟢 تفعيل",
                callback_data=f"cpadmin:toggle:{provider_id}",
            ),
        ],
        [
            InlineKeyboardButton(text="🔑 تبديل التوكن", callback_data=f"cpadmin:token:{provider_id}"),
            InlineKeyboardButton(text="🔐 طريقة المصادقة", callback_data=f"cpadmin:auth:{provider_id}"),
        ],
        [
            InlineKeyboardButton(text="🌐 تعديل الرابط", callback_data=f"cpadmin:url:{provider_id}"),
            InlineKeyboardButton(text="📦 تعديل مسار الكتالوج", callback_data=f"cpadmin:path:{provider_id}"),
        ],
        [store.back_btn("cli:providers", "🔙 المزودون")],
    ]
    await _edit(store, callback, text, rows)


def install(store: Any) -> None:
    if getattr(store, "_client_provider_admin_installed", False):
        return

    async def providers(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        await _render_list(store, callback)
        await callback.answer()

    async def provider(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        await _render_provider(store, callback, provider_id)
        await callback.answer()

    _replace_named_handler(store.dp, "callback_query", "providers", providers)
    _replace_named_handler(store.dp, "callback_query", "provider", provider)

    router = Router(name="client_provider_admin")

    @router.callback_query(F.data.startswith("cpadmin:toggle:"))
    async def toggle(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute(
                "SELECT is_active FROM client_api_providers WHERE id=?",
                (provider_id,),
            ) as cursor:
                row = await cursor.fetchone()
            if not row:
                return await callback.answer("المزوّد غير موجود.", show_alert=True)
            new_value = 0 if int(row[0] or 0) else 1
            await db.execute(
                "UPDATE client_api_providers SET is_active=? WHERE id=?",
                (new_value, provider_id),
            )
            await db.commit()
        await callback.answer("تم تحديث حالة المزوّد.", show_alert=True)
        await _render_provider(store, callback, provider_id)

    @router.callback_query(F.data.startswith("cpadmin:token:"))
    async def token_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        await state.clear()
        await state.update_data(cp_provider_id=provider_id)
        await state.set_state(ProviderEditStates.token)
        await callback.message.answer(
            "🔑 أرسل التوكن الجديد الآن.\n"
            "سأحذف رسالتك بعد قراءتها وأحفظ القيمة مشفّرة."
        )
        await callback.answer()

    @router.message(ProviderEditStates.token)
    async def token_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products", "can_manage_sync"):
            await state.clear()
            return
        token = str(message.text or "").strip()
        if len(token) < 4:
            return await message.answer("التوكن قصير جدًا.")
        cipher, fingerprint = _encrypt(store, token)
        provider_id = int((await state.get_data()).get("cp_provider_id") or 0)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                """
                UPDATE client_api_providers
                SET token_cipher=?,token_fingerprint=?,last_sync_status='token_updated',last_error=''
                WHERE id=?
                """,
                (cipher, fingerprint, provider_id),
            )
            await db.commit()
        try:
            await message.delete()
        except Exception:
            pass
        await state.clear()
        await message.answer("✅ تم تبديل التوكن وحفظه مشفّرًا.")

    @router.callback_query(F.data.startswith("cpadmin:url:"))
    async def url_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        await state.clear()
        await state.update_data(cp_provider_id=provider_id)
        await state.set_state(ProviderEditStates.base_url)
        await callback.message.answer("🌐 أرسل Base URL الجديد. يفضّل HTTPS.")
        await callback.answer()

    @router.message(ProviderEditStates.base_url)
    async def url_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products", "can_manage_sync"):
            await state.clear()
            return
        value = str(message.text or "").strip().rstrip("/")
        if not value.startswith("https://"):
            return await message.answer("للأمان استخدم رابط HTTPS يبدأ بـ https://")
        provider_id = int((await state.get_data()).get("cp_provider_id") or 0)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                "UPDATE client_api_providers SET base_url=?,last_sync_status='config_updated' WHERE id=?",
                (value, provider_id),
            )
            await db.commit()
        await state.clear()
        await message.answer("✅ تم تحديث رابط المزوّد.")

    @router.callback_query(F.data.startswith("cpadmin:path:"))
    async def path_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        await state.clear()
        await state.update_data(cp_provider_id=provider_id)
        await state.set_state(ProviderEditStates.catalog_path)
        await callback.message.answer("📦 أرسل مسار الكتالوج الجديد، مثال: /api/products")
        await callback.answer()

    @router.message(ProviderEditStates.catalog_path)
    async def path_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products", "can_manage_sync"):
            await state.clear()
            return
        value = str(message.text or "").strip()
        if not value:
            return await message.answer("المسار لا يمكن أن يكون فارغًا.")
        if not value.startswith("/") and not value.startswith("https://"):
            value = "/" + value
        provider_id = int((await state.get_data()).get("cp_provider_id") or 0)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                "UPDATE client_api_providers SET catalog_path=?,last_sync_status='config_updated' WHERE id=?",
                (value, provider_id),
            )
            await db.commit()
        await state.clear()
        await message.answer("✅ تم تحديث مسار الكتالوج.")

    @router.callback_query(F.data.startswith("cpadmin:auth:"))
    async def auth_menu(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        rows = [
            [InlineKeyboardButton(text="🔐 Bearer Token", callback_data=f"cpadmin:setauth:{provider_id}:bearer")],
            [InlineKeyboardButton(text="🔑 X-API-Key", callback_data=f"cpadmin:setauth:{provider_id}:x_api_key")],
            [InlineKeyboardButton(text="🔗 Query Parameter", callback_data=f"cpadmin:setauth:{provider_id}:query")],
            [InlineKeyboardButton(text="🧪 تلقائي", callback_data=f"cpadmin:setauth:{provider_id}:auto")],
            [InlineKeyboardButton(text="🚫 بدون مصادقة", callback_data=f"cpadmin:setauth:{provider_id}:none")],
            [store.back_btn(f"cli:provider:{provider_id}", "🔙 المزوّد")],
        ]
        await _edit(store, callback, "🔐 اختر طريقة إرسال التوكن لهذا المزوّد:", rows)
        await callback.answer()

    @router.callback_query(F.data.startswith("cpadmin:setauth:"))
    async def auth_set(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        _, _, provider_id_raw, mode = str(callback.data).split(":", 3)
        provider_id = int(provider_id_raw)
        if mode not in {"auto", "bearer", "x_api_key", "query", "none"}:
            return await callback.answer("طريقة غير مدعومة.", show_alert=True)
        if mode == "query":
            await state.clear()
            await state.update_data(cp_provider_id=provider_id, cp_auth_mode=mode)
            await state.set_state(ProviderEditStates.query_key)
            await callback.message.answer(
                "🔗 أرسل اسم query parameter الذي يستقبل التوكن، مثال: api_key أو token"
            )
            return await callback.answer()
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                "UPDATE client_api_providers SET auth_mode=?,last_sync_status='config_updated' WHERE id=?",
                (mode, provider_id),
            )
            await db.commit()
        await callback.answer("✅ تم تحديث طريقة المصادقة.", show_alert=True)
        await _render_provider(store, callback, provider_id)

    @router.message(ProviderEditStates.query_key)
    async def query_key_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products", "can_manage_sync"):
            await state.clear()
            return
        value = str(message.text or "").strip()
        if not value or len(value) > 80 or any(ch.isspace() for ch in value):
            return await message.answer("أرسل اسم حقل قصير بدون مسافات، مثال: api_key")
        provider_id = int((await state.get_data()).get("cp_provider_id") or 0)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                """
                UPDATE client_api_providers
                SET auth_mode='query',token_query_key=?,last_sync_status='config_updated'
                WHERE id=?
                """,
                (value, provider_id),
            )
            await db.commit()
        await state.clear()
        await message.answer("✅ تم ضبط المصادقة عبر query parameter.")

    store.dp.include_router(router)
    store._client_provider_admin_installed = True
