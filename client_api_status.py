from __future__ import annotations

import asyncio
import html
import os
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urljoin

import aiohttp
import aiosqlite
from aiogram import F, Router
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from client_api_purchase_runtime import _refund_failed
from client_api_sync import _auth_request_parts, _decrypt_token
from client_purchase_adapter import PurchaseResult, _csv_set, _read_path, ensure_purchase_schema
from client_services_store import _money, _short
from client_store_admin import _allowed


@dataclass(slots=True)
class StatusResult:
    ok: bool
    status: str = ""
    completed: bool = False
    failed: bool = False
    error: str = ""
    raw_response: str = ""


class StatusAdminStates(StatesGroup):
    path = State()
    order_param = State()
    response_key = State()


_STATUS_LOCK = asyncio.Lock()
_MONITOR_TASK: asyncio.Task | None = None


async def ensure_status_schema(store: Any) -> None:
    await ensure_purchase_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        for sql in (
            "ALTER TABLE client_api_providers ADD COLUMN status_enabled INTEGER DEFAULT 0",
            "ALTER TABLE client_api_providers ADD COLUMN status_path TEXT DEFAULT ''",
            "ALTER TABLE client_api_providers ADD COLUMN status_order_param TEXT DEFAULT 'order_id'",
            "ALTER TABLE client_api_providers ADD COLUMN status_response_key TEXT DEFAULT 'status'",
        ):
            try:
                await db.execute(sql)
            except Exception:
                pass
        await db.commit()


