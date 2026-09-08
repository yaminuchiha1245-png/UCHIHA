from __future__ import annotations

import html
from typing import Any

import aiosqlite
from aiogram import F, Router
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from client_purchase_adapter import ensure_purchase_schema
from client_services_store import _short
from client_store_admin import _allowed


class PurchaseConfigStates(StatesGroup):
    path = State()
    product_key = State()
    input_key = State()
    quantity_key = State()
    order_key = State()
    status_key = State()
    accepted_values = State()
    completed_values = State()


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
        if super_admin or p.get("can_manage_products") or p.get("can_manage_sync"):
            if not any(
                getattr(button, "callback_data", None) == "clipurchase:list"
                for row in rows
                for button in row
            ):
                pos = max(len(rows) - 1, 0)
                rows.insert(pos, [
                    InlineKeyboardButton(text="🔁 إعداد شراء API", callback_data="clipurchase:list")
                ])
        return InlineKeyboardMarkup(inline_keyboard=rows)
    return wrapped


async def _provider(store: Any, provider_id: int) -> tuple[Any, ...] | None:
    await ensure_purchase_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT id,name,is_active,COALESCE(purchase_enabled,0),COALESCE(purchase_path,''),
                   COALESCE(purchase_method,'POST'),COALESCE(purchase_payload_mode,'json'),
                   COALESCE(purchase_product_key,'product_id'),COALESCE(purchase_input_key,'customer_id'),
                   COALESCE(purchase_quantity_key,'quantity'),COALESCE(response_order_key,'order_id'),
                   COALESCE(response_status_key,''),COALESCE(accepted_status_values,''),
                   COALESCE(completed_status_values,'')
            FROM client_api_providers WHERE id=? AND adapter_key<>'manual'
            """,
            (provider_id,),
        ) as cursor:
            return await cursor.fetchone()


async def _render_list(store: Any, callback: CallbackQuery) -> None:
    await ensure_purchase_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT id,name,is_active,COALESCE(purchase_enabled,0),COALESCE(purchase_path,'')
            FROM client_api_providers
            WHERE adapter_key<>'manual'
            ORDER BY id DESC
            """
        ) as cursor:
            providers = await cursor.fetchall()
    rows = [
        [InlineKeyboardButton(
            text=f"{'🛒' if int(row[3] or 0) else '⏸'} {'🟢' if int(row[2] or 0) else '⚫'} {_short(row[1], 25)}",
            callback_data=f"clipurchase:provider:{int(row[0])}",
        )]
        for row in providers
    ]
    if not rows:
        rows.append([InlineKeyboardButton(text="أضف مزوّد API أولًا", callback_data="cli:providers")])
    rows.append([store.back_btn("admin_panel", "🔙 لوحة الإدارة")])
    await _edit(
        store,
        callback,
        "🔁 إعداد شراء API\n\n"
        "الشراء مقفول افتراضيًا لكل مزوّد. فعّله فقط بعد إدخال مسار الشراء وأسماء الحقول حسب توثيق المزوّد.\n\n"
        "لا يوجد زر «اختبار شراء» لأن الاختبار قد يخصم رصيدًا حقيقيًا لدى المزوّد.",
        rows,
    )


async def _render_provider(store: Any, callback: CallbackQuery, provider_id: int) -> None:
    row = await _provider(store, provider_id)
    if not row:
        return await callback.answer("المزوّد غير موجود.", show_alert=True)
    text = (
        f"🛒 شراء API — {html.escape(str(row[1]))}\n\n"
        f"المزوّد: {'🟢 مفعّل' if int(row[2] or 0) else '⚫ متوقف'}\n"
        f"الشراء: {'✅ مفعّل' if int(row[3] or 0) else '⏸ متوقف'}\n"
        f"المسار: {html.escape(str(row[4] or '—'))}\n"
        f"HTTP: {html.escape(str(row[5]))} / {html.escape(str(row[6]))}\n\n"
        f"Product key: {html.escape(str(row[7] or '—'))}\n"
        f"Customer key: {html.escape(str(row[8] or '—'))}\n"
        f"Quantity key: {html.escape(str(row[9] or '—'))}\n"
        f"Order response: {html.escape(str(row[10] or '—'))}\n"
        f"Status response: {html.escape(str(row[11] or '2xx = accepted'))}"
    )
    rows = [
        [InlineKeyboardButton(
            text="⏸ إيقاف الشراء" if int(row[3] or 0) else "✅ تفعيل الشراء",
            callback_data=f"clipurchase:toggle:{provider_id}",
        )],
        [InlineKeyboardButton(text="🌐 مسار الشراء", callback_data=f"clipurchase:path:{provider_id}")],
        [
            InlineKeyboardButton(text="📡 HTTP Method", callback_data=f"clipurchase:method:{provider_id}"),
            InlineKeyboardButton(text="📨 طريقة البيانات", callback_data=f"clipurchase:mode:{provider_id}"),
        ],
        [
            InlineKeyboardButton(text="📦 Product key", callback_data=f"clipurchase:key:product:{provider_id}"),
            InlineKeyboardButton(text="🧾 Customer key", callback_data=f"clipurchase:key:input:{provider_id}"),
        ],
        [
            InlineKeyboardButton(text="🔢 Quantity key", callback_data=f"clipurchase:key:quantity:{provider_id}"),
            InlineKeyboardButton(text="🔗 Order key", callback_data=f"clipurchase:key:order:{provider_id}"),
        ],
        [InlineKeyboardButton(text="📊 Status key", callback_data=f"clipurchase:key:status:{provider_id}")],
        [InlineKeyboardButton(text="⚙️ حالات النجاح", callback_data=f"clipurchase:statuses:{provider_id}")],
        [store.back_btn("clipurchase:list", "🔙 مزودو الشراء")],
    ]
    await _edit(store, callback, text, rows)


