from __future__ import annotations

import html
from typing import Any, Awaitable, Callable

import aiosqlite
from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup

from client_identity import get_store_title
from client_services_store import RANKS, _money, _short
from client_store_admin import ensure_admin_schema


_STATUS = {
    "pending": "⏳ بانتظار المعالجة",
    "processing": "🔄 قيد المعالجة",
    "completed": "✅ مكتمل",
    "cancelled": "❌ ملغي",
}


async def _default_reseller_discount(store: Any) -> float:
    await ensure_admin_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            "SELECT value FROM client_store_settings WHERE key='default_reseller_discount'"
        ) as cursor:
            row = await cursor.fetchone()
    try:
        return max(0.0, min(float(row[0] if row else 0), 100.0))
    except (TypeError, ValueError):
        return 0.0


async def _safe_edit(store: Any, callback: CallbackQuery, text: str, rows: list[list[InlineKeyboardButton]]) -> None:
    markup = InlineKeyboardMarkup(inline_keyboard=rows)
    try:
        await store.safe_edit_message(callback.message, text, markup, parse_mode="HTML")
    except Exception:
        try:
            await callback.message.edit_text(text, reply_markup=markup, parse_mode="HTML")
        except Exception:
            await callback.message.answer(text, reply_markup=markup, parse_mode="HTML")


async def render_account(store: Any, callback: CallbackQuery) -> None:
    await ensure_admin_schema(store)
    user_id = callback.from_user.id
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT COALESCE(username,''),COALESCE(full_name,''),COALESCE(balance,0),
                   COALESCE(joined_date,''),COALESCE(store_user_id,''),
                   COALESCE(account_rank,'customer'),COALESCE(reseller_discount,0)
            FROM users WHERE user_id=?
            """,
            (user_id,),
        ) as cursor:
            user = await cursor.fetchone()
        async with db.execute(
            """
            SELECT COUNT(*),
                   SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN status IN ('pending','processing') THEN 1 ELSE 0 END)
            FROM orders WHERE user_id=?
            """,
            (user_id,),
        ) as cursor:
            order_stats = await cursor.fetchone() or (0, 0, 0)
    if not user:
        await store.create_or_update_user(
            user_id,
            callback.from_user.username,
            callback.from_user.full_name,
        )
        return await render_account(store, callback)

    rank = str(user[5] or "customer")
    custom_discount = float(user[6] or 0)
    default_discount = await _default_reseller_discount(store)
    effective_discount = (
        custom_discount if rank == "reseller" and custom_discount > 0
        else default_discount if rank == "reseller"
        else 0.0
    )
    title = await get_store_title(store)
    username = f"@{html.escape(str(user[0]))}" if user[0] else "بدون معرف"
    text = (
        f"👤 <b>حسابي — {html.escape(title)}</b>\n\n"
        f"الاسم: {html.escape(str(user[1] or callback.from_user.full_name or '—'))}\n"
        f"المعرف: {username}\n"
        f"🆔 رقم الحساب: <code>{html.escape(str(user[4] or user_id))}</code>\n"
        f"الرتبة: {RANKS.get(rank, RANKS['customer'])}\n"
    )
    if rank == "reseller":
        text += f"🎯 خصم الموزع الفعلي: {_money(effective_discount)}%\n"
    text += (
        f"💵 الرصيد: <b>{_money(user[2])} $</b>\n"
        f"📦 كل الطلبات: {int(order_stats[0] or 0)}\n"
        f"✅ مكتملة: {int(order_stats[1] or 0)}\n"
        f"🔄 مفتوحة: {int(order_stats[2] or 0)}\n"
        f"📅 الانضمام: {html.escape(str(user[3] or '—'))}"
    )
    await _safe_edit(
        store,
        callback,
        text,
        [
            [InlineKeyboardButton(text="💳 شحن الرصيد", callback_data="deposit_request")],
            [InlineKeyboardButton(text="📦 طلباتي", callback_data="my_orders")],
            [InlineKeyboardButton(text="🏠 الرئيسية", callback_data="main_menu")],
        ],
    )
    await callback.answer()


async def _orders(store: Any, user_id: int) -> list[tuple[Any, ...]]:
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT o.id,COALESCE(p.name,'طلب'),o.total_price,o.status,o.order_date,
                   COALESCE(o.purchase_flow,''),COALESCE(o.payment_state,''),
                   COALESCE(l.provider_status,''),COALESCE(l.external_order_id,'')
            FROM orders o
            LEFT JOIN products p ON p.id=o.product_id
            LEFT JOIN client_api_order_links l ON l.local_order_id=o.id
            WHERE o.user_id=?
            ORDER BY o.id DESC LIMIT 30
            """,
            (user_id,),
        ) as cursor:
            return await cursor.fetchall()


def _order_badge(order: tuple[Any, ...]) -> str:
    provider_status = str(order[7] or "").lower()
    payment_state = str(order[6] or "").lower()
    if provider_status == "uncertain":
        return "⚠️ تحقق"
    if payment_state == "refunded":
        return "↩️ مسترجع"
    return _STATUS.get(str(order[3] or ""), "📦 طلب")


