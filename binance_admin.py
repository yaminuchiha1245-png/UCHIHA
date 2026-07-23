#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Binance control center for the UCHIHA Telegram admin panel."""

from __future__ import annotations

import asyncio
import datetime
import html
import logging
from typing import Any

import aiosqlite
from aiogram import F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup

from binance_compat import normalize_binance_network

_LOG = logging.getLogger("binance_admin")
_LOCK = asyncio.Lock()
_STATE = {
    "worker": False,
    "last_ok": "",
    "last_sync": "",
    "last_error": "",
    "last_approved": 0,
}


def _clean(store: Any, value: Any, limit: int = 350) -> str:
    fn = getattr(store, "clean_api_text", None)
    return str(fn(value, limit) if callable(fn) else " ".join(str(value or "").split())[:limit])


def _mask(value: str) -> str:
    value = str(value or "").strip()
    return "غير متوفر" if not value else value if len(value) <= 18 else f"{value[:8]}…{value[-6:]}"


async def _allowed(store: Any, user_id: int) -> bool:
    if not await store.is_admin(user_id):
        return False
    if await store.is_super_admin(user_id):
        return True
    return bool((await store.get_admin_perms(user_id)).get("can_manage_payments"))


async def _runtime_enabled(store: Any) -> bool:
    if not store.BINANCE_AUTO_PAY_ENABLED:
        return False
    return await store.get_setting("binance_runtime_enabled", "1") == "1"


async def _method_active(store: Any, active: bool) -> None:
    async with aiosqlite.connect(store.DB_PATH) as db:
        await db.execute(
            "UPDATE payment_methods SET is_active=? "
            "WHERE provider='binance' AND auto_provider='binance_deposit'",
            (1 if active else 0,),
        )
        await db.commit()


async def _test_connection(store: Any) -> dict[str, Any]:
    config_error = str(store.binance_payment_configuration_error() or "")
    if config_error:
        return {"ok": False, "message": config_error}
    provider = str(store.binance_verification_provider())
    try:
        history: list[Any] = []
        chain: dict[str, Any] = {}
        pay_error = ""
        if provider in {"trongrid", "dual"}:
            chain = await store.TRON_GRID.test_connection()
        if provider in {"binance_pay", "dual"}:
            if store.binance_pay_history_ready():
                try:
                    await store.BINANCE_WALLET._sync_time(force=True)
                    now_ms = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
                    history = await store.BINANCE_WALLET.pay_trade_history(
                        now_ms - 86_400_000,
                        now_ms,
                    )
                except Exception as exc:
                    # A public Pay ID can still receive money. When Binance API
                    # is unavailable, requests are reserved for admin review and
                    # are never credited from customer input alone.
                    pay_error = _clean(store, exc)
            else:
                pay_error = "مفتاحا Binance API غير موجودين؛ دفعات Pay تنتقل للمراجعة اليدوية."
        elif provider == "binance":
            await store.BINANCE_WALLET._sync_time(force=True)
            address_info = await store.BINANCE_WALLET.deposit_address()
            now_ms = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
            history = await store.BINANCE_WALLET.deposit_history(now_ms - 86_400_000, now_ms)
        else:
            address_info = {"address": store.BINANCE_DEPOSIT_ADDRESS}
        method_id = await store.ensure_binance_payment_method()
        if not await _runtime_enabled(store):
            await _method_active(store, False)
        _STATE.update(
            last_ok=datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            last_error=pay_error,
        )
        if provider == "dual":
            message = (
                "اتصال TronGrid يعمل والطريقتان ظاهرتان. "
                + (
                    "فحص Binance Pay الآلي محجوب أو غير متاح؛ دفعات Pay تنتقل للمراجعة اليدوية الآمنة."
                    if pay_error
                    else "قراءة سجل Binance Pay تعمل أيضًا."
                )
            )
        elif provider == "binance_pay":
            message = (
                "Pay ID جاهز للاستقبال، لكن فحص Binance Pay الآلي غير متاح؛ "
                "الدفعات تنتقل للمراجعة اليدوية الآمنة."
                if pay_error
                else "الاتصال والتوقيع وقراءة سجل Binance Pay تعمل."
            )
        elif provider == "trongrid":
            message = "اتصال TronGrid وقراءة شبكة TRON يعملان؛ لا حاجة لاتصال Binance API."
        else:
            message = "الاتصال والتوقيع وصلاحية قراءة محفظة Binance تعمل."
        return {
            "ok": True,
            "degraded": bool(pay_error),
            "message": message,
            "address": str(
                (address_info.get("address") if provider == "binance" else "") or ""
            ),
            "pay_id": str(store.BINANCE_PAY_ID if provider in {"binance_pay", "dual"} else ""),
            "deposit_address": str(
                store.BINANCE_DEPOSIT_ADDRESS if provider in {"trongrid", "dual"} else ""
            ),
            "history": len(history),
            "method_id": method_id,
            "provider": provider,
            "block_number": int(chain.get("block_number") or 0),
            "pay_error": pay_error,
        }
    except Exception as exc:
        _STATE["last_error"] = _clean(store, exc)
        return {"ok": False, "message": _STATE["last_error"]}


