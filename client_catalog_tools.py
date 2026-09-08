from __future__ import annotations

import html
from typing import Any

import aiosqlite
from aiogram import F, Router
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from client_services_store import _money, _short
from client_store_admin import _allowed, ensure_admin_schema


class CatalogSearchStates(StatesGroup):
    query = State()


async def _edit(store: Any, callback: CallbackQuery, text: str, rows: list[list[InlineKeyboardButton]]) -> None:
    markup = InlineKeyboardMarkup(inline_keyboard=rows)
    try:
        await store.safe_edit_message(callback.message, text, markup)
    except Exception:
        try:
            await callback.message.edit_text(text, reply_markup=markup)
        except Exception:
            await callback.message.answer(text, reply_markup=markup)


def _admin_panel_wrapper(original: Any):
    def wrapped(perms: dict | None = None, super_admin: bool = False) -> InlineKeyboardMarkup:
        markup = original(perms, super_admin)
        rows = [list(row) for row in markup.inline_keyboard]
        p = perms or {}
        if super_admin or p.get("can_manage_products") or p.get("can_manage_sync"):
            pos = max(len(rows) - 1, 0)
            rows.insert(
                pos,
                [
                    InlineKeyboardButton(text="🔎 بحث المنتجات", callback_data="clicat:search"),
                    InlineKeyboardButton(text="📊 ملخص الكتالوج", callback_data="clicat:summary"),
                ],
            )
        return InlineKeyboardMarkup(inline_keyboard=rows)
    return wrapped


async def _summary(store: Any) -> dict[str, Any]:
    await ensure_admin_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT
                COUNT(*),
                SUM(CASE WHEN status='organized' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status='unorganized' THEN 1 ELSE 0 END),
                SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END),
                SUM(CASE WHEN COALESCE(source_type,'api')='manual' THEN 1 ELSE 0 END),
                SUM(CASE WHEN COALESCE(source_type,'api')='api' THEN 1 ELSE 0 END)
            FROM client_provider_products
            """
        ) as cursor:
            row = await cursor.fetchone() or (0, 0, 0, 0, 0, 0)
        async with db.execute(
            "SELECT COUNT(*) FROM client_api_providers WHERE adapter_key<>'manual' AND is_active=1"
        ) as cursor:
            active_providers = int((await cursor.fetchone() or [0])[0] or 0)
        async with db.execute(
            "SELECT COUNT(*) FROM users WHERE COALESCE(account_rank,'customer')='reseller'"
        ) as cursor:
            resellers = int((await cursor.fetchone() or [0])[0] or 0)
        async with db.execute(
            """
            SELECT COALESCE(SUM(CASE
                WHEN status='organized' AND is_active=1
                THEN MAX(COALESCE(sale_price,0)-COALESCE(provider_price,0),0)
                ELSE 0 END),0)
            FROM client_provider_products
            WHERE COALESCE(source_type,'api')='api'
            """
        ) as cursor:
            margin_sum = float((await cursor.fetchone() or [0])[0] or 0)
    return {
        "total": int(row[0] or 0),
        "organized": int(row[1] or 0),
        "unorganized": int(row[2] or 0),
        "active": int(row[3] or 0),
        "manual": int(row[4] or 0),
        "api": int(row[5] or 0),
        "active_providers": active_providers,
        "resellers": resellers,
        "margin_sum": margin_sum,
    }


async def _render_results(store: Any, target: Message, query: str) -> None:
    await ensure_admin_schema(store)
    needle = query.strip()
    if len(needle) < 2:
        await target.answer("اكتب حرفين على الأقل للبحث.")
        return
    like = f"%{needle}%"
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT p.id,p.name,p.external_id,p.status,p.is_active,p.sale_price,p.provider_price,pr.name
            FROM client_provider_products p
            JOIN client_api_providers pr ON pr.id=p.provider_id
            WHERE p.name LIKE ? COLLATE NOCASE OR p.external_id LIKE ? COLLATE NOCASE
            ORDER BY p.status='unorganized' DESC,p.sort_order,p.id DESC
            LIMIT 40
            """,
            (like, like),
        ) as cursor:
            items = await cursor.fetchall()
    rows = []
    for item in items:
        status = "📥" if str(item[3]) == "unorganized" else "✅"
        enabled = "🟢" if int(item[4] or 0) else "⚫"
        rows.append(
            [
                InlineKeyboardButton(
                    text=f"{status}{enabled} {_short(item[1], 20)} • {_money(item[5] or item[6])}$",
                    callback_data=f"cliadmin:item:{int(item[0])}",
                )
            ]
        )
    rows.append([InlineKeyboardButton(text="🔎 بحث جديد", callback_data="clicat:search")])
    rows.append([InlineKeyboardButton(text="🔙 إدارة المتجر", callback_data="cliadmin:home")])
    text = (
        f"🔎 نتائج البحث عن: {html.escape(needle[:80])}\n\n"
        + (f"تم العثور على {len(items)} نتيجة. اختر منتجًا لإدارته." if items else "لا توجد نتائج مطابقة.")
    )
    await target.answer(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))


def install(store: Any) -> None:
    if getattr(store, "_client_catalog_tools_installed", False):
        return

    store.admin_panel_kb = _admin_panel_wrapper(store.admin_panel_kb)
    router = Router(name="client_catalog_tools")

    @router.callback_query(F.data == "clicat:summary")
    async def summary(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync", "can_view_stats"):
            return await callback.answer("غير مصرح.", show_alert=True)
        data = await _summary(store)
        text = (
            "📊 ملخص كتالوج العميل\n\n"
            f"📦 كل المنتجات: {data['total']}\n"
            f"✅ مرتبة: {data['organized']}\n"
            f"📥 غير مرتبة: {data['unorganized']}\n"
            f"🟢 مفعلة: {data['active']}\n"
            f"🔌 منتجات API: {data['api']}\n"
            f"📝 منتجات يدوية: {data['manual']}\n"
            f"🔗 مزودون مفعلون: {data['active_providers']}\n"
            f"👑 موزعون: {data['resellers']}\n\n"
            f"📈 مجموع هامش الوحدة النظري لمنتجات API المفعلة: {_money(data['margin_sum'])} $\n"
            "هذا الرقم ليس ربحًا محققًا؛ هو مجموع فرق سعر البيع عن تكلفة المزود لكل منتج مرة واحدة."
        )
        await _edit(
            store,
            callback,
            text,
            [
                [InlineKeyboardButton(text="📥 غير مرتبة", callback_data="cli:staged:unorganized")],
                [InlineKeyboardButton(text="✅ إدارة المنتجات", callback_data="cliadmin:items")],
                [store.back_btn("cliadmin:home", "🔙 إدارة المتجر")],
            ],
        )
        await callback.answer()

    @router.callback_query(F.data == "clicat:search")
    async def search_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        await state.clear()
        await state.set_state(CatalogSearchStates.query)
        await callback.message.answer("🔎 أرسل اسم المنتج أو معرفه الخارجي للبحث.")
        await callback.answer()

    @router.message(CatalogSearchStates.query)
    async def search_query(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products", "can_manage_sync"):
            await state.clear()
            return
        query = str(message.text or "").strip()
        await state.clear()
        await _render_results(store, message, query)

    store.dp.include_router(router)
    store._client_catalog_tools_installed = True
