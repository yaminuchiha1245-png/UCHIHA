from __future__ import annotations

from typing import Any

import aiosqlite
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup

from client_identity import get_store_title
from client_store_admin import _replace_named_handler


# Buttons inherited from the original UCHIHA Store or added by client modules
# that should not clutter the root admin panel. They remain reachable through
# the dedicated client-store dashboard.
_REMOVE_EXACT = {
    "admin_categories",
    "admin_products",
    "admin_profit_margin",
    "admin_api_sync_now",
    "admin_api_full_sync",
    "admin_api_sync_status",
    "cli:providers",
    "clisync:list",
    "cli:staged:unorganized",
    "cli:staged:organized",
    "cli:rank",
    "clifields:list",
    "clicat:search",
    "clicat:summary",
    "clipurchase:list",
    "statusadmin:home",
    "cliidentity:home",
}

_REMOVE_PREFIXES = (
    "admin_api_categories",
    "admin_manage_api_products",
)


def _should_remove(callback_data: str | None) -> bool:
    value = str(callback_data or "")
    if value in _REMOVE_EXACT:
        return True
    return any(value.startswith(prefix) for prefix in _REMOVE_PREFIXES)


def _clean_admin_panel(original: Any):
    def wrapped(perms: dict | None = None, super_admin: bool = False) -> InlineKeyboardMarkup:
        markup = original(perms, super_admin)
        cleaned: list[list[InlineKeyboardButton]] = []
        seen_callbacks: set[str] = set()

        for row in markup.inline_keyboard:
            next_row: list[InlineKeyboardButton] = []
            for button in row:
                callback_data = getattr(button, "callback_data", None)
                if _should_remove(callback_data):
                    continue
                callback_key = str(callback_data or "")
                if callback_key and callback_key in seen_callbacks:
                    continue
                if callback_key:
                    seen_callbacks.add(callback_key)
                next_row.append(button)
            if next_row:
                cleaned.append(next_row)

        has_client_home = any(
            getattr(button, "callback_data", None) == "cliadmin:home"
            for row in cleaned
            for button in row
        )
        p = perms or {}
        if not has_client_home and (
            super_admin
            or p.get("can_manage_products")
            or p.get("can_manage_sync")
            or p.get("can_manage_orders")
            or p.get("can_manage_users")
            or p.get("can_manage_settings")
        ):
            home_index = next(
                (
                    index
                    for index, row in enumerate(cleaned)
                    if any(getattr(button, "callback_data", None) == "main_menu" for button in row)
                ),
                len(cleaned),
            )
            cleaned.insert(
                home_index,
                [InlineKeyboardButton(text="🧰 إدارة متجر العميل", callback_data="cliadmin:home")],
            )

        return InlineKeyboardMarkup(inline_keyboard=cleaned)

    return wrapped


async def _dashboard_counts(store: Any) -> dict[str, int]:
    async with aiosqlite.connect(store.DB_PATH) as db:
        queries = {
            "providers": "SELECT COUNT(*) FROM client_api_providers WHERE adapter_key<>'manual'",
            "unorganized": "SELECT COUNT(*) FROM client_provider_products WHERE status='unorganized'",
            "organized": "SELECT COUNT(*) FROM client_provider_products WHERE status='organized'",
            "manual": "SELECT COUNT(*) FROM client_provider_products WHERE COALESCE(source_type,'api')='manual'",
            "resellers": "SELECT COUNT(*) FROM users WHERE COALESCE(account_rank,'customer')='reseller'",
            "processing": "SELECT COUNT(*) FROM orders WHERE status='processing' AND purchase_flow='client_api_generic'",
            "uncertain": "SELECT COUNT(*) FROM client_api_order_links WHERE provider_status='uncertain'",
        }
        result: dict[str, int] = {}
        for key, sql in queries.items():
            try:
                async with db.execute(sql) as cursor:
                    result[key] = int((await cursor.fetchone() or [0])[0] or 0)
            except Exception:
                result[key] = 0
        return result


