from __future__ import annotations

from typing import Any

import aiosqlite
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup

from client_services_store import ROOTS, SUBS, _money, _short
from client_store_admin import _replace_named_handler, ensure_admin_schema


def _main_menu(store: Any, is_admin_user: bool = False) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text="📱 منتجات iOS", callback_data="cli:root:ios")],
        [InlineKeyboardButton(text="🤖 منتجات Android", callback_data="cli:root:android")],
        [InlineKeyboardButton(text="💎 Diamond FF", callback_data="cli:root:diamond_ff")],
        [InlineKeyboardButton(text="💳 شحن رصيد", callback_data="deposit_request")],
        [InlineKeyboardButton(text="👤 حسابي", callback_data="cli:account")],
        [
            InlineKeyboardButton(text="📦 طلباتي", callback_data="my_orders"),
            InlineKeyboardButton(text="📞 الدعم", callback_data="support"),
        ],
    ]
    if is_admin_user:
        rows.append([InlineKeyboardButton(text="⚙️ لوحة الإدارة", callback_data="admin_panel")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def _edit(store: Any, callback: CallbackQuery, text: str, rows: list[list[InlineKeyboardButton]]) -> None:
    markup = InlineKeyboardMarkup(inline_keyboard=rows)
    try:
        await store.safe_edit_message(callback.message, text, markup)
    except Exception:
        try:
            await callback.message.edit_text(text, reply_markup=markup)
        except Exception:
            await callback.message.answer(text, reply_markup=markup)


async def _pricing_context(store: Any, user_id: int) -> tuple[str, float]:
    await ensure_admin_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            "SELECT COALESCE(account_rank,'customer'),COALESCE(reseller_discount,0) FROM users WHERE user_id=?",
            (user_id,),
        ) as cursor:
            row = await cursor.fetchone()
        async with db.execute(
            "SELECT value FROM client_store_settings WHERE key='default_reseller_discount'"
        ) as cursor:
            default_row = await cursor.fetchone()
    rank = str(row[0] if row else "customer")
    discount = float(row[1] or 0) if row else 0.0
    if rank == "reseller" and discount <= 0 and default_row:
        try:
            discount = float(default_row[0] or 0)
        except (TypeError, ValueError):
            discount = 0.0
    return rank, min(max(discount, 0.0), 100.0)


def _display_price(
    sale_price: Any,
    provider_price: Any,
    reseller_price: Any,
    *,
    rank: str,
    discount: float,
) -> float:
    sale = max(float(sale_price or provider_price or 0), 0.0)
    if rank != "reseller":
        return sale
    fixed = max(float(reseller_price or 0), 0.0)
    if fixed > 0:
        return fixed
    return round(sale * (1 - discount / 100), 2)


async def _render_products(
    store: Any,
    callback: CallbackQuery,
    root: str,
    sub: str,
    back: str,
) -> None:
    await ensure_admin_schema(store)
    rank, discount = await _pricing_context(store, callback.from_user.id)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT p.id,p.name,p.sale_price,p.provider_price,COALESCE(p.reseller_price,0)
            FROM client_provider_products p
            JOIN client_api_providers pr ON pr.id=p.provider_id
            WHERE p.status='organized' AND p.is_active=1 AND pr.is_active=1
              AND p.root_code=? AND p.sub_code=?
            ORDER BY p.sort_order,p.name COLLATE NOCASE LIMIT 60
            """,
            (root, sub),
        ) as cursor:
            products = await cursor.fetchall()
    rows: list[list[InlineKeyboardButton]] = []
    for product in products:
        price = _display_price(
            product[2],
            product[3],
            product[4],
            rank=rank,
            discount=discount,
        )
        rows.append(
            [
                InlineKeyboardButton(
                    text=f"{_short(product[1], 24)} — {_money(price)} $",
                    callback_data=f"cli:product:{int(product[0])}",
                )
            ]
        )
    if not rows:
        rows.append([InlineKeyboardButton(text="لا توجد منتجات مضافة بعد", callback_data="cli:noop")])
    rows.append([store.back_btn(back, "🔙 رجوع")])
    label = SUBS.get(root, {}).get(sub, ROOTS.get(root, "📦 المنتجات"))
    pricing_note = "\n👑 الأسعار المعروضة هي أسعار الموزع." if rank == "reseller" else ""
    await _edit(
        store,
        callback,
        f"{label}\n\n" + ("اختر المنتج:" if products else "لا توجد منتجات متاحة حاليًا.") + pricing_note,
        rows,
    )


def install(store: Any) -> None:
    if getattr(store, "_client_ui_refinement_installed", False):
        return

    store.main_menu_kb = lambda is_admin_user=False: _main_menu(store, is_admin_user)

    async def root(callback: CallbackQuery) -> None:
        root_code = str(callback.data).split(":", 2)[2]
        if root_code in SUBS:
            rows = [
                [InlineKeyboardButton(text=label, callback_data=f"cli:sub:{root_code}:{code}")]
                for code, label in SUBS[root_code].items()
            ]
            rows.append([store.back_btn("main_menu", "🏠 الرئيسية")])
            await _edit(store, callback, f"{ROOTS[root_code]}\n\nاختر القسم:", rows)
        else:
            await _render_products(store, callback, root_code, "", "main_menu")
        await callback.answer()

    async def sub(callback: CallbackQuery) -> None:
        _, _, root_code, sub_code = str(callback.data).split(":", 3)
        await _render_products(store, callback, root_code, sub_code, f"cli:root:{root_code}")
        await callback.answer()

    _replace_named_handler(store.dp, "callback_query", "root", root)
    _replace_named_handler(store.dp, "callback_query", "sub", sub)

    store._client_ui_refinement_installed = True
