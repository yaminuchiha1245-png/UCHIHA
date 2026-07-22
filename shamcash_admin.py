#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Secure Sham Cash API readiness center for the UCHIHA Telegram admin panel.

The center deliberately keeps credentials in Railway variables.  It can verify
a future read-only API token and inspect linked accounts, but it never stores or
prints the token and it does not auto-credit deposits before the provider's
official transaction contract has been configured and verified.
"""

from __future__ import annotations

import asyncio
import datetime
import html
import json
import logging
import os
import re
from typing import Any
from urllib.parse import urlparse

import aiohttp
import aiosqlite
from aiogram import F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup


_LOG = logging.getLogger("shamcash_admin")
_LOCK = asyncio.Lock()
_TRUE_VALUES = {"1", "true", "yes", "on", "enabled", "enable"}
_HEADER_NAME_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")
_STATE: dict[str, Any] = {
    "last_ok": "",
    "last_error": "",
    "account_count": 0,
    "active_account_count": 0,
    "balance_count": 0,
}


def _flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name, "1" if default else "0").strip().lower()
    return value in _TRUE_VALUES


def _clean(store: Any, value: Any, limit: int = 350) -> str:
    cleaner = getattr(store, "clean_api_text", None)
    if callable(cleaner):
        return str(cleaner(value, limit))
    return " ".join(str(value or "").split())[:limit]


def _mask(value: str, start: int = 5, end: int = 3) -> str:
    value = str(value or "").strip()
    if not value:
        return "غير محدد"
    if len(value) <= start + end + 3:
        return value
    return f"{value[:start]}…{value[-end:]}"


def _config() -> dict[str, Any]:
    header = os.getenv("SHAMCASH_API_AUTH_HEADER", "Authorization").strip() or "Authorization"
    if not _HEADER_NAME_RE.fullmatch(header):
        header = "Authorization"
    scheme = " ".join(os.getenv("SHAMCASH_API_AUTH_SCHEME", "Bearer").split())
    if any(char in scheme for char in "\r\n"):
        scheme = "Bearer"
    return {
        "enabled": _flag("SHAMCASH_API_ENABLED", False),
        "token": os.getenv("SHAMCASH_API_TOKEN", "").strip(),
        "base_url": os.getenv("SHAMCASH_API_BASE_URL", "").strip().rstrip("/"),
        "auth_header": header,
        "auth_scheme": scheme,
        "accounts_path": os.getenv("SHAMCASH_API_ACCOUNTS_PATH", "/accounts").strip() or "/accounts",
        "balances_path": os.getenv("SHAMCASH_API_BALANCES_PATH", "/balances").strip() or "/balances",
        "transactions_path": os.getenv("SHAMCASH_API_TRANSACTIONS_PATH", "/transactions").strip() or "/transactions",
        "account_id": os.getenv("SHAMCASH_ACCOUNT_ID", "").strip(),
    }


def _validate_base_url(value: str) -> tuple[bool, str]:
    try:
        parsed = urlparse(str(value or "").strip())
    except ValueError:
        return False, ""
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return False, ""
    if parsed.query or parsed.fragment:
        return False, ""
    return True, parsed.hostname


def _safe_path(value: str) -> str:
    value = str(value or "").strip()
    if not value.startswith("/") or "://" in value or any(char in value for char in "\r\n"):
        raise ValueError("مسار API غير صالح.")
    return value


def _redact(value: Any, token: str) -> str:
    text = " ".join(str(value or "").split())
    if token:
        text = text.replace(token, "[hidden]")
    return text[:350]


class ShamCashAPIError(RuntimeError):
    """A safe provider error that never includes the configured token."""


class ShamCashReadOnlyClient:
    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self.config = dict(config or _config())
        self.token = str(self.config.get("token") or "")
        self.base_url = str(self.config.get("base_url") or "").rstrip("/")

    @property
    def ready(self) -> bool:
        valid_url, _hostname = _validate_base_url(self.base_url)
        return bool(self.config.get("enabled") and self.token and valid_url)

    def _url(self, path: str) -> str:
        safe_path = _safe_path(path)
        valid_url, base_host = _validate_base_url(self.base_url)
        if not valid_url:
            raise ShamCashAPIError("رابط Sham Cash API غير صالح أو لا يستخدم HTTPS.")
        url = f"{self.base_url}{safe_path}"
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != base_host:
            raise ShamCashAPIError("تم رفض مسار API غير آمن.")
        return url

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        if not self.ready:
            raise ShamCashAPIError("ربط Sham Cash غير مفعّل أو متغيراته غير مكتملة في Railway.")
        scheme = str(self.config.get("auth_scheme") or "").strip()
        auth_value = f"{scheme} {self.token}".strip()
        headers = {
            str(self.config.get("auth_header") or "Authorization"): auth_value,
            "Accept": "application/json",
        }
        timeout = aiohttp.ClientTimeout(total=20, connect=8)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(self._url(path), headers=headers, params=params or {}) as response:
                    raw = await response.text()
                    try:
                        payload = json.loads(raw) if raw else {}
                    except json.JSONDecodeError as exc:
                        raise ShamCashAPIError("استجابة Sham Cash API ليست JSON صالحًا.") from exc
                    if not isinstance(payload, (dict, list)):
                        raise ShamCashAPIError("استجابة Sham Cash API غير صالحة.")
                    if isinstance(payload, dict):
                        provider_status = str(payload.get("status") or "").strip().lower()
                        if response.status >= 400 or provider_status in {"error", "failed", "fail"}:
                            code = _redact(payload.get("code") or response.status, self.token)
                            message = _redact(payload.get("message") or "فشل طلب Sham Cash", self.token)
                            raise ShamCashAPIError(f"Sham Cash {code}: {message}")
                        if "data" in payload and provider_status in {"success", "ok"}:
                            return payload.get("data")
                    if response.status >= 400:
                        raise ShamCashAPIError(f"Sham Cash HTTP {response.status}")
                    return payload
        except asyncio.TimeoutError as exc:
            raise ShamCashAPIError("انتهت مهلة الاتصال مع Sham Cash API.") from exc
        except aiohttp.ClientError as exc:
            raise ShamCashAPIError(
                f"تعذر الاتصال مع Sham Cash API: {exc.__class__.__name__}"
            ) from exc

    async def accounts(self) -> Any:
        return await self._get(str(self.config.get("accounts_path") or "/accounts"))

    async def balances(self, account_id: str) -> Any:
        return await self._get(
            str(self.config.get("balances_path") or "/balances"),
            {"account_id": account_id},
        )

    async def transactions(
        self,
        account_id: str,
        *,
        start_at: str = "",
        end_at: str = "",
        limit: int = 50,
    ) -> Any:
        params: dict[str, Any] = {"account_id": account_id, "limit": max(1, min(int(limit), 100))}
        if start_at:
            params["start_at"] = start_at
        if end_at:
            params["end_at"] = end_at
        return await self._get(str(self.config.get("transactions_path") or "/transactions"), params)


def _items(payload: Any, *keys: str) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in (*keys, "items", "results", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
        return [payload] if payload else []
    return []


def _client() -> ShamCashReadOnlyClient:
    return ShamCashReadOnlyClient()


async def _allowed(store: Any, user_id: int) -> bool:
    if not await store.is_admin(user_id):
        return False
    if await store.is_super_admin(user_id):
        return True
    return bool((await store.get_admin_perms(user_id)).get("can_manage_payments"))


async def _test_connection(store: Any) -> dict[str, Any]:
    config = _config()
    missing: list[str] = []
    if not config["enabled"]:
        missing.append("SHAMCASH_API_ENABLED=1")
    if not config["token"]:
        missing.append("SHAMCASH_API_TOKEN")
    valid_url, _hostname = _validate_base_url(str(config["base_url"]))
    if not valid_url:
        missing.append("SHAMCASH_API_BASE_URL (HTTPS)")
    if missing:
        return {
            "ok": False,
            "message": "أكمل متغيرات Railway التالية: " + "، ".join(missing),
        }
    try:
        accounts_payload = await _client().accounts()
        accounts = _items(accounts_payload, "accounts")
        active = 0
        for account in accounts:
            if not isinstance(account, dict):
                continue
            status = str(account.get("status") or "active").strip().lower()
            if status in {"active", "enabled", "ready", "1", "true"}:
                active += 1
        selected = str(config.get("account_id") or "")
        if not selected and len(accounts) == 1 and isinstance(accounts[0], dict):
            selected = str(accounts[0].get("id") or accounts[0].get("account_id") or "")
        balances: list[Any] = []
        if selected:
            balances = _items(await _client().balances(selected), "balances")
        _STATE.update(
            last_ok=datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            last_error="",
            account_count=len(accounts),
            active_account_count=active,
            balance_count=len(balances),
        )
        return {
            "ok": True,
            "message": "تم قبول API Token وقراءة الحسابات بنجاح.",
            "accounts": len(accounts),
            "active_accounts": active,
            "balances": len(balances),
            "selected_account": selected,
        }
    except Exception as exc:
        message = _redact(_clean(store, exc), str(config.get("token") or ""))
        _STATE["last_error"] = message
        return {"ok": False, "message": message}


async def _payment_stats(store: Any) -> dict[str, Any]:
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT id,name,is_active FROM payment_methods
            WHERE LOWER(COALESCE(provider,''))='shamcash'
               OR LOWER(COALESCE(name,'')) LIKE '%sham%'
               OR COALESCE(name,'') LIKE '%شام كاش%'
            ORDER BY id
            """
        ) as cursor:
            methods = await cursor.fetchall()
        async with db.execute(
            """
            SELECT dr.status,COUNT(*)
            FROM deposit_requests dr
            JOIN payment_methods pm ON pm.id=dr.payment_method_id
            WHERE LOWER(COALESCE(pm.provider,''))='shamcash'
               OR LOWER(COALESCE(pm.name,'')) LIKE '%sham%'
               OR COALESCE(pm.name,'') LIKE '%شام كاش%'
            GROUP BY dr.status
            """
        ) as cursor:
            status_rows = await cursor.fetchall()
    return {
        "methods": methods,
        "active_methods": sum(1 for row in methods if int(row[2] or 0) == 1),
        "statuses": {str(row[0]): int(row[1]) for row in status_rows},
    }


