from __future__ import annotations

import datetime
from typing import Any, Awaitable, Callable

import aiosqlite
from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery


_PREFIX = "admin_set_order_status_"


async def _can_manage_orders(store: Any, user_id: int) -> bool:
    if not await store.is_admin(user_id):
        return False
    if await store.is_super_admin(user_id):
        return True
    perms = await store.get_admin_perms(user_id)
    return bool(perms.get("can_manage_orders"))


async def cancel_client_manual_order(store: Any, *, order_id: int, admin_id: int) -> tuple[bool, str, int, float]:
    """Cancel a paid client-manual order and refund exactly once."""
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    async with aiosqlite.connect(store.DB_PATH) as db:
        await db.execute("BEGIN IMMEDIATE")
        try:
            async with db.execute(
                """
                SELECT user_id,COALESCE(total_price,0),COALESCE(status,''),
                       COALESCE(payment_state,''),COALESCE(purchase_flow,'')
                FROM orders WHERE id=?
                """,
                (order_id,),
            ) as cursor:
                row = await cursor.fetchone()
            if not row:
                await db.rollback()
                return False, "الطلب غير موجود.", 0, 0.0
            user_id = int(row[0] or 0)
            price = max(float(row[1] or 0), 0.0)
            status = str(row[2] or "")
            payment_state = str(row[3] or "")
            flow = str(row[4] or "")
            if flow != "client_manual":
                await db.rollback()
                return False, "هذا ليس طلبًا يدويًا تابعًا لنسخة العميل.", user_id, price
            if payment_state == "refunded":
                if status != "cancelled":
                    await db.execute("UPDATE orders SET status='cancelled' WHERE id=?", (order_id,))
                    await db.commit()
                else:
                    await db.rollback()
                return True, "الطلب كان مسترجعًا مسبقًا؛ لم يتم إضافة الرصيد مرة ثانية.", user_id, 0.0
            if status == "completed":
                await db.rollback()
                return False, "الطلب مكتمل. لا يمكن إلغاؤه من الزر السريع بعد التسليم.", user_id, price
            if price <= 0:
                await db.rollback()
                return False, "قيمة الطلب غير صالحة للاسترجاع.", user_id, price

            await db.execute("UPDATE users SET balance=balance+? WHERE user_id=?", (price, user_id))
            await db.execute(
                "UPDATE orders SET status='cancelled',payment_state='refunded' WHERE id=?",
                (order_id,),
            )
            await db.execute(
                """
                INSERT INTO balance_logs(user_id,amount,type,reason,date,admin_id)
                VALUES(?,?,'refund',?,?,?)
                """,
                (user_id, price, f"استرجاع إلغاء طلب يدوي #{order_id}", now, admin_id),
            )
            await db.commit()
            return True, f"تم إلغاء الطلب وإرجاع {price:.2f} $ مرة واحدة.", user_id, price
        except Exception:
            await db.rollback()
            raise


class ClientOrderAdminSafetyMiddleware(BaseMiddleware):
    def __init__(self, store: Any) -> None:
        self.store = store

    async def __call__(
        self,
        handler: Callable[[CallbackQuery, dict[str, Any]], Awaitable[Any]],
        event: CallbackQuery,
        data: dict[str, Any],
    ) -> Any:
        callback_data = str(getattr(event, "data", "") or "")
        if not callback_data.startswith(_PREFIX):
            return await handler(event, data)

        tail = callback_data[len(_PREFIX):]
        try:
            order_part, target_status = tail.rsplit("_", 1)
            order_id = int(order_part)
        except (ValueError, TypeError):
            return await handler(event, data)
        if target_status != "cancelled":
            return await handler(event, data)

        if not await _can_manage_orders(self.store, event.from_user.id):
            return await event.answer("⛔ لا تملك صلاحية إدارة الطلبات.", show_alert=True)

        async with aiosqlite.connect(self.store.DB_PATH) as db:
            async with db.execute(
                "SELECT COALESCE(purchase_flow,'') FROM orders WHERE id=?",
                (order_id,),
            ) as cursor:
                row = await cursor.fetchone()
        flow = str(row[0] or "") if row else ""

        if flow == "client_api_generic":
            await event.answer(
                "لا يمكن إلغاء طلب API من تغيير الحالة العام. استخدم «متابعة API» حتى لا يحدث Refund لطلب ربما نفذه المزوّد.",
                show_alert=True,
            )
            return None
        if flow != "client_manual":
            return await handler(event, data)

        ok, message, user_id, refunded = await cancel_client_manual_order(
            self.store,
            order_id=order_id,
            admin_id=event.from_user.id,
        )
        if not ok:
            await event.answer(message, show_alert=True)
            return None

        try:
            if user_id:
                user_text = f"❌ تم إلغاء طلبك #{order_id}."
                if refunded > 0:
                    user_text += f"\n↩️ أُعيد إلى رصيدك: {refunded:.2f} $"
                await self.store.bot.send_message(user_id, user_text)
        except Exception:
            pass
        await event.answer(message, show_alert=True)
        try:
            event.data = f"admin_order_{order_id}"
            detail = getattr(self.store, "cb_admin_order_detail", None)
            if callable(detail):
                await detail(event)
        except Exception:
            pass
        return None


def install(store: Any) -> None:
    if getattr(store, "_client_order_admin_safety_installed", False):
        return
    store.dp.callback_query.outer_middleware(ClientOrderAdminSafetyMiddleware(store))
    store._client_order_admin_safety_installed = True
