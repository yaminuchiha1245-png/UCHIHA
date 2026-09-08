from __future__ import annotations

import html
import re
from typing import Any, Awaitable, Callable

import aiosqlite
from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery

from client_store_admin import _allowed, _replace_named_handler


_LEGACY_PAYMENT_PREFIXES = ("admin_binance", "admin_shamcash")
_METHOD_ID_RE = re.compile(r"(?:^|_)(\d+)$")


async def _local_payment_methods(store: Any) -> list[tuple[Any, ...]]:
    """Return only owner-managed local/manual payment methods."""
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT id, name, details, is_active, provider, icon, sort_order, last_synced,
                   min_amount, transfer_value, payment_mode, proof_mode
            FROM payment_methods
            WHERE COALESCE(provider,'local') IN ('', 'local')
              AND COALESCE(payment_mode,'manual') = 'manual'
            ORDER BY is_active DESC, sort_order ASC, name COLLATE NOCASE ASC
            """
        ) as cursor:
            return await cursor.fetchall()


class ClientPaymentIsolationMiddleware(BaseMiddleware):
    """Block legacy automatic-payment admin routes in client instances.

    The client may still use the original manual payment-method workflow and
    deposit-request workflow, because those values are entered by the store
    owner inside Telegram and do not depend on inherited environment secrets.
    """

    def __init__(self, store: Any) -> None:
        self.store = store

    async def __call__(
        self,
        handler: Callable[[CallbackQuery, dict[str, Any]], Awaitable[Any]],
        event: CallbackQuery,
        data: dict[str, Any],
    ) -> Any:
        callback_data = str(getattr(event, "data", "") or "")
        if callback_data.startswith(_LEGACY_PAYMENT_PREFIXES):
            await event.answer(
                "هذه بوابة دفع قديمة غير مفعلة في نسخة العميل. استخدم «طرق الدفع» لإضافة طريقة يدوية من داخل البوت.",
                show_alert=True,
            )
            return None

        # Protect against a crafted callback opening a non-local payment method
        # that might exist in a reused database from the original UCHIHA Store.
        if callback_data.startswith("admin_pm_"):
            match = _METHOD_ID_RE.search(callback_data)
            if match:
                method_id = int(match.group(1))
                async with aiosqlite.connect(self.store.DB_PATH) as db:
                    try:
                        async with db.execute(
                            "SELECT COALESCE(provider,'local'),COALESCE(payment_mode,'manual') "
                            "FROM payment_methods WHERE id=?",
                            (method_id,),
                        ) as cursor:
                            row = await cursor.fetchone()
                    except Exception:
                        row = None
                if row and (str(row[0] or "local") not in {"", "local"} or str(row[1] or "manual") != "manual"):
                    await event.answer(
                        "طريقة الدفع هذه تخص تكاملًا قديمًا وغير متاحة في نسخة العميل.",
                        show_alert=True,
                    )
                    return None

        return await handler(event, data)


async def _render_manual_payment_methods(store: Any, callback: CallbackQuery, state: Any) -> None:
    if not await _allowed(store, callback.from_user.id, "can_manage_payments"):
        return await callback.answer("⛔ لا تملك صلاحية إدارة الدفع.", show_alert=True)
    try:
        await state.clear()
    except Exception:
        pass

    methods = await _local_payment_methods(store)
    active_count = sum(1 for method in methods if int(method[3] or 0))
    text = (
        "💳 <b>طرق الدفع — نسخة العميل</b>\n\n"
        f"الطرق اليدوية: <b>{len(methods)}</b>\n"
        f"المفعلة: <b>{active_count}</b>\n\n"
        "كل طريقة هنا يضيفها صاحب البوت بنفسه من داخل لوحة الإدارة.\n"
        "يمكن تحديد اسم الطريقة، بيانات التحويل، العملة، الحدود، الرسوم، ونوع إثبات الدفع.\n\n"
        "🔐 لا تستخدم هذه الشاشة أي Binance/ShamCash API Token من البيئة."
    )
    markup = store.admin_payment_methods_kb(methods)
    try:
        await store.safe_edit_message(callback.message, text, markup, parse_mode="HTML")
    except TypeError:
        await store.safe_edit_message(callback.message, text, markup)
    await callback.answer()


def _filter_admin_panel(original: Any):
    def wrapped(perms: dict | None = None, super_admin: bool = False):
        markup = original(perms, super_admin)
        rows = []
        for row in markup.inline_keyboard:
            filtered = [
                button
                for button in row
                if not str(getattr(button, "callback_data", "") or "").startswith(_LEGACY_PAYMENT_PREFIXES)
            ]
            if filtered:
                rows.append(filtered)
        return type(markup)(inline_keyboard=rows)

    return wrapped


def install(store: Any) -> None:
    if getattr(store, "_client_payment_policy_installed", False):
        return

    # Keep the original, well-tested manual payment editor but replace its root
    # listing with a client-only view that excludes legacy automatic providers.
    _replace_named_handler(
        store.dp,
        "callback_query",
        "cb_admin_payment_methods",
        lambda callback, state: _render_manual_payment_methods(store, callback, state),
    )

    store.admin_panel_kb = _filter_admin_panel(store.admin_panel_kb)
    store.dp.callback_query.outer_middleware(ClientPaymentIsolationMiddleware(store))
    store._client_payment_policy_installed = True
