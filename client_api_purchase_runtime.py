from __future__ import annotations

import datetime
import html
import uuid
from typing import Any

import aiosqlite
from aiogram import F, Router
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from client_order_fields import _field_row
from client_purchase_adapter import ensure_purchase_schema, execute_generic_purchase
from client_services_store import _money, _short
from client_store_admin import _effective_price, _fetch_item, _replace_named_handler, ensure_admin_schema


class ApiOrderStates(StatesGroup):
    customer_input = State()


def _walk_routers(router: Any):
    yield router
    for child in getattr(router, "sub_routers", []):
        yield from _walk_routers(child)


def _find_named_handler(root_router: Any, observer_name: str, callback_name: str):
    for router in _walk_routers(root_router):
        observer = getattr(router, observer_name, None)
        for handler in getattr(observer, "handlers", []) if observer is not None else []:
            callback = getattr(handler, "callback", None)
            if getattr(callback, "__name__", "") == callback_name:
                return callback
    return None


async def ensure_runtime_schema(store: Any) -> None:
    await ensure_admin_schema(store)
    await ensure_purchase_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        try:
            await db.execute(
                "ALTER TABLE client_api_order_links ADD COLUMN refund_applied INTEGER DEFAULT 0"
            )
        except Exception:
            pass
        await db.commit()