async def _dashboard_text(store: Any) -> tuple[str, dict[str, Any]]:
    config = _config()
    valid_url, hostname = _validate_base_url(str(config["base_url"]))
    configured = bool(config["enabled"] and config["token"] and valid_url)
    stats = await _payment_stats(store)
    statuses = stats["statuses"]
    text = [
        "🟣 <b>مركز Sham Cash</b>",
        "━━━━━━━━━━━━━━━━",
        "",
        "<b>جاهزية ربط API</b>",
        f"{'🟢' if config['enabled'] else '⚪'} تفعيل الربط: <b>{'مفعّل' if config['enabled'] else 'بانتظار التفعيل'}</b>",
        f"{'🟢' if config['token'] else '🔴'} API Token: <b>{'موجود بأمان في Railway' if config['token'] else 'غير مضاف بعد'}</b>",
        f"{'🟢' if valid_url else '🔴'} رابط المزود: <b>{html.escape(hostname) if hostname else 'غير محدد'}</b>",
        f"🧾 الحساب المختار: <code>{html.escape(_mask(str(config['account_id'])))}</code>",
        "",
        "<b>طريقة الدفع والطلبات</b>",
        f"💳 طرق Sham Cash: <b>{len(stats['methods'])}</b> — المفعلة: <b>{stats['active_methods']}</b>",
        f"⏳ قيد المراجعة: <b>{statuses.get('pending', 0)}</b>",
        f"✅ المعتمدة: <b>{statuses.get('approved', 0)}</b>",
        "",
        f"{'✅' if configured else '🧩'} حالة المركز: <b>{'جاهز لاختبار التوكن' if configured else 'مجهز وينتظر بيانات API'}</b>",
        "🛡 التوكن لا يُعرض ولا يُحفظ في تيليجرام أو قاعدة البيانات.",
        "⚠️ الاعتماد التلقائي يبقى مغلقًا حتى مطابقة توثيق الحركات الرسمي واختباره.",
    ]
    if _STATE["last_ok"]:
        text.extend(
            [
                "",
                f"🕓 آخر اختبار ناجح: <b>{html.escape(str(_STATE['last_ok']))}</b>",
                f"👛 الحسابات المقروءة: <b>{_STATE['account_count']}</b> — النشطة: <b>{_STATE['active_account_count']}</b>",
            ]
        )
    if _STATE["last_error"]:
        text.append(f"⚠️ آخر خطأ: <code>{html.escape(_clean(store, _STATE['last_error'], 220))}</code>")
    return "\n".join(text), {"configured": configured, **stats}