async def render_orders(store: Any, callback: CallbackQuery) -> None:
    orders = await _orders(store, callback.from_user.id)
    rows: list[list[InlineKeyboardButton]] = []
    for order in orders:
        flow = "🔌" if str(order[5]) == "client_api_generic" else "📝"
        rows.append([
            InlineKeyboardButton(
                text=f"{flow} #{int(order[0])} • {_order_badge(order)} • {_money(order[2])}$",
                callback_data=f"order_detail_{int(order[0])}",
            )
        ])
    if not rows:
        rows.append([InlineKeyboardButton(text="لا توجد طلبات بعد", callback_data="cli:noop")])
    rows.append([InlineKeyboardButton(text="👤 حسابي", callback_data="cli:account")])
    rows.append([InlineKeyboardButton(text="🏠 الرئيسية", callback_data="main_menu")])
    await _safe_edit(
        store,
        callback,
        "📦 <b>طلباتي</b>\n\n"
        "📝 = تجهيز يدوي   🔌 = API\n"
        "افتح أي طلب لمشاهدة حالته وتفاصيله.",
        rows,
    )
    await callback.answer()


async def render_order_detail(store: Any, callback: CallbackQuery, order_id: int) -> None:
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT o.id,COALESCE(p.name,'طلب'),o.total_price,o.status,o.order_date,
                   COALESCE(o.note,''),COALESCE(o.delivery_info,''),
                   COALESCE(o.purchase_flow,''),COALESCE(o.payment_state,''),
                   COALESCE(l.provider_status,''),COALESCE(l.external_order_id,''),
                   COALESCE(l.last_error,'')
            FROM orders o
            LEFT JOIN products p ON p.id=o.product_id
            LEFT JOIN client_api_order_links l ON l.local_order_id=o.id
            WHERE o.id=? AND o.user_id=?
            """,
            (order_id, callback.from_user.id),
        ) as cursor:
            order = await cursor.fetchone()
    if not order:
        return await callback.answer("الطلب غير موجود.", show_alert=True)

    flow = "🔌 API" if str(order[7]) == "client_api_generic" else "📝 يدوي"
    provider_status = str(order[9] or "").strip()
    payment_state = str(order[8] or "").strip().lower()
    state_line = _STATUS.get(str(order[3] or ""), str(order[3] or "—"))
    if provider_status == "uncertain":
        state_line = "⚠️ يحتاج تحقق من المزوّد"
    elif payment_state == "refunded":
        state_line = "↩️ فشل وتم إرجاع الرصيد"

    text = (
        f"📦 <b>الطلب #{int(order[0])}</b>\n\n"
        f"المنتج: {html.escape(_short(order[1], 120))}\n"
        f"💰 المبلغ: {_money(order[2])} $\n"
        f"⚙️ التنفيذ: {flow}\n"
        f"الحالة: {state_line}\n"
        f"📅 التاريخ: {html.escape(str(order[4] or '—'))}"
    )
    if provider_status and provider_status not in {"reserved"}:
        text += f"\n📡 حالة المزوّد: {html.escape(provider_status)}"
    if order[10]:
        text += f"\n🔗 رقم طلب المزوّد: <code>{html.escape(str(order[10]))}</code>"
    if order[6] and str(order[7]) != "client_api_generic":
        text += f"\n🧾 تفاصيل: {html.escape(_short(order[6], 400))}"
    if provider_status == "uncertain":
        text += "\n\n⚠️ لم يُعاد إرسال الطلب ولم يُرجع الرصيد تلقائيًا، لمنع تنفيذ الطلب مرتين."

    await _safe_edit(
        store,
        callback,
        text,
        [
            [InlineKeyboardButton(text="🔙 طلباتي", callback_data="my_orders")],
            [InlineKeyboardButton(text="🏠 الرئيسية", callback_data="main_menu")],
        ],
    )
    await callback.answer()


class ClientCustomerCenterMiddleware(BaseMiddleware):
    def __init__(self, store: Any) -> None:
        self.store = store

    async def __call__(
        self,
        handler: Callable[[CallbackQuery, dict[str, Any]], Awaitable[Any]],
        event: CallbackQuery,
        data: dict[str, Any],
    ) -> Any:
        callback_data = str(getattr(event, "data", "") or "")
        if callback_data == "cli:account":
            await render_account(self.store, event)
            return None
        if callback_data == "my_orders":
            await render_orders(self.store, event)
            return None
        if callback_data.startswith("order_detail_"):
            try:
                order_id = int(callback_data.rsplit("_", 1)[1])
            except ValueError:
                return await handler(event, data)
            await render_order_detail(self.store, event, order_id)
            return None
        return await handler(event, data)


def install(store: Any) -> None:
    if getattr(store, "_client_customer_center_installed", False):
        return
    store.dp.callback_query.outer_middleware(ClientCustomerCenterMiddleware(store))
    store._client_customer_center_installed = True
