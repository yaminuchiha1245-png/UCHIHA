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
_STATE = {"worker": False, "last_ok": "", "last_error": "", "last_approved": 0}


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
            "UPDATE payment_methods SET is_active=? WHERE provider='binance' AND external_id='binance_usdt_auto'",
            (1 if active else 0,),
        )
        await db.commit()


async def _test_connection(store: Any) -> dict[str, Any]:
    if not store.BINANCE_AUTO_PAY_ENABLED:
        return {"ok": False, "message": "الدفع التلقائي غير مفعّل في Railway."}
    if not store.BINANCE_API_KEY or not store.BINANCE_API_SECRET:
        return {"ok": False, "message": "مفتاح Binance أو السر غير موجود في Railway."}
    try:
        await store.BINANCE_WALLET._sync_time(force=True)
        address = await store.BINANCE_WALLET.deposit_address()
        now_ms = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
        history = await store.BINANCE_WALLET.deposit_history(now_ms - 86_400_000, now_ms)
        method_id = await store.ensure_binance_payment_method()
        if not await _runtime_enabled(store):
            await _method_active(store, False)
        _STATE.update(last_ok=datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), last_error="")
        return {
            "ok": True,
            "message": "الاتصال والتوقيع وصلاحية قراءة المحفظة تعمل.",
            "address": str(address.get("address") or ""),
            "history": len(history),
            "method_id": method_id,
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
        _STATE.update(last_approved=approved, last_error="")
        return {"ok": True, "approved": approved, "message": "اكتملت المزامنة."}
    except Exception as exc:
        _STATE["last_error"] = _clean(store, exc)
        return {"ok": False, "approved": 0, "message": _STATE["last_error"]}


async def _dashboard_text(store: Any) -> tuple[str, dict[str, Any]]:
    async with aiosqlite.connect(store.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT is_active,transfer_value,last_synced FROM payment_methods "
            "WHERE provider='binance' AND external_id='binance_usdt_auto' LIMIT 1"
        ) as cur:
            method = await cur.fetchone()
        async with db.execute(
            "SELECT status,COUNT(*) count,COALESCE(SUM(credited_amount),0) total "
            "FROM deposit_requests WHERE payment_snapshot LIKE '%binance_deposit%' GROUP BY status"
        ) as cur:
            rows = await cur.fetchall()
        async with db.execute(
            "SELECT auto_checked_at,auto_error FROM deposit_requests "
            "WHERE auto_error<>'' ORDER BY id DESC LIMIT 1"
        ) as cur:
            error_row = await cur.fetchone()
    counts = {str(row["status"]): int(row["count"]) for row in rows}
    total = sum(float(row["total"] or 0) for row in rows if row["status"] == "approved")
    enabled = await _runtime_enabled(store)
    configured = bool(store.BINANCE_AUTO_PAY_ENABLED and store.BINANCE_API_KEY and store.BINANCE_API_SECRET)
    address = str(method["transfer_value"] or "") if method else str(store.BINANCE_DEPOSIT_ADDRESS or "")
    last_error = _STATE["last_error"] or (str(error_row["auto_error"] or "") if error_row else "")
    text = [
        "🟡 <b>مركز Binance للدفع التلقائي</b>", "━━━━━━━━━━━━━━━━", "",
        f"{'✅' if configured else '❌'} إعدادات API: <b>{'مكتملة' if configured else 'ناقصة'}</b>",
        f"{'🟢' if enabled else '🔴'} استقبال الدفعات: <b>{'يعمل' if enabled else 'متوقف'}</b>",
        f"{'🟢' if method and method['is_active'] else '🔴'} طريقة الدفع: <b>{'مفعلة' if method and method['is_active'] else 'غير مفعلة'}</b>",
        f"{'🟢' if _STATE['worker'] else '⚪'} عامل المراقبة: <b>{'يعمل' if _STATE['worker'] else 'بانتظار التشغيل'}</b>",
        f"🪙 العملة: <b>{html.escape(store.BINANCE_COIN)}</b>",
        f"🌐 الشبكة: <b>{html.escape(store.BINANCE_NETWORK)}</b>",
        f"📍 العنوان: <code>{html.escape(_mask(address))}</code>",
        f"⏱ الفحص التلقائي: كل <b>{store.BINANCE_POLL_SECONDS}</b> ثانية", "",
        f"⏳ المنتظرة: <b>{counts.get('waiting_payment', 0)}</b>",
        f"✅ المؤكدة: <b>{counts.get('approved', 0)}</b>",
        f"⌛ المنتهية/الملغاة: <b>{counts.get('expired', 0) + counts.get('cancelled', 0)}</b>",
        f"💰 إجمالي الرصيد المضاف: <b>{total:.2f} USD</b>", "",
        "🔐 المفاتيح لا تظهر ولا تُحفظ داخل قاعدة البيانات.",
    ]
    if _STATE["last_ok"]:
        text.append(f"🕓 آخر اتصال ناجح: <b>{html.escape(_STATE['last_ok'])}</b>")
    if last_error:
        text.append(f"⚠️ آخر خطأ: <code>{html.escape(_clean(store, last_error, 220))}</code>")
    return "\n".join(text), {"enabled": enabled, "configured": configured, "counts": counts}


def _panel(store: Any, data: dict[str, Any]) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text="🧪 اختبار الاتصال", callback_data="admin_binance_test"), InlineKeyboardButton(text="🔄 مزامنة الآن", callback_data="admin_binance_sync")],
        [InlineKeyboardButton(text="⏳ الدفعات المنتظرة", callback_data="admin_binance_pending"), InlineKeyboardButton(text="✅ آخر العمليات", callback_data="admin_binance_history")],
        [InlineKeyboardButton(text="⚠️ آخر الأخطاء", callback_data="admin_binance_errors"), InlineKeyboardButton(text="⚙️ الإعداد", callback_data="admin_binance_setup")],
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
    icons = {"waiting_payment": "⏳", "approved": "✅", "expired": "⌛", "cancelled": "🚫", "rejected": "❌"}
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

    async def check(req_id: int):
        if not await _runtime_enabled(store):
            return "paused", "دفع Binance متوقف مؤقتًا من لوحة الإدارة."
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

    @router.callback_query(F.data == "admin_binance_test")
    async def test(callback: CallbackQuery):
        if not await guard(callback): return
        if _LOCK.locked():
            await callback.answer("هناك عملية قيد التنفيذ.", show_alert=True); return
        await callback.answer("جارٍ اختبار الاتصال…")
        async with _LOCK: result = await _test_connection(store)
        title = "✅ <b>اختبار Binance ناجح</b>" if result["ok"] else "❌ <b>فشل اختبار Binance</b>"
        extra = f"\n\n📍 العنوان: <code>{html.escape(_mask(result.get('address', '')))}</code>\n📥 إيداعات 24 ساعة: <b>{result.get('history', 0)}</b>" if result["ok"] else ""
        await callback.message.answer(f"{title}\n\n<code>{html.escape(_clean(store, result['message']))}</code>{extra}", parse_mode="HTML", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[store.back_btn("admin_binance", "🔙 مركز Binance")]]))

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
        if not (store.BINANCE_AUTO_PAY_ENABLED and store.BINANCE_API_KEY and store.BINANCE_API_SECRET):
            await callback.answer("أكمل متغيرات Binance في Railway أولًا.", show_alert=True); return
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
    async def pending(callback: CallbackQuery): await show(callback, ("waiting_payment",), "⏳ <b>دفعات Binance المنتظرة</b>")

    @router.callback_query(F.data == "admin_binance_history")
    async def history(callback: CallbackQuery): await show(callback, ("approved", "expired", "cancelled", "rejected"), "✅ <b>آخر عمليات Binance</b>")

    @router.callback_query(F.data == "admin_binance_errors")
    async def errors(callback: CallbackQuery):
        if not await guard(callback): return
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute("SELECT auto_checked_at,auto_error FROM deposit_requests WHERE auto_error<>'' ORDER BY id DESC LIMIT 10") as cur: rows = await cur.fetchall()
        text = "✅ <b>لا توجد أخطاء Binance مسجلة.</b>" if not rows else "⚠️ <b>آخر أخطاء Binance</b>\n\n" + "\n\n".join(f"<b>{html.escape(str(date))}</b>\n<code>{html.escape(_clean(store, error, 180))}</code>" for date, error in rows)
        await store.safe_edit_message(callback.message, text, InlineKeyboardMarkup(inline_keyboard=[[store.back_btn("admin_binance")]]), parse_mode="HTML"); await callback.answer()

    @router.callback_query(F.data == "admin_binance_setup")
    async def setup(callback: CallbackQuery):
        if not await guard(callback): return
        text = "⚙️ <b>متغيرات Railway المطلوبة</b>\n\n<code>BINANCE_AUTO_PAY_ENABLED=1</code>\n<code>BINANCE_API_KEY=...</code>\n<code>BINANCE_API_SECRET=...</code>\n<code>BINANCE_COIN=USDT</code>\n<code>BINANCE_NETWORK=TRX</code>\n\n🔐 استخدم صلاحية قراءة المحفظة فقط، ولا تفعّل التداول أو السحب."
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