def _panel(store: Any) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🧪 اختبار API Token", callback_data="admin_shamcash_test"),
                InlineKeyboardButton(text="🔄 تحديث الحالة", callback_data="admin_shamcash_refresh"),
            ],
            [
                InlineKeyboardButton(text="💳 طرق Sham Cash", callback_data="admin_shamcash_methods"),
                InlineKeyboardButton(text="⏳ طلبات Sham Cash", callback_data="admin_shamcash_requests"),
            ],
            [InlineKeyboardButton(text="⚙️ إعداد الربط الآمن", callback_data="admin_shamcash_setup")],
            [InlineKeyboardButton(text="🌐 طلب API من Sham Cash", url="https://shamcash.sy/ar/apiRequest")],
            [store.back_btn("admin_panel", "🔙 لوحة الإدارة")],
        ]
    )


def _patch_admin_panel(store: Any) -> None:
    original = store.admin_panel_kb

    def admin_panel(perms: dict | None = None, super_admin: bool = False):
        markup = original(perms, super_admin)
        if not (super_admin or bool((perms or {}).get("can_manage_payments"))):
            return markup
        rows = [list(row) for row in markup.inline_keyboard]
        if not any(button.callback_data == "admin_shamcash" for row in rows for button in row):
            rows.insert(
                max(0, len(rows) - 1),
                [InlineKeyboardButton(text="🟣 مركز Sham Cash", callback_data="admin_shamcash")],
            )
        return InlineKeyboardMarkup(inline_keyboard=rows)

    store.admin_panel_kb = admin_panel


