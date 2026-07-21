#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Binance operations center for UCHIHA Telegram administrators."""

from __future__ import annotations

import asyncio
import datetime as dt
import html
from typing import Any

import aiosqlite
from aiogram import F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup

_LOCK = asyncio.Lock()
_LAST: dict[str, str | int] = {"time": "", "error": "", "approved": 0}


def _now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _mask(value: str) -> str:
    value = str(value or "").strip()
    if not value:
        return "غير متوفر"
    return value if len(value) < 18 else f"{value[:8]}…{value[-6:]}"


async def _allowed(store: Any, user_id: int) -> bool:
    if not await store.is_admin(user_id):
        return False
    if await store.is_super_admin(user_id):
        return True
    return bool((await store.get_admin_perms(user_id)).get("can_manage_payments"))


async def _guard(store: Any, call: CallbackQuery) -> bool:
    if await _allowed(store, call.from_user.id):
        return True
    await call.answer("⛔ لا تملك صلاحية إدارة الدفع.", show_alert=True)
    return False


async def _runtime_enabled(store: Any) -> bool:
    default = "1" if bool(store.BINANCE_AUTO_PAY_ENABLED) else "0"
    return await store.get_setting("binance_runtime_enabled", default) == "1"


async def _set_method(store: Any, active: bool) -> None:
    async with aiosqlite.connect(store.DB_PATH) as db:
        await db.execute(
            "UPDATE payment_methods SET is_active=? WHERE auto_provider='binance_deposit'",
            (1 if active else 0,),
        )
        await db.commit()


async def _stats(store: Any) -> dict[str, Any]:
    async with aiosqlite.connect(store.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id,is_active,transfer_value,last_synced FROM payment_methods "
            "WHERE auto_provider='binance_deposit' LIMIT 1"
        ) as cur:
            method = await cur.fetchone()
        async with db.execute(
            "SELECT status,COUNT(*) n,COALESCE(SUM(credited_amount),0) total "
            "FROM deposit_requests WHERE payment_snapshot LIKE '%binance_deposit%' GROUP BY status"
        ) as cur:
            rows = await cur.fetchall()
    counts = {str(r["status"]): int(r["n"]) for r in rows}
    total = sum(float(r["total"] or 0) for r in rows if str(r["status"]) == "approved")
    return {
        "method": dict(method) if method else {},
        "counts": counts,
        "total": total,
        "runtime": await _runtime_enabled(store),
        "configured": bool(store.BINANCE_AUTO_PAY_ENABLED and store.BINANCE_API_KEY and store.BINANCE_API_SECRET),
    }


async def _text(store: Any) -> tuple[str, dict[str, Any]]:
    data = await _stats(store)
    method = data["method"]
    counts = data["counts"]
    status = "🟢 يعمل" if data["runtime"] and data["configured"] else "🔴 متوقف"
    configured = "✅ مكتمل" if data["configured"] else "❌ ناقص"
    method_state = "✅ نشطة" if method and method.get("is_active") else "⛔ غير نشطة"
    last_error = html.escape(str(_LAST.get("error") or "لا يوجد"))
    text = (
        "🟡 <b>مركز Binance</b>\n"
        "━━━━━━━━━━━━━━━━\n\n"
        f"الحالة: <b>{status}</b>\n"
        f"الإعداد: <b>{configured}</b>\n"
        f"طريقة الدفع: <b>{method_state}</b>\n"
        f"العملة/الشبكة: <b>{html.escape(store.BINANCE_COIN)} / {html.escape(store.BINANCE_NETWORK)}</b>\n"
        f"العنوان: <code>{html.escape(_mask(str(method.get('transfer_value') or store.BINANCE_DEPOSIT_ADDRESS)))}</code>\n\n"
        f"⏳ منتظرة: <b>{counts.get('waiting_payment', 0)}</b>\n"
        f"✅ مؤكدة: <b>{counts.get('approved', 0)}</b>\n"
        f"⌛ منتهية: <b>{counts.get('expired', 0)}</b>\n"
        f"💰 إجمالي الرصيد المعتمد: <b>{data['total']:.2f} USD</b>\n\n"
        f"آخر مزامنة: <b>{html.escape(str(_LAST.get('time') or method.get('last_synced') or 'لم تتم'))}</b>\n"
        f"آخر دفعات اعتمدت: <b>{int(_LAST.get('approved') or 0)}</b>\n"
        f"آخر خطأ: <code>{last_error[:300]}</code>"
    )
    return text, data