def _state_for_key(kind: str):
    return {
        "product": PurchaseConfigStates.product_key,
        "input": PurchaseConfigStates.input_key,
        "quantity": PurchaseConfigStates.quantity_key,
        "order": PurchaseConfigStates.order_key,
        "status": PurchaseConfigStates.status_key,
    }[kind]


def _column_for_key(kind: str) -> str:
    return {
        "product": "purchase_product_key",
        "input": "purchase_input_key",
        "quantity": "purchase_quantity_key",
        "order": "response_order_key",
        "status": "response_status_key",
    }[kind]


def install(store: Any) -> None:
    if getattr(store, "_client_purchase_admin_installed", False):
        return

    store.admin_panel_kb = _admin_panel_wrapper(store.admin_panel_kb)
    router = Router(name="client_purchase_admin")

    @router.callback_query(F.data == "clipurchase:list")
    async def purchase_list(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        await _render_list(store, callback)
        await callback.answer()

    @router.callback_query(F.data.startswith("clipurchase:provider:"))
    async def purchase_provider(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        await _render_provider(store, callback, provider_id)
        await callback.answer()

    @router.callback_query(F.data.startswith("clipurchase:toggle:"))
    async def toggle(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        row = await _provider(store, provider_id)
        if not row:
            return await callback.answer("المزوّد غير موجود.", show_alert=True)
        new_value = 0 if int(row[3] or 0) else 1
        if new_value and not str(row[4] or "").strip():
            return await callback.answer("أدخل مسار الشراء أولًا.", show_alert=True)
        if new_value and not str(row[7] or "").strip():
            return await callback.answer("حدد Product key أولًا.", show_alert=True)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                "UPDATE client_api_providers SET purchase_enabled=? WHERE id=?",
                (new_value, provider_id),
            )
            await db.commit()
        await callback.answer("تم تحديث حالة الشراء.", show_alert=True)
        await _render_provider(store, callback, provider_id)

    @router.callback_query(F.data.startswith("clipurchase:path:"))
    async def path_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        await state.clear()
        await state.update_data(purchase_provider_id=provider_id)
        await state.set_state(PurchaseConfigStates.path)
        await callback.message.answer("🌐 أرسل مسار الشراء، مثال: /api/orders أو رابط HTTPS كامل.")
        await callback.answer()

    @router.message(PurchaseConfigStates.path)
    async def path_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products", "can_manage_sync"):
            await state.clear(); return
        value = str(message.text or "").strip()
        if not value:
            return await message.answer("المسار لا يمكن أن يكون فارغًا.")
        if value.startswith("http://"):
            return await message.answer("استخدم HTTPS فقط.")
        if not value.startswith("/") and not value.startswith("https://"):
            value = "/" + value
        provider_id = int((await state.get_data()).get("purchase_provider_id") or 0)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                "UPDATE client_api_providers SET purchase_path=?,purchase_enabled=0 WHERE id=?",
                (value, provider_id),
            )
            await db.commit()
        await state.clear()
        await message.answer("✅ تم حفظ مسار الشراء. أبقيت الشراء متوقفًا حتى تراجعه وتفعّله.")

    @router.callback_query(F.data.startswith("clipurchase:method:"))
    async def method_menu(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        rows = [[InlineKeyboardButton(text=method, callback_data=f"clipurchase:setmethod:{provider_id}:{method}")] for method in ("POST", "PUT", "PATCH", "GET")]
        rows.append([store.back_btn(f"clipurchase:provider:{provider_id}", "🔙 المزوّد")])
        await _edit(store, callback, "📡 اختر HTTP Method حسب توثيق المزوّد:", rows)
        await callback.answer()

    @router.callback_query(F.data.startswith("clipurchase:setmethod:"))
    async def method_set(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        _, _, provider_id, method = str(callback.data).split(":", 3)
        if method not in {"POST", "PUT", "PATCH", "GET"}:
            return await callback.answer("قيمة غير صالحة.", show_alert=True)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute("UPDATE client_api_providers SET purchase_method=?,purchase_enabled=0 WHERE id=?", (method, int(provider_id)))
            await db.commit()
        await callback.answer("تم الحفظ، وأوقفت الشراء حتى تراجع الإعداد.", show_alert=True)
        await _render_provider(store, callback, int(provider_id))

    @router.callback_query(F.data.startswith("clipurchase:mode:"))
    async def mode_menu(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        labels = (("json", "JSON"), ("form", "Form"), ("query", "Query"))
        rows = [[InlineKeyboardButton(text=label, callback_data=f"clipurchase:setmode:{provider_id}:{value}")] for value, label in labels]
        rows.append([store.back_btn(f"clipurchase:provider:{provider_id}", "🔙 المزوّد")])
        await _edit(store, callback, "📨 كيف يطلب المزوّد بيانات عملية الشراء؟", rows)
        await callback.answer()

    @router.callback_query(F.data.startswith("clipurchase:setmode:"))
    async def mode_set(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        _, _, provider_id, mode = str(callback.data).split(":", 3)
        if mode not in {"json", "form", "query"}:
            return await callback.answer("قيمة غير صالحة.", show_alert=True)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute("UPDATE client_api_providers SET purchase_payload_mode=?,purchase_enabled=0 WHERE id=?", (mode, int(provider_id)))
            await db.commit()
        await callback.answer("تم الحفظ، وأوقفت الشراء حتى تراجع الإعداد.", show_alert=True)
        await _render_provider(store, callback, int(provider_id))

    @router.callback_query(F.data.startswith("clipurchase:key:"))
    async def key_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        _, _, kind, provider_id = str(callback.data).split(":", 3)
        if kind not in {"product", "input", "quantity", "order", "status"}:
            return await callback.answer("نوع الحقل غير معروف.", show_alert=True)
        await state.clear()
        await state.update_data(purchase_provider_id=int(provider_id), purchase_key_kind=kind)
        await state.set_state(_state_for_key(kind))
        note = " أرسل - لجعل الحقل فارغًا." if kind in {"input", "quantity", "status"} else ""
        await callback.message.answer(f"✏️ أرسل اسم الحقل حسب توثيق API.{note}")
        await callback.answer()

    async def save_key(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products", "can_manage_sync"):
            await state.clear(); return
        data = await state.get_data()
        kind = str(data.get("purchase_key_kind") or "")
        if kind not in {"product", "input", "quantity", "order", "status"}:
            await state.clear(); return
        value = str(message.text or "").strip()[:100]
        if value == "-":
            value = ""
        if kind in {"product", "order"} and not value:
            return await message.answer("هذا الحقل لا يمكن أن يكون فارغًا.")
        provider_id = int(data.get("purchase_provider_id") or 0)
        column = _column_for_key(kind)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                f"UPDATE client_api_providers SET {column}=?,purchase_enabled=0 WHERE id=?",
                (value, provider_id),
            )
            await db.commit()
        await state.clear()
        await message.answer("✅ تم حفظ اسم الحقل. أوقفت الشراء حتى تراجع الإعداد وتفعّله مجددًا.")

    router.message.register(save_key, PurchaseConfigStates.product_key)
    router.message.register(save_key, PurchaseConfigStates.input_key)
    router.message.register(save_key, PurchaseConfigStates.quantity_key)
    router.message.register(save_key, PurchaseConfigStates.order_key)
    router.message.register(save_key, PurchaseConfigStates.status_key)

    @router.callback_query(F.data.startswith("clipurchase:statuses:"))
    async def status_values_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        await state.clear()
        await state.update_data(purchase_provider_id=provider_id)
        await state.set_state(PurchaseConfigStates.accepted_values)
        await callback.message.answer(
            "⚙️ أرسل حالات API المقبولة مفصولة بفواصل، مثال:\n"
            "success,ok,pending,processing,completed"
        )
        await callback.answer()

    @router.message(PurchaseConfigStates.accepted_values)
    async def accepted_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products", "can_manage_sync"):
            await state.clear(); return
        values = ",".join(part.strip().lower() for part in str(message.text or "").split(",") if part.strip())[:500]
        if not values:
            return await message.answer("أرسل حالة واحدة على الأقل.")
        await state.update_data(purchase_accepted_values=values)
        await state.set_state(PurchaseConfigStates.completed_values)
        await message.answer("✅ الآن أرسل الحالات التي تعني أن الطلب مكتمل مباشرة، مثال: completed,success,done")

    @router.message(PurchaseConfigStates.completed_values)
    async def completed_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products", "can_manage_sync"):
            await state.clear(); return
        completed = ",".join(part.strip().lower() for part in str(message.text or "").split(",") if part.strip())[:500]
        if not completed:
            return await message.answer("أرسل حالة واحدة على الأقل.")
        data = await state.get_data()
        provider_id = int(data.get("purchase_provider_id") or 0)
        accepted = str(data.get("purchase_accepted_values") or "")
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                """
                UPDATE client_api_providers
                SET accepted_status_values=?,completed_status_values=?,purchase_enabled=0
                WHERE id=?
                """,
                (accepted, completed, provider_id),
            )
            await db.commit()
        await state.clear()
        await message.answer("✅ تم حفظ حالات الاستجابة. راجع الإعداد ثم فعّل الشراء من صفحة المزوّد.")

    store.dp.include_router(router)
    store._client_purchase_admin_installed = True
