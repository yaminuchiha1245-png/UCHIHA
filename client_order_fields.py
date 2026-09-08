from __future__ import annotations

import datetime
import html
import uuid
from typing import Any

import aiosqlite
from aiogram import F, Router
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from client_services_store import _money, _short
from client_store_admin import (
    _allowed,
    _effective_price,
    _fetch_item,
    _replace_named_handler,
    ensure_admin_schema,
)


class FieldAdminStates(StatesGroup):
    label = State()
    hint = State()


class ManualOrderStates(StatesGroup):
    customer_input = State()


async def ensure_field_schema(store: Any) -> None:
    await ensure_admin_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        for sql in (
            "ALTER TABLE client_provider_products ADD COLUMN customer_input_required INTEGER DEFAULT 0",
            "ALTER TABLE client_provider_products ADD COLUMN customer_input_label TEXT DEFAULT ''",
            "ALTER TABLE client_provider_products ADD COLUMN customer_input_hint TEXT DEFAULT ''",
        ):
            try:
                await db.execute(sql)
            except Exception:
                pass
        await db.commit()


async def _field_row(store: Any, item_id: int) -> tuple[Any, ...] | None:
    await ensure_field_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT id,name,COALESCE(customer_input_required,0),
                   COALESCE(customer_input_label,''),COALESCE(customer_input_hint,''),
                   COALESCE(source_type,'api'),status,is_active
            FROM client_provider_products WHERE id=?
            """,
            (item_id,),
        ) as cursor:
            return await cursor.fetchone()


async def _edit(store: Any, callback: CallbackQuery, text: str, rows: list[list[InlineKeyboardButton]]) -> None:
    markup = InlineKeyboardMarkup(inline_keyboard=rows)
    try:
        await store.safe_edit_message(callback.message, text, markup)
    except Exception:
        try:
            await callback.message.edit_text(text, reply_markup=markup)
        except Exception:
            await callback.message.answer(text, reply_markup=markup)


def _admin_panel_wrapper(original: Any):
    def wrapped(perms: dict | None = None, super_admin: bool = False) -> InlineKeyboardMarkup:
        markup = original(perms, super_admin)
        rows = [list(row) for row in markup.inline_keyboard]
        p = perms or {}
        if super_admin or p.get("can_manage_products"):
            pos = max(len(rows) - 1, 0)
            rows.insert(pos, [InlineKeyboardButton(text="🧾 متطلبات الطلب", callback_data="clifields:list")])
        return InlineKeyboardMarkup(inline_keyboard=rows)
    return wrapped


async def _render_field_detail(store: Any, callback: CallbackQuery, item_id: int) -> None:
    row = await _field_row(store, item_id)
    if not row:
        return await callback.answer("المنتج غير موجود.", show_alert=True)
    required = bool(int(row[2] or 0))
    text = (
        f"🧾 متطلبات الطلب\n\n"
        f"📦 {html.escape(_short(row[1], 90))}\n"
        f"الحالة: {'✅ مطلوب من العميل' if required else '➖ لا توجد بيانات مطلوبة'}\n"
        f"اسم الحقل: {html.escape(str(row[3] or '—'))}\n"
        f"التوضيح: {html.escape(str(row[4] or '—'))}\n\n"
        "مثال Diamond FF: اسم الحقل «ID اللاعب».\n"
        "مثال شهادة iOS: اسم الحقل «UDID الجهاز»."
    )
    rows = [
        [InlineKeyboardButton(
            text="➖ إلغاء طلب البيانات" if required else "✅ طلب بيانات من العميل",
            callback_data=f"clifields:toggle:{item_id}",
        )],
        [
            InlineKeyboardButton(text="✏️ اسم الحقل", callback_data=f"clifields:label:{item_id}"),
            InlineKeyboardButton(text="💬 التوضيح", callback_data=f"clifields:hint:{item_id}"),
        ],
        [InlineKeyboardButton(text="🔙 المنتجات", callback_data="clifields:list")],
    ]
    await _edit(store, callback, text, rows)


async def _show_confirmation(
    store: Any,
    callback: CallbackQuery,
    item_id: int,
    row: tuple[Any, ...],
    price: float,
    customer_input: str = "",
    label: str = "",
) -> None:
    extra = ""
    if customer_input:
        extra = f"\n🧾 {html.escape(label or 'بيانات الطلب')}: {html.escape(customer_input)}"
    await _edit(
        store,
        callback,
        f"🧾 تأكيد الطلب\n\n📦 {html.escape(_short(row[0], 90))}\n"
        f"💰 المبلغ: {_money(price)} ${extra}\n\n"
        "لن يتم الخصم إلا بعد الضغط على التأكيد.",
        [
            [InlineKeyboardButton(text=f"✅ تأكيد وخصم {_money(price)} $", callback_data=f"cli:confirm:{item_id}")],
            [InlineKeyboardButton(text="❌ إلغاء", callback_data=f"cli:product:{item_id}")],
        ],
    )


def install(store: Any) -> None:
    if getattr(store, "_client_order_fields_installed", False):
        return

    store.admin_panel_kb = _admin_panel_wrapper(store.admin_panel_kb)
    router = Router(name="client_order_fields")

    @router.callback_query(F.data == "clifields:list")
    async def field_list(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products"):
            return await callback.answer("غير مصرح.", show_alert=True)
        await ensure_field_schema(store)
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute(
                """
                SELECT id,name,COALESCE(customer_input_required,0),COALESCE(source_type,'api')
                FROM client_provider_products
                WHERE status='organized'
                ORDER BY sort_order,id DESC LIMIT 80
                """
            ) as cursor:
                items = await cursor.fetchall()
        rows = [
            [InlineKeyboardButton(
                text=f"{'🧾' if int(item[2] or 0) else '➖'} "
                     f"{'📝' if str(item[3]) == 'manual' else '🔌'} {_short(item[1], 25)}",
                callback_data=f"clifields:item:{int(item[0])}",
            )]
            for item in items
        ]
        if not rows:
            rows.append([InlineKeyboardButton(text="رتب المنتجات أولًا", callback_data="cli:staged:unorganized")])
        rows.append([store.back_btn("cliadmin:home", "🔙 إدارة المتجر")])
        await _edit(
            store,
            callback,
            "🧾 متطلبات الطلب\n\nحدد البيانات التي يجب أن يرسلها العميل قبل تأكيد طلب الخدمة.",
            rows,
        )
        await callback.answer()

    @router.callback_query(F.data.startswith("clifields:item:"))
    async def field_detail(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products"):
            return await callback.answer("غير مصرح.", show_alert=True)
        item_id = int(str(callback.data).rsplit(":", 1)[1])
        await _render_field_detail(store, callback, item_id)
        await callback.answer()

    @router.callback_query(F.data.startswith("clifields:toggle:"))
    async def field_toggle(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products"):
            return await callback.answer("غير مصرح.", show_alert=True)
        item_id = int(str(callback.data).rsplit(":", 1)[1])
        await ensure_field_schema(store)
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute(
                "SELECT COALESCE(customer_input_required,0) FROM client_provider_products WHERE id=?",
                (item_id,),
            ) as cursor:
                row = await cursor.fetchone()
            if not row:
                return await callback.answer("المنتج غير موجود.", show_alert=True)
            value = 0 if int(row[0] or 0) else 1
            await db.execute(
                "UPDATE client_provider_products SET customer_input_required=? WHERE id=?",
                (value, item_id),
            )
            await db.commit()
        await callback.answer("تم تحديث متطلبات الطلب.", show_alert=True)
        await _render_field_detail(store, callback, item_id)

    @router.callback_query(F.data.startswith("clifields:label:"))
    async def label_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products"):
            return await callback.answer("غير مصرح.", show_alert=True)
        item_id = int(str(callback.data).rsplit(":", 1)[1])
        await state.clear()
        await state.update_data(field_item_id=item_id)
        await state.set_state(FieldAdminStates.label)
        await callback.message.answer("✏️ أرسل اسم المعلومة المطلوبة، مثال: ID اللاعب أو UDID الجهاز")
        await callback.answer()

    @router.message(FieldAdminStates.label)
    async def label_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products"):
            await state.clear()
            return
        value = str(message.text or "").strip()[:80]
        if len(value) < 2:
            return await message.answer("اكتب اسم حقل أوضح.")
        item_id = int((await state.get_data()).get("field_item_id") or 0)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                "UPDATE client_provider_products SET customer_input_label=?,customer_input_required=1 WHERE id=?",
                (value, item_id),
            )
            await db.commit()
        await state.clear()
        await message.answer("✅ تم حفظ اسم الحقل وتفعيل طلب البيانات.")

    @router.callback_query(F.data.startswith("clifields:hint:"))
    async def hint_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products"):
            return await callback.answer("غير مصرح.", show_alert=True)
        item_id = int(str(callback.data).rsplit(":", 1)[1])
        await state.clear()
        await state.update_data(field_item_id=item_id)
        await state.set_state(FieldAdminStates.hint)
        await callback.message.answer("💬 أرسل توضيحًا للعميل، مثال: انسخ ID اللاعب كما يظهر داخل Free Fire")
        await callback.answer()

    @router.message(FieldAdminStates.hint)
    async def hint_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products"):
            await state.clear()
            return
        value = str(message.text or "").strip()[:300]
        item_id = int((await state.get_data()).get("field_item_id") or 0)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                "UPDATE client_provider_products SET customer_input_hint=? WHERE id=?",
                (value, item_id),
            )
            await db.commit()
        await state.clear()
        await message.answer("✅ تم حفظ التوضيح.")

    async def buy(callback: CallbackQuery, state: Any) -> None:
        item_id = int(str(callback.data).rsplit(":", 1)[1])
        row = await _fetch_item(store, item_id)
        if not row or str(row[6]) != "organized" or not int(row[7] or 0):
            return await callback.answer("المنتج غير متاح.", show_alert=True)
        if str(row[9]) != "manual" or int(row[11] or 0) <= 0:
            return await callback.answer(
                "هذا المنتج مرتبط بـ API، ويُفعّل الشراء بعد تركيب Adapter موثوق للمزوّد.",
                show_alert=True,
            )
        price, _, _ = await _effective_price(store, callback.from_user.id, row)
        field = await _field_row(store, item_id)
        required = bool(field and int(field[2] or 0))
        label = str(field[3] or "بيانات الطلب") if field else "بيانات الطلب"
        hint = str(field[4] or "") if field else ""
        await state.clear()
        await state.update_data(
            manual_item_id=item_id,
            manual_item_price=price,
            manual_input_label=label,
        )
        if required:
            await state.set_state(ManualOrderStates.customer_input)
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
        await _show_confirmation(store, callback, item_id, row, price)
        await callback.answer()

    @router.message(ManualOrderStates.customer_input)
    async def customer_input(message: Message, state: Any) -> None:
        value = str(message.text or message.caption or "").strip()
        if len(value) < 1:
            return await message.answer("أرسل المعلومة المطلوبة كنص.")
        if len(value) > 500:
            return await message.answer("المعلومة طويلة جدًا. أرسل قيمة مختصرة حتى 500 حرف.")
        data = await state.get_data()
        item_id = int(data.get("manual_item_id") or 0)
        row = await _fetch_item(store, item_id)
        if not row or str(row[6]) != "organized" or not int(row[7] or 0):
            await state.clear()
            return await message.answer("المنتج لم يعد متاحًا.")
        price, _, _ = await _effective_price(store, message.from_user.id, row)
        label = str(data.get("manual_input_label") or "بيانات الطلب")
        await state.update_data(manual_customer_input=value, manual_item_price=price)
        text = (
            f"🧾 تأكيد الطلب\n\n📦 {html.escape(_short(row[0], 90))}\n"
            f"💰 المبلغ: {_money(price)} $\n"
            f"🧾 {html.escape(label)}: {html.escape(value)}\n\n"
            "لن يتم الخصم إلا بعد الضغط على التأكيد."
        )
        await message.answer(
            text,
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text=f"✅ تأكيد وخصم {_money(price)} $", callback_data=f"cli:confirm:{item_id}")],
                [InlineKeyboardButton(text="❌ إلغاء", callback_data=f"cli:product:{item_id}")],
            ]),
        )

    _replace_named_handler(store.dp, "callback_query", "buy", buy)

    async def confirm_manual(callback: CallbackQuery, state: Any) -> None:
        item_id = int(str(callback.data).rsplit(":", 1)[1])
        if await store.is_banned(callback.from_user.id):
            return await callback.answer("🚫 أنت محظور.", show_alert=True)
        row = await _fetch_item(store, item_id)
        if not row or str(row[9]) != "manual" or str(row[6]) != "organized" or not int(row[7] or 0):
            return await callback.answer("المنتج غير متاح للشراء.", show_alert=True)
        field = await _field_row(store, item_id)
        data = await state.get_data()
        customer_input = str(data.get("manual_customer_input") or "").strip()
        label = str(data.get("manual_input_label") or (field[3] if field else "بيانات الطلب") or "بيانات الطلب")
        if field and int(field[2] or 0) and not customer_input:
            return await callback.answer("أرسل بيانات الطلب المطلوبة أولًا.", show_alert=True)
        price, _, _ = await _effective_price(store, callback.from_user.id, row)
        user_id = callback.from_user.id
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        purchase_token = f"client-manual-{user_id}-{uuid.uuid4().hex}"
        details = str(row[10] or "").strip()
        if customer_input:
            details = (details + "\n" if details else "") + f"{label}: {customer_input}"
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute("BEGIN IMMEDIATE")
            try:
                async with db.execute("SELECT balance FROM users WHERE user_id=?", (user_id,)) as cursor:
                    user = await cursor.fetchone()
                balance = float(user[0] or 0) if user else 0.0
                if balance + 1e-9 < price:
                    await db.rollback()
                    await _edit(
                        store,
                        callback,
                        f"❌ الرصيد غير كافٍ.\n\nالمطلوب: {_money(price)} $\nرصيدك: {_money(balance)} $",
                        [
                            [InlineKeyboardButton(text="💳 شحن الرصيد", callback_data="deposit_request")],
                            [InlineKeyboardButton(text="🔙 رجوع", callback_data=f"cli:product:{item_id}")],
                        ],
                    )
                    return await callback.answer("الرصيد غير كافٍ.", show_alert=True)
                local_product_id = int(row[11] or 0)
                await db.execute("UPDATE users SET balance=balance-? WHERE user_id=?", (price, user_id))
                cursor = await db.execute(
                    """
                    INSERT INTO orders(
                        user_id,product_id,quantity,total_price,status,order_date,note,
                        delivery_info,purchase_token,payment_state,purchase_flow
                    ) VALUES(?,?,1,?,'pending',?,?,?,?,'paid','client_manual')
                    """,
                    (
                        user_id,
                        local_product_id,
                        price,
                        now,
                        f"Client catalog item #{item_id}" + (f" | {label}: {customer_input}" if customer_input else ""),
                        details,
                        purchase_token,
                    ),
                )
                order_id = int(cursor.lastrowid)
                await db.execute(
                    """
                    INSERT INTO balance_logs(user_id,amount,type,reason,date,admin_id)
                    VALUES(?,?,'purchase',?,?,0)
                    """,
                    (user_id, -price, f"طلب يدوي #{order_id}: {row[0]}", now),
                )
                await db.commit()
            except Exception:
                await db.rollback()
                raise
        await state.clear()
        await _edit(
            store,
            callback,
            f"✅ تم إنشاء الطلب #{order_id}\n\n"
            f"📦 {html.escape(_short(row[0], 90))}\n"
            f"💰 تم خصم: {_money(price)} $"
            + (f"\n🧾 {html.escape(label)}: {html.escape(customer_input)}" if customer_input else "")
            + f"\n🕒 {html.escape(str(row[10] or 'سيتم تجهيز الطلب يدويًا من الإدارة.'))}",
            [
                [InlineKeyboardButton(text="📦 طلباتي", callback_data="my_orders")],
                [store.back_btn("main_menu", "🏠 الرئيسية")],
            ],
        )
        try:
            admin_id = int(getattr(store, "ADMIN_ID", 0) or 0)
            if admin_id:
                notice = (
                    f"🆕 طلب يدوي جديد #{order_id}\n"
                    f"👤 المستخدم: {user_id}\n📦 {row[0]}\n💰 {_money(price)} $"
                )
                if customer_input:
                    notice += f"\n🧾 {label}: {customer_input}"
                await store.bot.send_message(admin_id, notice)
        except Exception:
            pass
        await callback.answer("تم الطلب بنجاح.", show_alert=True)

    _replace_named_handler(store.dp, "callback_query", "confirm_manual", confirm_manual)

    store.dp.include_router(router)
    store._client_order_fields_installed = True