def _keyboard(store: Any, data: dict[str, Any]) -> InlineKeyboardMarkup:
    toggle = "⏸ إيقاف مؤقت" if data["runtime"] else "▶️ تشغيل"
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔌 اختبار الاتصال", callback_data="admin_binance_test"),
         InlineKeyboardButton(text="🔄 مزامنة الآن", callback_data="admin_binance_sync")],
        [InlineKeyboardButton(text="⏳ الدفعات المنتظرة", callback_data="admin_binance_pending"),
         InlineKeyboardButton(text="📜 آخر العمليات", callback_data="admin_binance_history")],
        [InlineKeyboardButton(text=toggle, callback_data="admin_binance_toggle"),
         InlineKeyboardButton(text="⚙️ الإعداد", callback_data="admin_binance_setup")],
        [InlineKeyboardButton(text="🔃 تحديث", callback_data="admin_binance")],
        [store.back_btn("admin_panel", "🔙 لوحة الإدارة")],
    ])


async def _requests(store: Any, statuses: tuple[str, ...]) -> list[tuple[Any, ...]]:
    marks = ",".join("?" for _ in statuses)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            f"SELECT id,user_id,expected_amount,credited_amount,status,created_at,expires_at,transaction_reference "
            f"FROM deposit_requests WHERE payment_snapshot LIKE '%binance_deposit%' "
            f"AND status IN ({marks}) ORDER BY id DESC LIMIT 12",
            statuses,
        ) as cur:
            return await cur.fetchall()


def _request_text(rows: list[tuple[Any, ...]], title: str) -> str:
    if not rows:
        return f"{title}\n\nلا توجد عمليات حاليًا."
    parts = [title, "━━━━━━━━━━━━━━━━"]
    for row in rows:
        tx = _mask(str(row[7] or ""))
        parts.append(
            f"<b>#{row[0]}</b> — مستخدم <code>{row[1]}</code>\n"
            f"المبلغ: <b>{row[2]} USDT</b> → <b>{float(row[3] or 0):.2f} USD</b>\n"
            f"الحالة: <b>{html.escape(str(row[4]))}</b> | {html.escape(str(row[5]))}\n"
            f"TXID: <code>{html.escape(tx)}</code>"
        )
    return "\n\n".join(parts)


async def _test(store: Any) -> tuple[bool, str]:
    if not store.BINANCE_AUTO_PAY_ENABLED:
        return False, "BINANCE_AUTO_PAY_ENABLED غير مفعّل في Railway."
    if not store.BINANCE_API_KEY or not store.BINANCE_API_SECRET:
        return False, "مفتاح Binance أو السر غير موجود في Railway."
    try:
        await store.BINANCE_WALLET._sync_time(force=True)
        address = await store.BINANCE_WALLET.deposit_address()
        end_ms = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
        history = await store.BINANCE_WALLET.deposit_history(end_ms - 86400000, end_ms)
        method_id = await store.ensure_binance_payment_method()
        if not await _runtime_enabled(store):
            await _set_method(store, False)
        _LAST.update(time=_now(), error="")
        return True, (
            "الاتصال والتوقيع وصلاحية قراءة المحفظة تعمل.\n"
            f"العنوان: {_mask(str(address.get('address') or ''))}\n"
            f"إيداعات آخر 24 ساعة: {len(history)}\nطريقة الدفع: #{method_id}"
        )
    except Exception as exc:
        message = str(exc).replace("\n", " ")[:350]
        _LAST.update(time=_now(), error=message)
        return False, message


def _patch_admin_panel(store: Any) -> None:
    original = store.admin_panel_kb
    if getattr(original, "_binance_patched", False):
        return

    def wrapped(perms: dict | None = None, super_admin: bool = False):
        markup = original(perms, super_admin)
        allowed = super_admin or bool((perms or {}).get("can_manage_payments"))
        if allowed and not any(
            button.callback_data == "admin_binance"
            for row in markup.inline_keyboard for button in row
        ):
            rows = [list(row) for row in markup.inline_keyboard]
            rows.insert(max(0, len(rows) - 1), [InlineKeyboardButton(text="🟡 مركز Binance", callback_data="admin_binance")])
            return InlineKeyboardMarkup(inline_keyboard=rows)
        return markup

    wrapped._binance_patched = True
    store.admin_panel_kb = wrapped


def _patch_runtime(store: Any) -> None:
    original_create = store.create_binance_deposit_request
    original_check = store.check_binance_request
    original_pending = store.check_binance_pending_once

    async def create(*args, **kwargs):
        if not await _runtime_enabled(store):
            message = args[0]
            await message.answer("⛔ دفع Binance متوقف مؤقتًا من الإدارة.")
            return None
        return await original_create(*args, **kwargs)

    async def check(req_id: int):
        if not await _runtime_enabled(store):
            return "disabled", "دفع Binance متوقف مؤقتًا من الإدارة."
        return await original_check(req_id)

    async def pending():
        if not await _runtime_enabled(store):
            return 0
        return await original_pending()

    store.create_binance_deposit_request = create
    store.check_binance_request = check
    store.check_binance_pending_once = pending