async def _sync(store: Any) -> dict[str, Any]:
    test = await _test_connection(store)
    if not test["ok"]:
        return {"ok": False, "approved": 0, "message": test["message"]}
    try:
        approved = int(await store.check_binance_pending_once())
        _STATE.update(
            last_sync=datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            last_approved=approved,
            last_error="",
        )
        return {"ok": True, "approved": approved, "message": "اكتملت المزامنة."}
    except Exception as exc:
        _STATE["last_error"] = _clean(store, exc)
        return {"ok": False, "approved": 0, "message": _STATE["last_error"]}


async def _dashboard_text(store: Any) -> tuple[str, dict[str, Any]]:
    async with aiosqlite.connect(store.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT external_id,is_active,transfer_value,last_synced FROM payment_methods "
            "WHERE provider='binance' AND external_id IN "
            "('binance_usdt_auto','binance_usdt_tron_auto')"
        ) as cur:
            method_rows = await cur.fetchall()
        async with db.execute(
            "SELECT status,COUNT(*) count,COALESCE(SUM(credited_amount),0) total "
            "FROM deposit_requests WHERE payment_snapshot LIKE '%binance_deposit%' GROUP BY status"
        ) as cur:
            status_rows = await cur.fetchall()
        async with db.execute(
            "SELECT auto_checked_at,auto_error FROM deposit_requests "
            "WHERE auto_error<>'' AND payment_snapshot LIKE '%binance_deposit%' "
            "ORDER BY id DESC LIMIT 1"
        ) as cur:
            error_row = await cur.fetchone()
    counts = {str(row["status"]): int(row["count"]) for row in status_rows}
    total = sum(
        float(row["total"] or 0)
        for row in status_rows
        if row["status"] == "approved"
    )
    enabled = await _runtime_enabled(store)
    configured = bool(store.binance_payment_ready())
    provider = str(store.binance_verification_provider())
    methods = {str(row["external_id"]): row for row in method_rows}
    primary_method = methods.get("binance_usdt_auto")
    tron_method = methods.get("binance_usdt_tron_auto")
    pay_id = str(
        (primary_method["transfer_value"] if primary_method and provider in {"binance_pay", "dual"} else "")
        or getattr(store, "BINANCE_PAY_ID", "")
    )
    if provider == "dual":
        deposit_address = str(
            (tron_method["transfer_value"] if tron_method else "")
            or getattr(store, "BINANCE_DEPOSIT_ADDRESS", "")
        )
    else:
        deposit_address = str(
            (primary_method["transfer_value"] if primary_method and provider != "binance_pay" else "")
            or getattr(store, "BINANCE_DEPOSIT_ADDRESS", "")
        )
    last_error = _STATE["last_error"] or (str(error_row["auto_error"] or "") if error_row else "")
    network_label_fn = getattr(store, "_binance_network_label", None)
    network_label = (
        str(network_label_fn(store.BINANCE_NETWORK))
        if callable(network_label_fn)
        else str(store.BINANCE_NETWORK)
    )
    pay_lines = [
            "📲 القناة: <b>Binance Pay الداخلي</b>",
            f"🆔 Pay ID: <code>{html.escape(_mask(pay_id))}</code>",
            "🔎 مصدر التحقق: <b>سجل معاملات Binance Pay الواردة</b>",
            "🧾 التحقق: <b>المبلغ نفسه + Transaction ID</b>",
            f"🔐 مفاتيح فحص Pay: <b>{'موجودة — اختبر الاتصال' if store.binance_pay_history_ready() else 'غير مكتملة — مراجعة يدوية آمنة'}</b>",
    ]
    chain_lines = [
            f"🌐 الشبكة: <b>{html.escape(network_label)}</b>",
            f"📍 العنوان: <code>{html.escape(_mask(deposit_address))}</code>",
            f"🔎 مصدر التحقق: <b>{'شبكة TRON عبر TronGrid' if provider == 'trongrid' else 'سجل إيداع Binance'}</b>",
            "🧾 التحقق: <b>المبلغ نفسه + TXID / Hash</b>" if getattr(store, "BINANCE_VERIFICATION_MODE", "reference") == "reference" else "🧮 التحقق: <b>المبلغ الكسري المميز</b>",
    ]
    if provider == "dual":
        chain_lines[2] = "🔎 مصدر التحقق: <b>شبكة TRON عبر TronGrid</b>"
        destination_lines = [
            "<b>الخيار 1 — Binance Pay ID</b>",
            *pay_lines,
            "",
            "<b>الخيار 2 — USDT TRC20</b>",
            *chain_lines,
        ]
    elif provider == "binance_pay":
        destination_lines = pay_lines
    else:
        destination_lines = chain_lines
    expected_methods = 2 if provider == "dual" else 1
    visible_methods = sum(int(row["is_active"] or 0) for row in method_rows)
    methods_visible = visible_methods == expected_methods
    text = [
        "🟡 <b>مركز Binance AutoPay</b>", "━━━━━━━━━━━━━━━━", "",
        "<b>حالة الخدمة</b>",
        f"{'🟢' if configured else '🔴'} ربط التحقق: <b>{'جاهز' if configured else 'المتغيرات ناقصة'}</b>",
        f"{'🟢' if enabled else '🔴'} استقبال دفعات جديدة: <b>{'يعمل' if enabled else 'متوقف'}</b>",
        f"{'🟢' if _STATE['worker'] else '⚪'} المراقبة التلقائية: <b>{'تعمل الآن' if _STATE['worker'] else 'بانتظار تشغيل البوت'}</b>",
        f"{'🟢' if methods_visible else '🔴'} الظهور للعملاء: <b>{visible_methods}/{expected_methods} طريقة مفعّلة</b>",
        "",
        "<b>إعداد الدفع</b>",
        f"🪙 العملة: <b>{html.escape(store.BINANCE_COIN)}</b>",
        *destination_lines,
        f"⏱ الفحص: كل <b>{store.BINANCE_POLL_SECONDS}</b> ثانية",
        f"⌛ مهلة كل طلب: <b>{store.BINANCE_PAYMENT_WINDOW_MINUTES} دقيقة</b>",
        "",
        "<b>ملخص العمليات</b>",
        f"⏳ بانتظار الدفع: <b>{counts.get('waiting_payment', 0)}</b>",
        f"🟠 بانتظار مراجعة الإدارة: <b>{counts.get('pending', 0)}</b>",
        f"✅ مؤكدة تلقائيًا: <b>{counts.get('approved', 0)}</b>",
        f"⌛ منتهية أو ملغاة: <b>{counts.get('expired', 0) + counts.get('cancelled', 0)}</b>",
        f"💰 الرصيد المضاف: <b>{total:.2f} USD</b>",
        "",
        "🛡 تحقق للقراءة فقط؛ لا سحب ولا تداول ولا موافقة تلقائية عند فشل الفحص.",
        "🔐 مفاتيح API تبقى داخل Railway ولا تظهر في البوت أو قاعدة البيانات.",
    ]
    if _STATE["last_ok"]:
        text.append(f"🕓 آخر اتصال ناجح: <b>{html.escape(_STATE['last_ok'])}</b>")
    if _STATE["last_sync"]:
        text.append(
            f"🔄 آخر مزامنة: <b>{html.escape(_STATE['last_sync'])}</b> — "
            f"دفعات جديدة: <b>{int(_STATE['last_approved'])}</b>"
        )
    if last_error:
        text.append(f"⚠️ آخر خطأ: <code>{html.escape(_clean(store, last_error, 220))}</code>")
    return "\n".join(text), {
        "enabled": enabled,
        "configured": configured,
        "counts": counts,
        "visible_methods": visible_methods,
        "expected_methods": expected_methods,
    }