async def _method_rows(store: Any) -> list[Any]:
    return list((await _payment_stats(store))["methods"])


async def _request_rows(store: Any) -> list[Any]:
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT dr.id,dr.user_id,dr.paid_amount,dr.credited_amount,dr.status
            FROM deposit_requests dr
            JOIN payment_methods pm ON pm.id=dr.payment_method_id
            WHERE LOWER(COALESCE(pm.provider,''))='shamcash'
               OR LOWER(COALESCE(pm.name,'')) LIKE '%sham%'
               OR COALESCE(pm.name,'') LIKE '%شام كاش%'
            ORDER BY dr.id DESC LIMIT 12
            """
        ) as cursor:
            return await cursor.fetchall()


def _router(store: Any) -> Router:
    router = Router(name="uchiha_shamcash_admin")

    async def guard(callback: CallbackQuery) -> bool:
        if await _allowed(store, callback.from_user.id):
            return True
        await callback.answer("⛔ لا تملك صلاحية إدارة الدفع.", show_alert=True)
        return False

    async def render(callback: CallbackQuery, *, answer: bool = True) -> None:
        text, _data = await _dashboard_text(store)
        await store.safe_edit_message(callback.message, text, _panel(store), parse_mode="HTML")
        if answer:
            await callback.answer()

    @router.callback_query(F.data == "admin_shamcash")
    async def dashboard(callback: CallbackQuery):
        if await guard(callback):
            await render(callback)

    @router.callback_query(F.data == "admin_shamcash_refresh")
    async def refresh(callback: CallbackQuery):
        if await guard(callback):
            await render(callback)

    @router.callback_query(F.data == "admin_shamcash_test")
    async def test(callback: CallbackQuery):
        if not await guard(callback):
            return
        if _LOCK.locked():
            await callback.answer("هناك اختبار قيد التنفيذ.", show_alert=True)
            return
        await callback.answer("جارٍ اختبار الربط الآمن…")
        async with _LOCK:
            result = await _test_connection(store)
        if result["ok"]:
            text = (
                "✅ <b>اختبار Sham Cash ناجح</b>\n\n"
                f"الحسابات: <b>{result.get('accounts', 0)}</b>\n"
                f"الحسابات النشطة: <b>{result.get('active_accounts', 0)}</b>\n"
                f"أرصدة الحساب المختار: <b>{result.get('balances', 0)}</b>\n\n"
                "تم قبول التوكن من الخادم من دون عرضه أو حفظه."
            )
        else:
            text = (
                "❌ <b>تعذر اختبار Sham Cash</b>\n\n"
                f"<code>{html.escape(_clean(store, result['message']))}</code>"
            )
        await callback.message.answer(
            text,
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(
                inline_keyboard=[[store.back_btn("admin_shamcash", "🔙 مركز Sham Cash")]]
            ),
        )

    @router.callback_query(F.data == "admin_shamcash_setup")
    async def setup(callback: CallbackQuery):
        if not await guard(callback):
            return
        text = (
            "⚙️ <b>إعداد Sham Cash الآمن</b>\n\n"
            "1️⃣ اطلب بيانات API الرسمية من الجهة المزودة.\n"
            "2️⃣ أضف القيم داخل <b>Railway Variables</b> فقط.\n"
            "3️⃣ أعد النشر ثم اضغط «اختبار API Token».\n\n"
            "<code>SHAMCASH_API_ENABLED=1</code>\n"
            "<code>SHAMCASH_API_TOKEN=...</code>\n"
            "<code>SHAMCASH_API_BASE_URL=https://...</code>\n"
            "<code>SHAMCASH_ACCOUNT_ID=...</code>\n\n"
            "يمكن ضبط مسارات المزود عند الحاجة عبر:\n"
            "<code>SHAMCASH_API_ACCOUNTS_PATH=/accounts</code>\n"
            "<code>SHAMCASH_API_BALANCES_PATH=/balances</code>\n"
            "<code>SHAMCASH_API_TRANSACTIONS_PATH=/transactions</code>\n\n"
            "🔐 لا ترسل التوكن داخل المحادثة ولا تضعه في GitHub."
        )
        await store.safe_edit_message(
            callback.message,
            text,
            InlineKeyboardMarkup(
                inline_keyboard=[
                    [InlineKeyboardButton(text="🌐 طلب API الرسمي", url="https://shamcash.sy/ar/apiRequest")],
                    [store.back_btn("admin_shamcash")],
                ]
            ),
            parse_mode="HTML",
        )
        await callback.answer()

    @router.callback_query(F.data == "admin_shamcash_methods")
    async def methods(callback: CallbackQuery):
        if not await guard(callback):
            return
        rows = await _method_rows(store)
        keyboard: list[list[InlineKeyboardButton]] = []
        for method_id, name, is_active in rows:
            keyboard.append(
                [
                    InlineKeyboardButton(
                        text=f"{'🟢' if is_active else '🔴'} {name}",
                        callback_data=f"admin_pm_{int(method_id)}",
                    )
                ]
            )
        keyboard.append(
            [InlineKeyboardButton(text="💸 فتح جميع طرق الدفع", callback_data="admin_payment_methods")]
        )
        keyboard.append([store.back_btn("admin_shamcash")])
        text = (
            f"💳 <b>طرق دفع Sham Cash</b>\n\nالعدد: <b>{len(rows)}</b>"
            if rows
            else "🧩 <b>لم تُضف طريقة Sham Cash بعد.</b>\n\nافتح طرق الدفع وأنشئها يدويًا؛ مركز API سيبقى جاهزًا للتوكن مستقبلًا."
        )
        await store.safe_edit_message(
            callback.message,
            text,
            InlineKeyboardMarkup(inline_keyboard=keyboard),
            parse_mode="HTML",
        )
        await callback.answer()

    @router.callback_query(F.data == "admin_shamcash_requests")
    async def requests(callback: CallbackQuery):
        if not await guard(callback):
            return
        rows = await _request_rows(store)
        icons = {
            "pending": "⏳",
            "waiting_payment": "⌛",
            "approved": "✅",
            "rejected": "❌",
            "expired": "🕓",
            "cancelled": "🚫",
        }
        keyboard = [
            [
                InlineKeyboardButton(
                    text=f"{icons.get(str(status), '•')} #{req_id} • {user_id} • {store._money(paid or credited or 0)}",
                    callback_data=f"admin_dep_{int(req_id)}",
                )
            ]
            for req_id, user_id, paid, credited, status in rows
        ]
        keyboard.append([store.back_btn("admin_shamcash")])
        text = (
            f"⏳ <b>آخر طلبات Sham Cash</b>\n\nالعدد: <b>{len(rows)}</b>"
            if rows
            else "✅ لا توجد طلبات Sham Cash مسجلة حتى الآن."
        )
        await store.safe_edit_message(
            callback.message,
            text,
            InlineKeyboardMarkup(inline_keyboard=keyboard),
            parse_mode="HTML",
        )
        await callback.answer()

    return router


def install(store: Any) -> None:
    if getattr(store, "_shamcash_admin_installed", False):
        return
    _patch_admin_panel(store)
    store.dp.include_router(_router(store))
    store._shamcash_admin_installed = True
    _LOG.info("UCHIHA Sham Cash readiness center installed")


__all__ = [
    "ShamCashAPIError",
    "ShamCashReadOnlyClient",
    "install",
]