def install(store: Any) -> None:
    if getattr(store, "_binance_admin_installed", False):
        return
    _patch_admin_panel(store)
    _patch_runtime(store)
    router = Router(name="binance_admin")

    async def render(call: CallbackQuery) -> None:
        text, data = await _text(store)
        await store.safe_edit_message(call.message, text, _keyboard(store, data), parse_mode="HTML")

    @router.callback_query(F.data == "admin_binance")
    async def dashboard(call: CallbackQuery):
        if not await _guard(store, call): return
        await render(call); await call.answer()

    @router.callback_query(F.data == "admin_binance_test")
    async def connection(call: CallbackQuery):
        if not await _guard(store, call): return
        if _LOCK.locked():
            await call.answer("هناك عملية قيد التنفيذ.", show_alert=True); return
        await call.answer("جارٍ اختبار الاتصال…")
        async with _LOCK: ok, message = await _test(store)
        await call.message.answer(
            ("✅ <b>اختبار Binance ناجح</b>" if ok else "❌ <b>فشل اختبار Binance</b>")
            + "\n\n<code>" + html.escape(message) + "</code>",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[[store.back_btn("admin_binance")]]),
        )

    @router.callback_query(F.data == "admin_binance_sync")
    async def sync(call: CallbackQuery):
        if not await _guard(store, call): return
        if _LOCK.locked():
            await call.answer("المزامنة تعمل حاليًا.", show_alert=True); return
        await call.answer("بدأت المزامنة…")
        async with _LOCK:
            ok, message = await _test(store)
            approved = 0
            if ok:
                try:
                    approved = await store.check_binance_pending_once()
                    _LAST.update(time=_now(), error="", approved=approved)
                except Exception as exc:
                    ok, message = False, str(exc)[:350]
                    _LAST.update(time=_now(), error=message)
        await call.message.answer(
            (f"✅ <b>اكتملت المزامنة</b>\n\nالدفعات الجديدة: <b>{approved}</b>" if ok
             else "❌ <b>فشلت المزامنة</b>\n\n<code>" + html.escape(message) + "</code>"),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[[store.back_btn("admin_binance")]]),
        )

    @router.callback_query(F.data == "admin_binance_toggle")
    async def toggle(call: CallbackQuery):
        if not await _guard(store, call): return
        if not (store.BINANCE_AUTO_PAY_ENABLED and store.BINANCE_API_KEY and store.BINANCE_API_SECRET):
            await call.answer("أكمل إعدادات Binance في Railway أولًا.", show_alert=True); return
        enabled = not await _runtime_enabled(store)
        await store.set_setting("binance_runtime_enabled", "1" if enabled else "0")
        await _set_method(store, enabled)
        await call.answer("تم تشغيل Binance." if enabled else "تم إيقاف Binance مؤقتًا.", show_alert=True)
        await render(call)

    @router.callback_query(F.data == "admin_binance_pending")
    async def pending(call: CallbackQuery):
        if not await _guard(store, call): return
        rows = await _requests(store, ("waiting_payment",))
        await store.safe_edit_message(call.message, _request_text(rows, "⏳ <b>دفعات Binance المنتظرة</b>"), InlineKeyboardMarkup(inline_keyboard=[[store.back_btn("admin_binance")]]), parse_mode="HTML")
        await call.answer()

    @router.callback_query(F.data == "admin_binance_history")
    async def history(call: CallbackQuery):
        if not await _guard(store, call): return
        rows = await _requests(store, ("approved", "expired", "cancelled", "rejected"))
        await store.safe_edit_message(call.message, _request_text(rows, "📜 <b>آخر عمليات Binance</b>"), InlineKeyboardMarkup(inline_keyboard=[[store.back_btn("admin_binance")]]), parse_mode="HTML")
        await call.answer()

    @router.callback_query(F.data == "admin_binance_setup")
    async def setup(call: CallbackQuery):
        if not await _guard(store, call): return
        text = (
            "⚙️ <b>إعداد Binance في Railway</b>\n\n"
            "<code>BINANCE_AUTO_PAY_ENABLED=1</code>\n"
            "<code>BINANCE_API_KEY=...</code>\n"
            "<code>BINANCE_API_SECRET=...</code>\n"
            "<code>BINANCE_COIN=USDT</code>\n"
            "<code>BINANCE_NETWORK=TRX</code>\n\n"
            "استخدم مفتاح قراءة فقط، ولا تفعّل التداول أو السحب."
        )
        await store.safe_edit_message(call.message, text, InlineKeyboardMarkup(inline_keyboard=[[store.back_btn("admin_binance")]]), parse_mode="HTML")
        await call.answer()

    store.dp.include_router(router)
    store._binance_admin_installed = True


__all__ = ["install"]
