from __future__ import annotations

import html
from typing import Any

import aiosqlite
from aiogram import F, Router
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from client_services_store import RANKS, _money, _short
from client_store_admin import _allowed, _replace_named_handler, ensure_admin_schema


class ResellerAdminStates(StatesGroup):
    search = State()
    discount = State()


async def _edit(store: Any, callback: CallbackQuery, text: str, rows: list[list[InlineKeyboardButton]]) -> None:
    markup = InlineKeyboardMarkup(inline_keyboard=rows)
    try:
        await store.safe_edit_message(callback.message, text, markup)
    except Exception:
        try:
            await callback.message.edit_text(text, reply_markup=markup)
        except Exception:
            await callback.message.answer(text, reply_markup=markup)


async def _default_discount(store: Any) -> float:
    await ensure_admin_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            "SELECT value FROM client_store_settings WHERE key='default_reseller_discount'"
        ) as cursor:
            row = await cursor.fetchone()
    try:
        return min(max(float(row[0] if row else 0), 0.0), 100.0)
    except (TypeError, ValueError):
        return 0.0


async def _user_row(store: Any, user_id: int) -> tuple[Any, ...] | None:
    await ensure_admin_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT user_id,COALESCE(username,''),COALESCE(full_name,''),COALESCE(balance,0),
                   COALESCE(account_rank,'customer'),COALESCE(reseller_discount,0),
                   COALESCE(joined_date,'')
            FROM users WHERE user_id=?
            """,
            (user_id,),
        ) as cursor:
            return await cursor.fetchone()


async def _render_home(store: Any, callback: CallbackQuery) -> None:
    await ensure_admin_schema(store)
    discount = await _default_discount(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM users WHERE COALESCE(account_rank,'customer')='reseller'"
        ) as cursor:
            resellers = int((await cursor.fetchone() or [0])[0] or 0)
        async with db.execute("SELECT COUNT(*) FROM users") as cursor:
            users = int((await cursor.fetchone() or [0])[0] or 0)
    await _edit(
        store,
        callback,
        "👑 إدارة الموزعين\n\n"
        f"👥 كل العملاء: {users}\n"
        f"👑 الموزعون: {resellers}\n"
        f"🎯 الخصم الافتراضي: {_money(discount)}%\n\n"
        "افتح أي حساب لتغيير رتبته أو وضع خصم خاص له.",
        [
            [
                InlineKeyboardButton(text="👑 قائمة الموزعين", callback_data="clireseller:list:resellers"),
                InlineKeyboardButton(text="👥 أحدث العملاء", callback_data="clireseller:list:users"),
            ],
            [InlineKeyboardButton(text="🔎 البحث عن حساب", callback_data="clireseller:search")],
            [InlineKeyboardButton(text="🎯 الخصم الافتراضي", callback_data="cliadmin:reseller:default")],
            [store.back_btn("cliadmin:home", "🔙 إدارة المتجر")],
        ],
    )


async def _render_list(store: Any, callback: CallbackQuery, mode: str) -> None:
    await ensure_admin_schema(store)
    where = "WHERE COALESCE(account_rank,'customer')='reseller'" if mode == "resellers" else ""
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            f"""
            SELECT user_id,COALESCE(username,''),COALESCE(full_name,''),
                   COALESCE(account_rank,'customer'),COALESCE(reseller_discount,0)
            FROM users {where}
            ORDER BY rowid DESC LIMIT 50
            """
        ) as cursor:
            users = await cursor.fetchall()
    rows: list[list[InlineKeyboardButton]] = []
    for row in users:
        username = f"@{row[1]}" if row[1] else _short(row[2] or row[0], 18)
        rank_icon = "👑" if str(row[3]) == "reseller" else "⭐"
        discount = f" • {_money(row[4])}%" if str(row[3]) == "reseller" and float(row[4] or 0) > 0 else ""
        rows.append([
            InlineKeyboardButton(
                text=f"{rank_icon} {_short(username, 20)}{discount}",
                callback_data=f"clireseller:user:{int(row[0])}",
            )
        ])
    if not rows:
        rows.append([InlineKeyboardButton(text="لا توجد حسابات هنا", callback_data="cli:noop")])
    rows.append([store.back_btn("cliadmin:reseller", "🔙 الموزعون")])
    label = "👑 الموزعون" if mode == "resellers" else "👥 أحدث العملاء"
    await _edit(store, callback, f"{label}\n\nاختر الحساب لإدارته:", rows)


async def _render_user(store: Any, callback: CallbackQuery, user_id: int) -> None:
    row = await _user_row(store, user_id)
    if not row:
        return await callback.answer("الحساب غير موجود.", show_alert=True)
    default_discount = await _default_discount(store)
    rank = str(row[4] or "customer")
    custom_discount = float(row[5] or 0)
    effective_discount = custom_discount if rank == "reseller" and custom_discount > 0 else default_discount if rank == "reseller" else 0
    username = f"@{html.escape(str(row[1]))}" if row[1] else "—"
    text = (
        "👤 حساب العميل\n\n"
        f"الاسم: {html.escape(str(row[2] or '—'))}\n"
        f"المعرف: {username}\n"
        f"🆔 Telegram ID: <code>{int(row[0])}</code>\n"
        f"الرتبة: {RANKS.get(rank, RANKS['customer'])}\n"
        f"💵 الرصيد: {_money(row[3])} $\n"
        f"🎯 الخصم الخاص: {_money(custom_discount)}%\n"
        f"📌 الخصم الفعلي: {_money(effective_discount)}%\n"
        f"📅 الانضمام: {html.escape(str(row[6] or '—'))}"
    )
    rows = [
        [InlineKeyboardButton(
            text="⭐ تحويل إلى عميل" if rank == "reseller" else "👑 ترقية إلى موزع",
            callback_data=f"clireseller:toggle:{int(row[0])}",
        )],
        [InlineKeyboardButton(text="🎯 تعديل الخصم الخاص", callback_data=f"clireseller:discount:{int(row[0])}")],
        [InlineKeyboardButton(text="🧹 استخدام الخصم الافتراضي", callback_data=f"clireseller:reset:{int(row[0])}")],
        [store.back_btn("clireseller:list:resellers" if rank == "reseller" else "clireseller:list:users", "🔙 القائمة")],
    ]
    await _edit(store, callback, text, rows)


def install(store: Any) -> None:
    if getattr(store, "_client_reseller_admin_installed", False):
        return

    async def reseller(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_users"):
            return await callback.answer("غير مصرح.", show_alert=True)
        await _render_home(store, callback)
        await callback.answer()

    _replace_named_handler(store.dp, "callback_query", "reseller", reseller)
    router = Router(name="client_reseller_admin")

    @router.callback_query(F.data.startswith("clireseller:list:"))
    async def list_users(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_users"):
            return await callback.answer("غير مصرح.", show_alert=True)
        mode = str(callback.data).rsplit(":", 1)[1]
        if mode not in {"resellers", "users"}:
            return await callback.answer("قائمة غير صالحة.", show_alert=True)
        await _render_list(store, callback, mode)
        await callback.answer()

    @router.callback_query(F.data.startswith("clireseller:user:"))
    async def user_detail(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_users"):
            return await callback.answer("غير مصرح.", show_alert=True)
        user_id = int(str(callback.data).rsplit(":", 1)[1])
        await _render_user(store, callback, user_id)
        await callback.answer()

    @router.callback_query(F.data.startswith("clireseller:toggle:"))
    async def toggle_rank(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_users"):
            return await callback.answer("غير مصرح.", show_alert=True)
        user_id = int(str(callback.data).rsplit(":", 1)[1])
        row = await _user_row(store, user_id)
        if not row:
            return await callback.answer("الحساب غير موجود.", show_alert=True)
        new_rank = "customer" if str(row[4]) == "reseller" else "reseller"
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute("UPDATE users SET account_rank=? WHERE user_id=?", (new_rank, user_id))
            await db.commit()
        await callback.answer(f"تم تحديث الرتبة إلى {RANKS[new_rank]}.", show_alert=True)
        await _render_user(store, callback, user_id)

    @router.callback_query(F.data.startswith("clireseller:discount:"))
    async def discount_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_users"):
            return await callback.answer("غير مصرح.", show_alert=True)
        user_id = int(str(callback.data).rsplit(":", 1)[1])
        if not await _user_row(store, user_id):
            return await callback.answer("الحساب غير موجود.", show_alert=True)
        await state.clear()
        await state.update_data(clireseller_uid=user_id)
        await state.set_state(ResellerAdminStates.discount)
        await callback.message.answer("🎯 أرسل الخصم الخاص من 0 إلى 100. سيصبح الحساب موزعًا تلقائيًا.")
        await callback.answer()

    @router.message(ResellerAdminStates.discount)
    async def discount_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_users"):
            await state.clear(); return
        try:
            discount = float(str(message.text or "").replace(",", ".").strip())
            if discount < 0 or discount > 100:
                raise ValueError
        except ValueError:
            return await message.answer("أرسل نسبة صحيحة من 0 إلى 100.")
        user_id = int((await state.get_data()).get("clireseller_uid") or 0)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                "UPDATE users SET account_rank='reseller',reseller_discount=? WHERE user_id=?",
                (round(discount, 2), user_id),
            )
            await db.commit()
        await state.clear()
        await message.answer("✅ تم حفظ خصم الموزع.")

    @router.callback_query(F.data.startswith("clireseller:reset:"))
    async def reset_discount(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_users"):
            return await callback.answer("غير مصرح.", show_alert=True)
        user_id = int(str(callback.data).rsplit(":", 1)[1])
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute("UPDATE users SET reseller_discount=0 WHERE user_id=?", (user_id,))
            await db.commit()
        await callback.answer("أصبح الحساب يستخدم الخصم الافتراضي.", show_alert=True)
        await _render_user(store, callback, user_id)

    @router.callback_query(F.data == "clireseller:search")
    async def search_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_users"):
            return await callback.answer("غير مصرح.", show_alert=True)
        await state.clear()
        await state.set_state(ResellerAdminStates.search)
        await callback.message.answer("🔎 أرسل Telegram ID أو @username أو جزءًا من اسم العميل.")
        await callback.answer()

    @router.message(ResellerAdminStates.search)
    async def search_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_users"):
            await state.clear(); return
        query = str(message.text or "").strip().lstrip("@")[:80]
        await state.clear()
        if not query:
            return await message.answer("أرسل قيمة للبحث.")
        await ensure_admin_schema(store)
        async with aiosqlite.connect(store.DB_PATH) as db:
            if query.isdigit():
                async with db.execute(
                    "SELECT user_id,username,full_name,account_rank FROM users WHERE user_id=? LIMIT 1",
                    (int(query),),
                ) as cursor:
                    rows_db = await cursor.fetchall()
            else:
                like = f"%{query}%"
                async with db.execute(
                    """
                    SELECT user_id,username,full_name,account_rank FROM users
                    WHERE username LIKE ? COLLATE NOCASE OR full_name LIKE ? COLLATE NOCASE
                    ORDER BY rowid DESC LIMIT 20
                    """,
                    (like, like),
                ) as cursor:
                    rows_db = await cursor.fetchall()
        rows = [[InlineKeyboardButton(
            text=f"{'👑' if str(row[3] or 'customer') == 'reseller' else '⭐'} "
                 f"{_short('@' + str(row[1]) if row[1] else row[2] or row[0], 24)}",
            callback_data=f"clireseller:user:{int(row[0])}",
        )] for row in rows_db]
        if not rows:
            rows.append([InlineKeyboardButton(text="لا توجد نتائج", callback_data="cli:noop")])
        rows.append([InlineKeyboardButton(text="🔎 بحث جديد", callback_data="clireseller:search")])
        rows.append([InlineKeyboardButton(text="🔙 الموزعون", callback_data="cliadmin:reseller")])
        await message.answer(
            f"🔎 نتائج البحث: {html.escape(query)}",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=rows),
        )

    store.dp.include_router(router)
    store._client_reseller_admin_installed = True