async def _provider_purchase_ready(store: Any, provider_id: int) -> bool:
    await ensure_runtime_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT COALESCE(purchase_enabled,0),COALESCE(purchase_path,''),is_active
            FROM client_api_providers WHERE id=?
            """,
            (provider_id,),
        ) as cursor:
            row = await cursor.fetchone()
    return bool(row and int(row[0] or 0) and str(row[1] or "").strip() and int(row[2] or 0))


async def _ensure_shadow_product(store: Any, db: aiosqlite.Connection, item_id: int, row: tuple[Any, ...]) -> int:
    local_product_id = int(row[11] or 0)
    if local_product_id:
        return local_product_id
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    cursor = await db.execute(
        """
        INSERT INTO products(
            category_id,name,description,price,stock,is_active,created_at,
            product_type,delivery_info,api_id,api_provider
        ) VALUES(NULL,?,?,?,999999,1,?,'manual','',0,'client_generic_api')
        """,
        (
            str(row[0] or "API Product"),
            "خدمة API من كتالوج متجر العميل",
            float(row[1] or row[2] or 0),
            now,
        ),
    )
    local_product_id = int(cursor.lastrowid)
    await db.execute(
        "UPDATE client_provider_products SET local_product_id=? WHERE id=?",
        (local_product_id, item_id),
    )
    return local_product_id


async def _show_api_confirmation(
    store: Any,
    target: Any,
    *,
    item_id: int,
    name: str,
    price: float,
    customer_input: str = "",
    label: str = "",
) -> None:
    extra = ""
    if customer_input:
        extra = f"\n🧾 {html.escape(label or 'بيانات الطلب')}: {html.escape(customer_input)}"
    text = (
        f"🧾 تأكيد طلب API\n\n"
        f"📦 {html.escape(_short(name, 90))}\n"
        f"💰 المبلغ: {_money(price)} ${extra}\n\n"
        "سيتم إرسال الطلب للمزوّد بعد التأكيد. إذا رفض المزوّد الطلب بشكل مؤكد، يرجع الرصيد تلقائيًا."
    )
    markup = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=f"✅ تأكيد وخصم {_money(price)} $", callback_data=f"cli:api-confirm:{item_id}")],
            [InlineKeyboardButton(text="❌ إلغاء", callback_data=f"cli:product:{item_id}")],
        ]
    )
    message = getattr(target, "message", target)
    try:
        await store.safe_edit_message(message, text, markup)
    except Exception:
        await message.answer(text, reply_markup=markup)


async def _reserve_order(
    store: Any,
    *,
    user_id: int,
    item_id: int,
    row: tuple[Any, ...],
    price: float,
    customer_input: str,
    label: str,
    request_token: str,
) -> tuple[bool, int, float, str]:
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    await ensure_runtime_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        await db.execute("BEGIN IMMEDIATE")
        try:
            async with db.execute(
                "SELECT local_order_id FROM client_api_order_links WHERE request_token=?",
                (request_token,),
            ) as cursor:
                existing = await cursor.fetchone()
            if existing:
                await db.rollback()
                return True, int(existing[0]), 0.0, "existing"

            async with db.execute("SELECT balance FROM users WHERE user_id=?", (user_id,)) as cursor:
                user = await cursor.fetchone()
            balance = float(user[0] or 0) if user else 0.0
            if balance + 1e-9 < price:
                await db.rollback()
                return False, 0, balance, "insufficient"

            local_product_id = await _ensure_shadow_product(store, db, item_id, row)
            note = f"Client API item #{item_id}"
            if customer_input:
                note += f" | {label}: {customer_input}"
            await db.execute("UPDATE users SET balance=balance-? WHERE user_id=?", (price, user_id))
            cursor = await db.execute(
                """
                INSERT INTO orders(
                    user_id,product_id,quantity,total_price,status,order_date,note,
                    delivery_info,purchase_token,payment_state,purchase_flow
                ) VALUES(?,?,1,?,'processing',?,?,?,?,'paid','client_api_generic')
                """,
                (
                    user_id,
                    local_product_id,
                    price,
                    now,
                    note,
                    f"API provider: {row[13]}",
                    request_token,
                ),
            )
            order_id = int(cursor.lastrowid)
            await db.execute(
                """
                INSERT INTO balance_logs(user_id,amount,type,reason,date,admin_id)
                VALUES(?,?,'purchase',?,?,0)
                """,
                (user_id, -price, f"طلب API #{order_id}: {row[0]}", now),
            )
            await db.execute(
                """
                INSERT INTO client_api_order_links(
                    local_order_id,catalog_item_id,provider_id,request_token,provider_status
                ) VALUES(?,?,?,?, 'reserved')
                """,
                (order_id, item_id, int(row[14] or 0), request_token),
            )
            await db.commit()
            return True, order_id, balance - price, "reserved"
        except Exception:
            await db.rollback()
            raise


async def _finalize_success(store: Any, order_id: int, result: Any) -> None:
    status = "completed" if bool(result.completed) else "processing"
    async with aiosqlite.connect(store.DB_PATH) as db:
        await db.execute("UPDATE orders SET status=? WHERE id=?", (status, order_id))
        await db.execute(
            """
            UPDATE client_api_order_links
            SET external_order_id=?,provider_status=?,raw_response=?,last_error='',updated_at=CURRENT_TIMESTAMP
            WHERE local_order_id=?
            """,
            (
                str(result.external_order_id or ""),
                str(result.provider_status or "accepted"),
                str(result.raw_response or "")[:12000],
                order_id,
            ),
        )
        await db.commit()


async def _mark_uncertain(store: Any, order_id: int, result: Any) -> None:
    """Keep funds reserved when the provider may have accepted the request."""
    async with aiosqlite.connect(store.DB_PATH) as db:
        await db.execute("UPDATE orders SET status='processing' WHERE id=?", (order_id,))
        await db.execute(
            """
            UPDATE client_api_order_links
            SET external_order_id=?,provider_status='uncertain',raw_response=?,last_error=?,updated_at=CURRENT_TIMESTAMP
            WHERE local_order_id=?
            """,
            (
                str(getattr(result, "external_order_id", "") or ""),
                str(getattr(result, "raw_response", "") or "")[:12000],
                str(getattr(result, "error", "") or "Uncertain provider result")[:500],
                order_id,
            ),
        )
        await db.commit()


async def _refund_failed(store: Any, *, order_id: int, user_id: int, price: float, result: Any) -> bool:
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    async with aiosqlite.connect(store.DB_PATH) as db:
        await db.execute("BEGIN IMMEDIATE")
        try:
            async with db.execute(
                "SELECT COALESCE(refund_applied,0) FROM client_api_order_links WHERE local_order_id=?",
                (order_id,),
            ) as cursor:
                link = await cursor.fetchone()
            if link and int(link[0] or 0):
                await db.rollback()
                return False
            await db.execute("UPDATE users SET balance=balance+? WHERE user_id=?", (price, user_id))
            await db.execute(
                "UPDATE orders SET status='cancelled',payment_state='refunded' WHERE id=?",
                (order_id,),
            )
            await db.execute(
                """
                UPDATE client_api_order_links
                SET provider_status='failed',raw_response=?,last_error=?,refund_applied=1,updated_at=CURRENT_TIMESTAMP
                WHERE local_order_id=?
                """,
                (
                    str(getattr(result, "raw_response", "") or "")[:12000],
                    str(getattr(result, "error", "") or "Provider rejected purchase")[:500],
                    order_id,
                ),
            )
            await db.execute(
                """
                INSERT INTO balance_logs(user_id,amount,type,reason,date,admin_id)
                VALUES(?,?,'refund',?,?,0)
                """,
                (user_id, price, f"استرجاع تلقائي لطلب API #{order_id}", now),
            )
            await db.commit()
            return True
        except Exception:
            await db.rollback()
            raise


def install(store: Any) -> None:
    if getattr(store, "_client_api_purchase_runtime_installed", False):
        return

    original_buy = _find_named_handler(store.dp, "callback_query", "buy")
    router = Router(name="client_api_purchase_runtime")

    async def buy(callback: CallbackQuery, state: Any) -> None:
        item_id = int(str(callback.data).rsplit(":", 1)[1])
        row = await _fetch_item(store, item_id)
        if not row or str(row[6]) != "organized" or not int(row[7] or 0):
            return await callback.answer("المنتج غير متاح.", show_alert=True)
        if str(row[8]) == "manual" or str(row[9]) == "manual":
            if original_buy is None:
                return await callback.answer("تعذر تجهيز الطلب اليدوي.", show_alert=True)
            return await original_buy(callback, state)

        provider_id = int(row[14] or 0)
        if not await _provider_purchase_ready(store, provider_id):
            return await callback.answer("هذا المنتج غير متاح للشراء التلقائي حاليًا.", show_alert=True)

        price, _, _ = await _effective_price(store, callback.from_user.id, row)
        field = await _field_row(store, item_id)
        required = bool(field and int(field[2] or 0))
        label = str(field[3] or "بيانات الطلب") if field else "بيانات الطلب"
        hint = str(field[4] or "") if field else ""
        token = f"client-api-{callback.from_user.id}-{uuid.uuid4().hex}"
        await state.clear()
        await state.update_data(api_item_id=item_id, api_input_label=label, api_purchase_token=token)
        if required:
            await state.set_state(ApiOrderStates.customer_input)
            prompt = f"🧾 أرسل الآن: {html.escape(label)}"
            if hint:
                prompt += f"\n\n💬 {html.escape(hint)}"
            await callback.message.answer(
                prompt,
                reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
                    InlineKeyboardButton(text="❌ إلغاء", callback_data=f"cli:product:{item_id}")
                ]]),
            )
            return await callback.answer()
        await _show_api_confirmation(store, callback, item_id=item_id, name=str(row[0]), price=price)
        await callback.answer()

    if original_buy is not None:
        _replace_named_handler(store.dp, "callback_query", "buy", buy)

    @router.message(ApiOrderStates.customer_input)
    async def api_customer_input(message: Message, state: Any) -> None:
        value = str(message.text or message.caption or "").strip()
        if not value:
            return await message.answer("أرسل المعلومة المطلوبة كنص.")
        if len(value) > 500:
            return await message.answer("المعلومة طويلة جدًا. الحد 500 حرف.")
        data = await state.get_data()
        item_id = int(data.get("api_item_id") or 0)
        row = await _fetch_item(store, item_id)
        if not row or str(row[6]) != "organized" or not int(row[7] or 0):
            await state.clear()
            return await message.answer("المنتج لم يعد متاحًا.")
        price, _, _ = await _effective_price(store, message.from_user.id, row)
        label = str(data.get("api_input_label") or "بيانات الطلب")
        await state.update_data(api_customer_input=value)
        await _show_api_confirmation(
            store,
            message,
            item_id=item_id,
            name=str(row[0]),
            price=price,
            customer_input=value,
            label=label,
        )

    @router.callback_query(F.data.startswith("cli:api-confirm:"))
    async def confirm_api(callback: CallbackQuery, state: Any) -> None:
        if await store.is_banned(callback.from_user.id):
            return await callback.answer("🚫 أنت محظور.", show_alert=True)
        item_id = int(str(callback.data).rsplit(":", 1)[1])
        data = await state.get_data()
        request_token = str(data.get("api_purchase_token") or "").strip()
        if not request_token or int(data.get("api_item_id") or 0) != item_id:
            return await callback.answer("انتهت جلسة الطلب. افتح المنتج وابدأ من جديد.", show_alert=True)

        row = await _fetch_item(store, item_id)
        if not row or str(row[8]) == "manual" or str(row[6]) != "organized" or not int(row[7] or 0):
            await state.clear()
            return await callback.answer("المنتج غير متاح.", show_alert=True)
        provider_id = int(row[14] or 0)
        if not await _provider_purchase_ready(store, provider_id):
            await state.clear()
            return await callback.answer("الشراء التلقائي متوقف لهذا المزوّد.", show_alert=True)

        field = await _field_row(store, item_id)
        customer_input = str(data.get("api_customer_input") or "").strip()
        label = str(data.get("api_input_label") or (field[3] if field else "بيانات الطلب") or "بيانات الطلب")
        if field and int(field[2] or 0) and not customer_input:
            return await callback.answer("أرسل بيانات الطلب المطلوبة أولًا.", show_alert=True)

        price, _, _ = await _effective_price(store, callback.from_user.id, row)
        user_id = callback.from_user.id
        reserved, order_id, balance_value, reason = await _reserve_order(
            store,
            user_id=user_id,
            item_id=item_id,
            row=row,
            price=price,
            customer_input=customer_input,
            label=label,
            request_token=request_token,
        )
        if not reserved:
            if reason == "insufficient":
                await _show_api_confirmation(
                    store,
                    callback,
                    item_id=item_id,
                    name=str(row[0]),
                    price=price,
                    customer_input=customer_input,
                    label=label,
                )
                return await callback.answer(
                    f"الرصيد غير كافٍ. رصيدك {_money(balance_value)} $",
                    show_alert=True,
                )
            return await callback.answer("تعذر حجز الطلب.", show_alert=True)
        if reason == "existing":
            await state.clear()
            return await callback.answer(f"الطلب #{order_id} مسجل مسبقًا.", show_alert=True)

        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute("SELECT external_id FROM client_provider_products WHERE id=?", (item_id,)) as cursor:
                product = await cursor.fetchone()
        external_id = str(product[0] if product else "")
        result = await execute_generic_purchase(
            store,
            provider_id=provider_id,
            external_product_id=external_id,
            customer_input=customer_input,
            quantity=1,
            idempotency_key=request_token,
        )

        if not result.ok:
            await state.clear()
            if bool(getattr(result, "failure_is_definitive", False)):
                await _refund_failed(store, order_id=order_id, user_id=user_id, price=price, result=result)
                await callback.answer("رفض المزوّد الطلب وتم إرجاع الرصيد.", show_alert=True)
                try:
                    await store.safe_edit_message(
                        callback.message,
                        f"❌ رفض المزوّد الطلب #{order_id}.\n\nتم إرجاع {_money(price)} $ إلى رصيدك تلقائيًا.",
                        InlineKeyboardMarkup(inline_keyboard=[
                            [InlineKeyboardButton(text="🔙 المنتج", callback_data=f"cli:product:{item_id}")],
                            [store.back_btn("main_menu", "🏠 الرئيسية")],
                        ]),
                    )
                except Exception:
                    pass
                return

            await _mark_uncertain(store, order_id, result)
            await callback.answer("النتيجة غير مؤكدة؛ لم نكرر الطلب ولم نرجع الرصيد تلقائيًا.", show_alert=True)
            await store.safe_edit_message(
                callback.message,
                f"⚠️ الطلب #{order_id} يحتاج تحققًا.\n\n"
                "لم يصل تأكيد نهائي من المزوّد. حفاظًا على الرصيد ومنع تنفيذ الطلب مرتين، "
                "تم إبقاء الطلب قيد المعالجة ولم يُرسل طلب جديد تلقائيًا.",
                InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="📦 طلباتي", callback_data="my_orders")],
                    [store.back_btn("main_menu", "🏠 الرئيسية")],
                ]),
            )
            try:
                admin_id = int(getattr(store, "ADMIN_ID", 0) or 0)
                if admin_id:
                    await store.bot.send_message(
                        admin_id,
                        f"⚠️ طلب API غير مؤكد #{order_id}\n"
                        f"المستخدم: {user_id}\nالمزوّد: {row[13]}\n"
                        f"الخطأ: {str(result.error or 'unknown')[:300]}\n"
                        "لم يتم رد الرصيد تلقائيًا؛ تحقق من المزوّد قبل أي إجراء يدوي.",
                    )
            except Exception:
                pass
            return

        await _finalize_success(store, order_id, result)
        await state.clear()
        status_text = "✅ مكتمل" if result.completed else "🔄 قيد المعالجة"
        external_text = f"\n🔗 رقم المزوّد: {html.escape(result.external_order_id)}" if result.external_order_id else ""
        await store.safe_edit_message(
            callback.message,
            f"✅ تم إرسال الطلب #{order_id} للمزوّد.\n\n"
            f"📦 {html.escape(_short(row[0], 90))}\n"
            f"💰 تم خصم: {_money(price)} $\n"
            f"الحالة: {status_text}{external_text}",
            InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="📦 طلباتي", callback_data="my_orders")],
                [store.back_btn("main_menu", "🏠 الرئيسية")],
            ]),
        )
        try:
            admin_id = int(getattr(store, "ADMIN_ID", 0) or 0)
            if admin_id:
                notice = (
                    f"🔌 طلب API جديد #{order_id}\n"
                    f"👤 المستخدم: {user_id}\n📦 {row[0]}\n💰 {_money(price)} $\n"
                    f"المزوّد: {row[13]}\nالحالة: {result.provider_status or 'accepted'}"
                )
                if result.external_order_id:
                    notice += f"\nرقم المزوّد: {result.external_order_id}"
                if customer_input:
                    notice += f"\n🧾 {label}: {customer_input}"
                await store.bot.send_message(admin_id, notice)
        except Exception:
            pass
        await callback.answer("تم إرسال الطلب للمزوّد.", show_alert=True)

    store.dp.include_router(router)
    store._client_api_purchase_runtime_installed = True