async def _render_client_dashboard(store: Any, callback: CallbackQuery) -> None:
    user_id = callback.from_user.id
    if not await store.is_admin(user_id):
        return await callback.answer("غير مصرح.", show_alert=True)
    super_admin = await store.is_super_admin(user_id)
    perms = await store.get_admin_perms(user_id)
    counts = await _dashboard_counts(store)
    store_title = await get_store_title(store)

    can_products = super_admin or bool(perms.get("can_manage_products"))
    can_sync = super_admin or bool(perms.get("can_manage_sync"))
    can_users = super_admin or bool(perms.get("can_manage_users"))
    can_orders = super_admin or bool(perms.get("can_manage_orders"))
    can_stats = super_admin or bool(perms.get("can_view_stats"))
    can_settings = super_admin or bool(perms.get("can_manage_settings"))

    rows: list[list[InlineKeyboardButton]] = []
    if can_settings or can_products:
        rows.append([InlineKeyboardButton(text="🏷️ هوية المتجر", callback_data="cliidentity:home")])
    if can_products:
        rows.append([InlineKeyboardButton(text="➕ إضافة منتج يدوي", callback_data="cliadmin:manual:add")])
        rows.append([
            InlineKeyboardButton(text=f"📥 غير مرتبة ({counts['unorganized']})", callback_data="cli:staged:unorganized"),
            InlineKeyboardButton(text=f"✅ المنتجات ({counts['organized']})", callback_data="cliadmin:items"),
        ])
        rows.append([
            InlineKeyboardButton(text="🔎 بحث المنتجات", callback_data="clicat:search"),
            InlineKeyboardButton(text="🧾 متطلبات الطلب", callback_data="clifields:list"),
        ])
    if can_products or can_sync:
        rows.append([
            InlineKeyboardButton(text=f"🔌 مزودو API ({counts['providers']})", callback_data="cli:providers"),
            InlineKeyboardButton(text="🔄 مزامنة API", callback_data="clisync:list"),
        ])
        rows.append([
            InlineKeyboardButton(text="🔁 إعداد شراء API", callback_data="clipurchase:list"),
            InlineKeyboardButton(text=f"📡 متابعة API ({counts['processing']})", callback_data="statusadmin:home"),
        ])
    elif can_orders:
        rows.append([InlineKeyboardButton(text=f"📡 متابعة API ({counts['processing']})", callback_data="statusadmin:home")])
    if can_products or can_users:
        rows.append([InlineKeyboardButton(text=f"👑 إعدادات الموزعين ({counts['resellers']})", callback_data="cliadmin:reseller")])
    if can_users:
        rows.append([InlineKeyboardButton(text="⭐👑 تغيير رتبة حساب", callback_data="cli:rank")])
    if can_stats:
        rows.append([InlineKeyboardButton(text="📊 ملخص الكتالوج", callback_data="clicat:summary")])
    rows.append([store.back_btn("admin_panel", "🔙 لوحة الإدارة")])

    text = (
        f"🧰 {store_title}\n\n"
        f"🔌 مزودو API: {counts['providers']}\n"
        f"📥 غير مرتبة: {counts['unorganized']}\n"
        f"✅ مرتبة: {counts['organized']}\n"
        f"📝 يدوية: {counts['manual']}\n"
        f"👑 موزعون: {counts['resellers']}\n"
        f"🔄 طلبات API قيد المعالجة: {counts['processing']}\n"
        f"⚠️ طلبات غير مؤكدة: {counts['uncertain']}\n\n"
        "كل إعدادات المنتجات والمزودين والشراء الآلي موجودة هنا، بينما تبقى لوحة الإدارة الرئيسية للطلبات والرصيد والدفع والمستخدمين والدعم."
    )
    markup = InlineKeyboardMarkup(inline_keyboard=rows)
    try:
        await store.safe_edit_message(callback.message, text, markup)
    except Exception:
        await callback.message.answer(text, reply_markup=markup)
    await callback.answer()


def install(store: Any) -> None:
    if getattr(store, "_client_admin_cleanup_installed", False):
        return
    store.admin_panel_kb = _clean_admin_panel(store.admin_panel_kb)
    _replace_named_handler(store.dp, "callback_query", "admin_home", _render_client_dashboard)
    store._client_admin_cleanup_installed = True