def _panel(store: Any, data: dict[str, Any]) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text="🧪 فحص الربط", callback_data="admin_binance_test"), InlineKeyboardButton(text="⚡ مزامنة الدفعات", callback_data="admin_binance_sync")],
        [InlineKeyboardButton(text="⏳ قيد الانتظار", callback_data="admin_binance_pending"), InlineKeyboardButton(text="📜 سجل الدفعات", callback_data="admin_binance_history")],
        [InlineKeyboardButton(text="🧯 سجل الأخطاء", callback_data="admin_binance_errors"), InlineKeyboardButton(text="📘 طريقة الإعداد", callback_data="admin_binance_setup")],
        [InlineKeyboardButton(text="🔄 تحديث لوحة الحالة", callback_data="admin_binance_refresh")],
    ]
    if data["configured"]:
        rows.append([InlineKeyboardButton(text="⏸ إيقاف Binance" if data["enabled"] else "▶️ تشغيل Binance", callback_data="admin_binance_toggle")])
    rows.append([store.back_btn("admin_panel", "🔙 لوحة الإدارة")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def _requests(store: Any, statuses: tuple[str, ...]) -> list[Any]:
    marks = ",".join("?" for _ in statuses)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            f"SELECT id,user_id,expected_amount,credited_amount,status FROM deposit_requests "
            f"WHERE status IN ({marks}) AND payment_snapshot LIKE '%binance_deposit%' ORDER BY id DESC LIMIT 12",
            statuses,
        ) as cur:
            return await cur.fetchall()


def _request_panel(store: Any, rows: list[Any]) -> InlineKeyboardMarkup:
    icons = {"waiting_payment": "⏳", "pending": "🟠", "approved": "✅", "expired": "⌛", "cancelled": "🚫", "rejected": "❌"}
    keyboard = [[InlineKeyboardButton(
        text=f"{icons.get(str(status), '•')} #{req_id} • {user_id} • {store._money(expected or credited or 0)} {store.BINANCE_COIN}",
        callback_data=f"admin_dep_{int(req_id)}",
    )] for req_id, user_id, expected, credited, status in rows]
    keyboard.append([store.back_btn("admin_binance", "🔙 رجوع")])
    return InlineKeyboardMarkup(inline_keyboard=keyboard)


def _patch(store: Any) -> None:
    original_panel = store.admin_panel_kb
    original_create = store.create_binance_deposit_request
    original_check = store.check_binance_request
    original_pending = store.check_binance_pending_once
    original_match = store._deposit_matches_request
    original_worker = store.binance_payment_worker

    def admin_panel(perms: dict | None = None, super_admin: bool = False):
        markup = original_panel(perms, super_admin)
        if not (super_admin or bool((perms or {}).get("can_manage_payments"))):
            return markup
        rows = [list(row) for row in markup.inline_keyboard]
        if not any(button.callback_data == "admin_binance" for row in rows for button in row):
            rows.insert(max(0, len(rows) - 1), [InlineKeyboardButton(text="🟡 مركز Binance", callback_data="admin_binance")])
        return InlineKeyboardMarkup(inline_keyboard=rows)

    async def create(*args, **kwargs):
        if not await _runtime_enabled(store):
            message = args[0] if args else kwargs.get("message")
            if message:
                await message.answer("❌ دفع Binance متوقف مؤقتًا من لوحة الإدارة.")
            return None
        return await original_create(*args, **kwargs)

    async def check(req_id: int, submitted_reference: str = ""):
        if not await _runtime_enabled(store):
            return "paused", "دفع Binance متوقف مؤقتًا من لوحة الإدارة."
        if submitted_reference:
            return await original_check(req_id, submitted_reference)
        return await original_check(req_id)

    async def pending():
        return await original_pending() if await _runtime_enabled(store) else 0

    def match(deposit: dict[str, Any], request: dict[str, Any]) -> bool:
        normalized = dict(deposit or {})
        normalized["network"] = normalize_binance_network(normalized.get("network", ""))
        return original_match(normalized, request)

    async def worker():
        _STATE["worker"] = True
        try:
            await original_worker()
        finally:
            _STATE["worker"] = False

    store.admin_panel_kb = admin_panel
    store.create_binance_deposit_request = create
    store.check_binance_request = check
    store.check_binance_pending_once = pending
    store._deposit_matches_request = match
    store.binance_payment_worker = worker


def _router(store: Any) -> Router:
    router = Router(name="uchiha_binance_admin")

    async def guard(callback: CallbackQuery) -> bool:
        if await _allowed(store, callback.from_user.id):
            return True
        await callback.answer("⛔ لا تملك صلاحية إدارة الدفع.", show_alert=True)
        return False

    async def render(callback: CallbackQuery, answer: bool = True):
        text, data = await _dashboard_text(store)
        await store.safe_edit_message(callback.message, text, _panel(store, data), parse_mode="HTML")
        if answer:
            await callback.answer()

    @router.callback_query(F.data == "admin_binance")
    async def dashboard(callback: CallbackQuery):
        if await guard(callback):
            await render(callback)

    @router.callback_query(F.data == "admin_binance_refresh")
    async def refresh(callback: CallbackQuery):
        if await guard(callback):
            await render(callback)

    @router.callback_query(F.data == "admin_binance_test")
    async def test(callback: CallbackQuery):
        if not await guard(callback): return
        if _LOCK.locked():
            await callback.answer("هناك عملية قيد التنفيذ.", show_alert=True); return
        await callback.answer("جارٍ اختبار الاتصال…")
        async with _LOCK: result = await _test_connection(store)
        title = (
            "⚠️ <b>الدفع جاهز مع مراجعة Pay يدوية</b>"
            if result.get("ok") and result.get("degraded")
            else "✅ <b>اختبار Binance ناجح</b>"
            if result.get("ok")
            else "❌ <b>فشل اختبار Binance</b>"
        )
        extra = ""
        if result["ok"]:
            provider = str(result.get("provider") or "")
            if provider == "dual":
                extra = (
                    f"\n\n🆔 Pay ID: <code>{html.escape(_mask(result.get('pay_id', '')))}</code>\n"
                    f"📥 معاملات Pay خلال 24 ساعة: <b>{result.get('history', 0)}</b>\n"
                    f"📍 عنوان TRC20: <code>{html.escape(_mask(result.get('deposit_address', '')))}</code>\n"
                    f"⛓ آخر كتلة TRON: <b>{int(result.get('block_number', 0))}</b>\n"
                    "💳 طرق الدفع المنشأة: <b>2</b>"
                )
            elif provider == "binance_pay":
                extra = (
                    f"\n\n🆔 Pay ID: <code>{html.escape(_mask(result.get('pay_id', '')))}</code>\n"
                    f"📥 معاملات Pay خلال 24 ساعة: <b>{result.get('history', 0)}</b>\n"
                    f"💳 طريقة الدفع: <b>#{result.get('method_id', 0)}</b>"
                )
            elif provider == "trongrid":
                extra = (
                    f"\n\n📍 العنوان: <code>{html.escape(_mask(result.get('deposit_address', '')))}</code>\n"
                    f"⛓ آخر كتلة TRON: <b>{int(result.get('block_number', 0))}</b>\n"
                    f"💳 طريقة الدفع: <b>#{result.get('method_id', 0)}</b>"
                )
            else:
                extra = (
                    f"\n\n📍 العنوان: <code>{html.escape(_mask(result.get('address', '')))}</code>\n"
                    f"📥 إيداعات 24 ساعة: <b>{result.get('history', 0)}</b>\n"
                    f"💳 طريقة الدفع: <b>#{result.get('method_id', 0)}</b>"
                )
        await callback.message.answer(f"{title}\n\n{html.escape(_clean(store, result['message']))}{extra}", parse_mode="HTML", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[store.back_btn("admin_binance", "🔙 مركز Binance")]]))

    @router.callback_query(F.data == "admin_binance_sync")
    async def sync(callback: CallbackQuery):
        if not await guard(callback): return
        if _LOCK.locked():
            await callback.answer("المزامنة تعمل حاليًا.", show_alert=True); return
        await callback.answer("بدأت المزامنة…")
        async with _LOCK: result = await _sync(store)
        text = f"✅ <b>اكتملت المزامنة</b>\n\nالدفعات الجديدة: <b>{result['approved']}</b>" if result["ok"] else f"❌ <b>فشلت المزامنة</b>\n\n<code>{html.escape(_clean(store, result['message']))}</code>"
        await callback.message.answer(text, parse_mode="HTML", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[store.back_btn("admin_binance", "🔙 مركز Binance")]]))

    @router.callback_query(F.data == "admin_binance_toggle")
    async def toggle(callback: CallbackQuery):
        if not await guard(callback): return
        if not store.binance_payment_ready():
            await callback.answer(store.binance_payment_configuration_error(), show_alert=True); return
        enabled = not await _runtime_enabled(store)
        await store.set_setting("binance_runtime_enabled", "1" if enabled else "0")
        await _method_active(store, enabled)
        await callback.answer("تم تشغيل Binance." if enabled else "تم إيقاف Binance مؤقتًا.", show_alert=True)
        await render(callback, False)

    async def show(callback: CallbackQuery, statuses: tuple[str, ...], title: str):
        if not await guard(callback): return
        rows = await _requests(store, statuses)
        text = f"{title}\n\nالعدد: <b>{len(rows)}</b>" if rows else "✅ لا توجد عمليات في هذا القسم."
        keyboard = _request_panel(store, rows) if rows else InlineKeyboardMarkup(inline_keyboard=[[store.back_btn("admin_binance")]])
        await store.safe_edit_message(callback.message, text, keyboard, parse_mode="HTML"); await callback.answer()

    @router.callback_query(F.data == "admin_binance_pending")
    async def pending(callback: CallbackQuery): await show(callback, ("waiting_payment", "pending"), "⏳ <b>دفعات Binance المنتظرة والمراجعة</b>")

    @router.callback_query(F.data == "admin_binance_history")
    async def history(callback: CallbackQuery): await show(callback, ("approved", "expired", "cancelled", "rejected"), "✅ <b>آخر عمليات Binance</b>")

    @router.callback_query(F.data == "admin_binance_errors")
    async def errors(callback: CallbackQuery):
        if not await guard(callback): return
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute("SELECT auto_checked_at,auto_error FROM deposit_requests WHERE auto_error<>'' AND payment_snapshot LIKE '%binance_deposit%' ORDER BY id DESC LIMIT 10") as cur: rows = await cur.fetchall()
        text = "✅ <b>لا توجد أخطاء Binance مسجلة.</b>" if not rows else "⚠️ <b>آخر أخطاء Binance</b>\n\n" + "\n\n".join(f"<b>{html.escape(str(date))}</b>\n<code>{html.escape(_clean(store, error, 180))}</code>" for date, error in rows)
        await store.safe_edit_message(callback.message, text, InlineKeyboardMarkup(inline_keyboard=[[store.back_btn("admin_binance")]]), parse_mode="HTML"); await callback.answer()

    @router.callback_query(F.data == "admin_binance_setup")
    async def setup(callback: CallbackQuery):
        if not await guard(callback): return
        provider = store.binance_verification_provider()
        if provider == "dual":
            text = (
                "📘 <b>إعداد طريقتي Binance</b>\n\n"
                "يظهر للعميل خيار <b>Binance Pay ID</b> وخيار <b>USDT TRC20</b> كلٌ على حدة.\n\n"
                "<code>BINANCE_AUTO_PAY_ENABLED=1</code>\n"
                "<code>BINANCE_VERIFICATION_PROVIDER=dual</code>\n"
                "<code>BINANCE_VERIFICATION_MODE=reference</code>\n"
                "<code>BINANCE_COIN=USDT</code>\n"
                "<code>BINANCE_PAY_ID=رقم_Pay_ID_العام</code>\n"
                "<code>BINANCE_API_KEY=مفتاح_API_للقراءة_فقط</code>\n"
                "<code>BINANCE_API_SECRET=السر</code>\n"
                "<code>BINANCE_NETWORK=TRX</code>\n"
                "<code>BINANCE_DEPOSIT_ADDRESS=T...</code>\n"
                "<code>TRONGRID_API_KEY=مفتاح_TronGrid</code>\n\n"
                "يتحقق خيار الشبكة آليًا من TXID على TRON. ويتحقق خيار Pay من Transaction ID "
                "عبر Binance API؛ إذا حجبته Binance ينتقل الطلب للمراجعة اليدوية من دون إضافة الرصيد.\n\n"
                "🔐 لا تفعّل السحب أو التداول في مفتاح Binance."
            )
        elif provider == "binance_pay":
            text = "📘 <b>إعداد Binance Pay ID</b>\n\n1️⃣ انسخ Pay ID العام من تطبيق Binance.\n2️⃣ ضعه داخل Railway مع مفاتيح API للقراءة فقط.\n3️⃣ أعد النشر ثم اضغط «فحص الربط».\n\n<code>BINANCE_AUTO_PAY_ENABLED=1</code>\n<code>BINANCE_VERIFICATION_PROVIDER=binance_pay</code>\n<code>BINANCE_VERIFICATION_MODE=reference</code>\n<code>BINANCE_COIN=USDT</code>\n<code>BINANCE_PAY_ID=رقمك_فقط</code>\n<code>BINANCE_API_KEY=مفتاحك</code>\n<code>BINANCE_API_SECRET=السر</code>\n\nيرسل العميل المبلغ نفسه إلى Pay ID ثم يرسل <b>Transaction ID</b>. لا يُضاف الرصيد إلا بعد مطابقته مع معاملة USDT واردة. إذا حجبت Binance API خادم Railway، ينتقل الطلب تلقائيًا إلى مراجعة الإدارة من دون شحن الرصيد.\n\n🔐 فعّل القراءة فقط ولا تفعّل السحب مطلقًا."
        else:
            text = "📘 <b>إعداد Binance AutoPay عبر TRON</b>\n\n1️⃣ انسخ عنوان إيداع USDT على شبكة TRC20 من Binance.\n2️⃣ أنشئ API Key مجانيًا من TronGrid للقراءة فقط.\n3️⃣ ضع القيم داخل Railway وأعد النشر ثم اضغط «فحص الربط».\n\n<code>BINANCE_AUTO_PAY_ENABLED=1</code>\n<code>BINANCE_VERIFICATION_MODE=reference</code>\n<code>BINANCE_VERIFICATION_PROVIDER=trongrid</code>\n<code>BINANCE_COIN=USDT</code>\n<code>BINANCE_NETWORK=TRX</code>\n<code>BINANCE_DEPOSIT_ADDRESS=T...</code>\n<code>TRONGRID_API_KEY=...</code>\n\nيدفع العميل المبلغ نفسه ثم يرسل <b>TXID / Hash</b>. يتحقق البوت من المعاملة المثبتة وعقد USDT الرسمي والمبلغ والعنوان ومنع التكرار."
        await store.safe_edit_message(callback.message, text, InlineKeyboardMarkup(inline_keyboard=[[store.back_btn("admin_binance")]]), parse_mode="HTML"); await callback.answer()

    return router


def install(store: Any) -> None:
    if getattr(store, "_binance_admin_installed", False):
        return
    store.BINANCE_NETWORK = normalize_binance_network(getattr(store, "BINANCE_NETWORK", "TRX"))
    _patch(store)
    store.dp.include_router(_router(store))
    store._binance_admin_installed = True
    _LOG.info("UCHIHA Binance admin center installed")


__all__ = ["install"]