async def _provider_status_config(store: Any, provider_id: int) -> tuple[Any, ...] | None:
    await ensure_status_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT id,name,base_url,token_cipher,is_active,
                   COALESCE(auth_mode,'auto'),COALESCE(token_query_key,'api_key'),
                   COALESCE(status_enabled,0),COALESCE(status_path,''),
                   COALESCE(status_order_param,'order_id'),COALESCE(status_response_key,'status'),
                   COALESCE(accepted_status_values,'success,ok,pending,processing,completed,complete,done'),
                   COALESCE(completed_status_values,'completed,complete,success,done'),
                   COALESCE(failed_status_values,'failed,failure,error,rejected,cancelled,canceled')
            FROM client_api_providers WHERE id=?
            """,
            (provider_id,),
        ) as cursor:
            return await cursor.fetchone()


async def check_provider_order_status(
    store: Any,
    *,
    provider_id: int,
    external_order_id: str,
) -> StatusResult:
    row = await _provider_status_config(store, provider_id)
    if not row:
        return StatusResult(False, error="المزوّد غير موجود.")
    if not int(row[4] or 0) or not int(row[7] or 0):
        return StatusResult(False, error="متابعة الحالة غير مفعّلة للمزوّد.")
    order_id = str(external_order_id or "").strip()
    if not order_id:
        return StatusResult(False, error="لا يوجد رقم طلب خارجي للمتابعة.")

    base_url = str(row[2] or "").strip().rstrip("/") + "/"
    path = str(row[8] or "").strip()
    if not base_url.strip("/") or not path:
        return StatusResult(False, error="مسار متابعة الحالة غير مكتمل.")
    rendered_path = path.replace("{order_id}", quote(order_id, safe=""))
    endpoint = rendered_path if rendered_path.startswith("http") else urljoin(base_url, rendered_path.lstrip("/"))
    allow_insecure = os.getenv("CLIENT_STORE_ALLOW_INSECURE_API", "0").strip().lower() in {"1", "true", "yes", "on"}
    if not endpoint.startswith("https://") and not allow_insecure:
        return StatusResult(False, error="رابط متابعة الطلب ليس HTTPS.")

    mode = str(row[5] or "auto")
    token = _decrypt_token(store, str(row[3] or ""))
    if mode != "none" and not token:
        return StatusResult(False, error="تعذر قراءة توكن المزوّد.")
    headers, params = _auth_request_parts(mode, token, str(row[6] or "api_key"))
    if "{order_id}" not in path:
        order_param = str(row[9] or "order_id").strip()
        if order_param:
            params[order_param] = order_id

    timeout = aiohttp.ClientTimeout(total=25)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(endpoint, headers=headers, params=params) as response:
                text = await response.text()
                raw = text[:12000]
                if response.status < 200 or response.status >= 300:
                    return StatusResult(False, error=f"HTTP {response.status}", raw_response=raw)
                try:
                    body: Any = await response.json(content_type=None)
                except Exception:
                    return StatusResult(False, error="استجابة الحالة ليست JSON صالحًا.", raw_response=raw)
    except Exception as exc:
        return StatusResult(False, error=str(exc)[:500])

    response_key = str(row[10] or "status").strip()
    value = _read_path(body, response_key) if response_key else None
    if value in (None, ""):
        for key in ("status", "state", "order_status", "data.status", "result.status"):
            value = _read_path(body, key)
            if value not in (None, ""):
                break
    status = str(value or "").strip().lower()
    if not status:
        return StatusResult(False, error="لم أجد حالة الطلب في الاستجابة.", raw_response=raw)

    completed = _csv_set(row[12])
    failed = _csv_set(row[13])
    accepted = _csv_set(row[11])
    if status in completed:
        return StatusResult(True, status=status, completed=True, raw_response=raw)
    if status in failed:
        return StatusResult(True, status=status, failed=True, raw_response=raw)
    if status in accepted:
        return StatusResult(True, status=status, raw_response=raw)
    return StatusResult(False, status=status, error=f"حالة غير معروفة: {status}", raw_response=raw)


async def _apply_status_result(
    store: Any,
    *,
    order_id: int,
    user_id: int,
    price: float,
    result: StatusResult,
) -> str:
    if not result.ok:
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                """
                UPDATE client_api_order_links
                SET last_error=?,raw_response=?,updated_at=CURRENT_TIMESTAMP
                WHERE local_order_id=?
                """,
                (result.error[:500], result.raw_response[:12000], order_id),
            )
            await db.commit()
        return "error"

    if result.completed:
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute("UPDATE orders SET status='completed' WHERE id=?", (order_id,))
            await db.execute(
                """
                UPDATE client_api_order_links
                SET provider_status=?,raw_response=?,last_error='',updated_at=CURRENT_TIMESTAMP
                WHERE local_order_id=?
                """,
                (result.status, result.raw_response[:12000], order_id),
            )
            await db.commit()
        return "completed"

    if result.failed:
        purchase_result = PurchaseResult(
            False,
            provider_status=result.status,
            error=f"Provider final status: {result.status}",
            raw_response=result.raw_response,
            failure_is_definitive=True,
        )
        refunded = await _refund_failed(
            store,
            order_id=order_id,
            user_id=user_id,
            price=price,
            result=purchase_result,
        )
        return "refunded" if refunded else "failed_already_handled"

    async with aiosqlite.connect(store.DB_PATH) as db:
        await db.execute(
            """
            UPDATE client_api_order_links
            SET provider_status=?,raw_response=?,last_error='',updated_at=CURRENT_TIMESTAMP
            WHERE local_order_id=?
            """,
            (result.status, result.raw_response[:12000], order_id),
        )
        await db.commit()
    return "processing"


async def monitor_once(store: Any, limit: int = 20) -> dict[str, int]:
    await ensure_status_schema(store)
    counts = {"checked": 0, "completed": 0, "refunded": 0, "processing": 0, "errors": 0}
    if _STATUS_LOCK.locked():
        return counts
    async with _STATUS_LOCK:
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute(
                """
                SELECT l.local_order_id,l.provider_id,l.external_order_id,
                       o.user_id,o.total_price
                FROM client_api_order_links l
                JOIN orders o ON o.id=l.local_order_id
                JOIN client_api_providers p ON p.id=l.provider_id
                WHERE o.status='processing'
                  AND p.is_active=1
                  AND COALESCE(p.status_enabled,0)=1
                  AND COALESCE(l.external_order_id,'')<>''
                ORDER BY l.updated_at,l.local_order_id
                LIMIT ?
                """,
                (max(1, min(int(limit or 20), 100)),),
            ) as cursor:
                rows = await cursor.fetchall()

        for row in rows:
            order_id, provider_id, external_id, user_id, total_price = row
            result = await check_provider_order_status(
                store,
                provider_id=int(provider_id),
                external_order_id=str(external_id),
            )
            outcome = await _apply_status_result(
                store,
                order_id=int(order_id),
                user_id=int(user_id),
                price=float(total_price or 0),
                result=result,
            )
            counts["checked"] += 1
            if outcome == "completed":
                counts["completed"] += 1
                try:
                    await store.bot.send_message(int(user_id), f"✅ اكتمل طلبك #{int(order_id)} لدى المزوّد.")
                except Exception:
                    pass
            elif outcome == "refunded":
                counts["refunded"] += 1
                try:
                    await store.bot.send_message(
                        int(user_id),
                        f"❌ فشل طلبك #{int(order_id)} لدى المزوّد وتم إرجاع {_money(total_price)} $ إلى رصيدك.",
                    )
                except Exception:
                    pass
            elif outcome == "processing":
                counts["processing"] += 1
            elif outcome == "error":
                counts["errors"] += 1
        return counts


def _admin_panel_wrapper(original: Any):
    def wrapped(perms: dict | None = None, super_admin: bool = False) -> InlineKeyboardMarkup:
        markup = original(perms, super_admin)
        rows = [list(row) for row in markup.inline_keyboard]
        p = perms or {}
        if super_admin or p.get("can_manage_products") or p.get("can_manage_sync") or p.get("can_manage_orders"):
            if not any(
                getattr(button, "callback_data", None) == "statusadmin:home"
                for row in rows
                for button in row
            ):
                pos = max(len(rows) - 1, 0)
                rows.insert(pos, [InlineKeyboardButton(text="📡 متابعة طلبات API", callback_data="statusadmin:home")])
        return InlineKeyboardMarkup(inline_keyboard=rows)
    return wrapped


async def _edit(store: Any, callback: CallbackQuery, text: str, rows: list[list[InlineKeyboardButton]]) -> None:
    markup = InlineKeyboardMarkup(inline_keyboard=rows)
    try:
        await store.safe_edit_message(callback.message, text, markup)
    except Exception:
        try:
            await callback.message.edit_text(text, reply_markup=markup)
        except Exception:
            await callback.message.answer(text, reply_markup=markup)


async def _render_home(store: Any, callback: CallbackQuery) -> None:
    await ensure_status_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM orders WHERE status='processing' AND purchase_flow='client_api_generic'"
        ) as cursor:
            processing = int((await cursor.fetchone() or [0])[0] or 0)
        async with db.execute(
            "SELECT COUNT(*) FROM client_api_order_links WHERE provider_status='uncertain'"
        ) as cursor:
            uncertain = int((await cursor.fetchone() or [0])[0] or 0)
        async with db.execute(
            "SELECT id,name,COALESCE(status_enabled,0) FROM client_api_providers WHERE adapter_key<>'manual' ORDER BY id DESC"
        ) as cursor:
            providers = await cursor.fetchall()
    rows = [[InlineKeyboardButton(
        text=f"{'📡' if int(row[2] or 0) else '⏸'} {_short(row[1], 27)}",
        callback_data=f"statusadmin:provider:{int(row[0])}",
    )] for row in providers]
    rows.insert(0, [InlineKeyboardButton(text="🔄 فحص الحالات الآن", callback_data="statusadmin:run")])
    rows.append([store.back_btn("admin_panel", "🔙 لوحة الإدارة")])
    await _edit(
        store,
        callback,
        f"📡 متابعة طلبات API\n\n🔄 قيد المعالجة: {processing}\n⚠️ غير مؤكدة: {uncertain}\n\n"
        "فعّل المتابعة فقط للمزوّد الذي يوفّر endpoint رسميًا لحالة الطلب.",
        rows,
    )


async def _render_provider(store: Any, callback: CallbackQuery, provider_id: int) -> None:
    row = await _provider_status_config(store, provider_id)
    if not row:
        return await callback.answer("المزوّد غير موجود.", show_alert=True)
    text = (
        f"📡 متابعة — {html.escape(str(row[1]))}\n\n"
        f"الحالة: {'✅ مفعّلة' if int(row[7] or 0) else '⏸ متوقفة'}\n"
        f"المسار: {html.escape(str(row[8] or '—'))}\n"
        f"Order param: {html.escape(str(row[9] or '—'))}\n"
        f"Status key: {html.escape(str(row[10] or 'status'))}\n\n"
        "يمكن أن يكون المسار مثل /orders/{order_id}. وإذا لم تستخدم placeholder، يرسل البوت رقم الطلب كـ query parameter."
    )
    rows = [
        [InlineKeyboardButton(
            text="⏸ إيقاف المتابعة" if int(row[7] or 0) else "✅ تفعيل المتابعة",
            callback_data=f"statusadmin:toggle:{provider_id}",
        )],
        [InlineKeyboardButton(text="🌐 مسار الحالة", callback_data=f"statusadmin:path:{provider_id}")],
        [
            InlineKeyboardButton(text="🔗 Order param", callback_data=f"statusadmin:param:{provider_id}"),
            InlineKeyboardButton(text="📊 Status key", callback_data=f"statusadmin:key:{provider_id}"),
        ],
        [store.back_btn("statusadmin:home", "🔙 المتابعة")],
    ]
    await _edit(store, callback, text, rows)


async def _background_loop(store: Any) -> None:
    interval = max(60, min(int(os.getenv("CLIENT_API_STATUS_INTERVAL_SECONDS", "120") or 120), 1800))
    while True:
        try:
            await monitor_once(store, limit=20)
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        await asyncio.sleep(interval)


def install(store: Any) -> None:
    if getattr(store, "_client_api_status_installed", False):
        return

    store.admin_panel_kb = _admin_panel_wrapper(store.admin_panel_kb)
    router = Router(name="client_api_status")

    @router.callback_query(F.data == "statusadmin:home")
    async def home(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync", "can_manage_orders"):
            return await callback.answer("غير مصرح.", show_alert=True)
        await _render_home(store, callback)
        await callback.answer()

    @router.callback_query(F.data == "statusadmin:run")
    async def run_now(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync", "can_manage_orders"):
            return await callback.answer("غير مصرح.", show_alert=True)
        await callback.answer("جاري فحص الطلبات…")
        counts = await monitor_once(store, limit=50)
        await _edit(
            store,
            callback,
            "✅ انتهى فحص حالات API\n\n"
            f"تم فحص: {counts['checked']}\n"
            f"✅ اكتملت: {counts['completed']}\n"
            f"↩️ أُعيد رصيدها: {counts['refunded']}\n"
            f"🔄 ما زالت تعمل: {counts['processing']}\n"
            f"⚠️ أخطاء تحقق: {counts['errors']}",
            [[store.back_btn("statusadmin:home", "🔙 المتابعة")]],
        )

    @router.callback_query(F.data.startswith("statusadmin:provider:"))
    async def provider(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync", "can_manage_orders"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        await _render_provider(store, callback, provider_id)
        await callback.answer()

    @router.callback_query(F.data.startswith("statusadmin:toggle:"))
    async def toggle(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync", "can_manage_orders"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        row = await _provider_status_config(store, provider_id)
        if not row:
            return await callback.answer("المزوّد غير موجود.", show_alert=True)
        new_value = 0 if int(row[7] or 0) else 1
        if new_value and not str(row[8] or "").strip():
            return await callback.answer("أدخل مسار الحالة أولًا.", show_alert=True)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute("UPDATE client_api_providers SET status_enabled=? WHERE id=?", (new_value, provider_id))
            await db.commit()
        await callback.answer("تم تحديث المتابعة.", show_alert=True)
        await _render_provider(store, callback, provider_id)

    @router.callback_query(F.data.startswith("statusadmin:path:"))
    async def path_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync", "can_manage_orders"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        await state.clear(); await state.update_data(status_provider_id=provider_id)
        await state.set_state(StatusAdminStates.path)
        await callback.message.answer("🌐 أرسل مسار الحالة، مثال: /orders/{order_id} أو /api/order/status")
        await callback.answer()

    @router.message(StatusAdminStates.path)
    async def path_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products", "can_manage_sync", "can_manage_orders"):
            await state.clear(); return
        value = str(message.text or "").strip()
        if not value:
            return await message.answer("المسار لا يمكن أن يكون فارغًا.")
        if value.startswith("http://"):
            return await message.answer("استخدم HTTPS فقط.")
        if not value.startswith("/") and not value.startswith("https://"):
            value = "/" + value
        provider_id = int((await state.get_data()).get("status_provider_id") or 0)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute("UPDATE client_api_providers SET status_path=?,status_enabled=0 WHERE id=?", (value, provider_id))
            await db.commit()
        await state.clear()
        await message.answer("✅ تم حفظ مسار الحالة وإيقاف المتابعة حتى تراجعه وتفعّله.")

    @router.callback_query(F.data.startswith("statusadmin:param:"))
    async def param_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync", "can_manage_orders"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        await state.clear(); await state.update_data(status_provider_id=provider_id)
        await state.set_state(StatusAdminStates.order_param)
        await callback.message.answer("🔗 أرسل اسم query parameter لرقم الطلب، مثال: order_id. أرسل - إذا كان المسار يستخدم {order_id}.")
        await callback.answer()

    @router.message(StatusAdminStates.order_param)
    async def param_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products", "can_manage_sync", "can_manage_orders"):
            await state.clear(); return
        value = str(message.text or "").strip()[:100]
        if value == "-":
            value = ""
        provider_id = int((await state.get_data()).get("status_provider_id") or 0)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute("UPDATE client_api_providers SET status_order_param=?,status_enabled=0 WHERE id=?", (value, provider_id))
            await db.commit()
        await state.clear()
        await message.answer("✅ تم حفظ Order param.")

    @router.callback_query(F.data.startswith("statusadmin:key:"))
    async def key_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync", "can_manage_orders"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        await state.clear(); await state.update_data(status_provider_id=provider_id)
        await state.set_state(StatusAdminStates.response_key)
        await callback.message.answer("📊 أرسل مسار حالة الطلب داخل JSON، مثال: status أو data.status")
        await callback.answer()

    @router.message(StatusAdminStates.response_key)
    async def key_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products", "can_manage_sync", "can_manage_orders"):
            await state.clear(); return
        value = str(message.text or "").strip()[:120]
        if not value:
            return await message.answer("اكتب Status key صالحًا.")
        provider_id = int((await state.get_data()).get("status_provider_id") or 0)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute("UPDATE client_api_providers SET status_response_key=?,status_enabled=0 WHERE id=?", (value, provider_id))
            await db.commit()
        await state.clear()
        await message.answer("✅ تم حفظ Status key وإيقاف المتابعة حتى تراجع الإعداد.")

    async def startup(*args: Any, **kwargs: Any) -> None:
        global _MONITOR_TASK
        enabled = os.getenv("CLIENT_API_STATUS_MONITOR_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
        if enabled and (_MONITOR_TASK is None or _MONITOR_TASK.done()):
            _MONITOR_TASK = asyncio.create_task(_background_loop(store), name="client-api-status-monitor")

    async def shutdown(*args: Any, **kwargs: Any) -> None:
        global _MONITOR_TASK
        task = _MONITOR_TASK
        _MONITOR_TASK = None
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    store.dp.startup.register(startup)
    store.dp.shutdown.register(shutdown)
    store.dp.include_router(router)
    store._client_api_status_installed = True
