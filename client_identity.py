from __future__ import annotations

import html
import os
from typing import Any, Awaitable, Callable

import aiosqlite
from aiogram import BaseMiddleware, F, Router
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from client_store_admin import _allowed, ensure_admin_schema


class IdentityStates(StatesGroup):
    title = State()


def _clean_title(value: Any) -> str:
    return " ".join(str(value or "").split())[:80] or "متجر الخدمات"


async def ensure_identity(store: Any) -> None:
    await ensure_admin_schema(store)
    env_title = _clean_title(os.getenv("CLIENT_STORE_NAME", ""))
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            "SELECT value FROM client_store_settings WHERE key='store_title'"
        ) as cursor:
            row = await cursor.fetchone()
        current = str(row[0] or "").strip() if row else ""
        if not current:
            await db.execute(
                "INSERT OR REPLACE INTO client_store_settings(key,value) VALUES('store_title',?)",
                (env_title,),
            )
        elif current == "متجر الخدمات" and env_title != "متجر الخدمات":
            # Fresh client databases receive the name entered during first-run
            # setup. Later admin edits are kept because they no longer equal the
            # untouched default.
            await db.execute(
                "UPDATE client_store_settings SET value=? WHERE key='store_title'",
                (env_title,),
            )
        await db.commit()


async def get_store_title(store: Any) -> str:
    await ensure_identity(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            "SELECT value FROM client_store_settings WHERE key='store_title'"
        ) as cursor:
            row = await cursor.fetchone()
    return _clean_title(row[0] if row else os.getenv("CLIENT_STORE_NAME", ""))


class ClientStartMiddleware(BaseMiddleware):
    """Own exact /start while preserving deep-link /start payloads from the base store."""

    def __init__(self, store: Any) -> None:
        self.store = store

    async def __call__(
        self,
        handler: Callable[[Message, dict[str, Any]], Awaitable[Any]],
        event: Message,
        data: dict[str, Any],
    ) -> Any:
        text = str(getattr(event, "text", "") or "").strip()
        if text != "/start":
            return await handler(event, data)

        user = getattr(event, "from_user", None)
        if user is None:
            return await handler(event, data)
        user_id = int(user.id)
        try:
            if await self.store.is_banned(user_id):
                await event.answer("🚫 لا يمكنك استخدام البوت حاليًا.")
                return None
        except Exception:
            pass

        try:
            await self.store.create_or_update_user(
                user_id,
                getattr(user, "username", None),
                getattr(user, "full_name", None),
            )
        except Exception:
            pass

        title = await get_store_title(self.store)
        is_admin_user = False
        try:
            is_admin_user = bool(await self.store.is_admin(user_id))
        except Exception:
            pass
        first_name = html.escape(str(getattr(user, "first_name", "") or "").strip())
        greeting = f"أهلًا {first_name} 👋\n\n" if first_name else "أهلًا بك 👋\n\n"
        await event.answer(
            greeting
            + f"🏪 <b>{html.escape(title)}</b>\n\n"
            + "اختر القسم الذي تريد من القائمة الرئيسية:",
            parse_mode="HTML",
            reply_markup=self.store.main_menu_kb(is_admin_user),
        )
        return None


async def _edit(store: Any, callback: CallbackQuery, text: str, rows: list[list[InlineKeyboardButton]]) -> None:
    markup = InlineKeyboardMarkup(inline_keyboard=rows)
    try:
        await store.safe_edit_message(callback.message, text, markup)
    except Exception:
        try:
            await callback.message.edit_text(text, reply_markup=markup)
        except Exception:
            await callback.message.answer(text, reply_markup=markup)


def install(store: Any) -> None:
    if getattr(store, "_client_identity_installed", False):
        return

    original_init_db = store.init_db

    async def init_db() -> None:
        await original_init_db()
        await ensure_identity(store)

    store.init_db = init_db
    store.dp.message.outer_middleware(ClientStartMiddleware(store))
    router = Router(name="client_identity")

    @router.callback_query(F.data == "cliidentity:home")
    async def identity_home(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_settings", "can_manage_products"):
            return await callback.answer("غير مصرح.", show_alert=True)
        title = await get_store_title(store)
        await _edit(
            store,
            callback,
            "🏷️ هوية المتجر\n\n"
            f"الاسم الحالي: <b>{html.escape(title)}</b>\n\n"
            "هذا الاسم يظهر للعميل عند /start ولا يحتاج تعديل الكود.",
            [
                [InlineKeyboardButton(text="✏️ تغيير اسم المتجر", callback_data="cliidentity:title")],
                [store.back_btn("cliadmin:home", "🔙 إدارة المتجر")],
            ],
        )
        await callback.answer()

    @router.callback_query(F.data == "cliidentity:title")
    async def title_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_settings", "can_manage_products"):
            return await callback.answer("غير مصرح.", show_alert=True)
        await state.clear()
        await state.set_state(IdentityStates.title)
        await callback.message.answer("🏷️ أرسل اسم المتجر الجديد، حتى 80 حرفًا.")
        await callback.answer()

    @router.message(IdentityStates.title)
    async def title_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_settings", "can_manage_products"):
            await state.clear()
            return
        value = _clean_title(message.text)
        if len(value) < 2:
            return await message.answer("اكتب اسمًا أوضح للمتجر.")
        await ensure_identity(store)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                "INSERT OR REPLACE INTO client_store_settings(key,value) VALUES('store_title',?)",
                (value,),
            )
            await db.commit()
        await state.clear()
        await message.answer(f"✅ تم تغيير اسم المتجر إلى: {value}")

    store.dp.include_router(router)
    store._client_identity_installed = True
