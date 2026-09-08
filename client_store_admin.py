from __future__ import annotations

import datetime
import html
import uuid
from typing import Any, Awaitable, Callable

import aiosqlite
from aiogram import F, Router
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from client_services_store import ROOTS, SUBS, RANKS, _money, _short, ensure_schema


class ManualProductStates(StatesGroup):
    name = State()
    price = State()
    delivery = State()


class EditPriceStates(StatesGroup):
    sale_price = State()
    reseller_price = State()
    sort_order = State()


class ResellerSettingsStates(StatesGroup):
    user_id = State()
    discount = State()


class ProviderEditStates(StatesGroup):
    token = State()


async def _allowed(store: Any, user_id: int, *permissions: str) -> bool:
    if not await store.is_admin(user_id):
        return False
    if await store.is_super_admin(user_id):
        return True
    perms = await store.get_admin_perms(user_id)
    return any(bool(perms.get(permission)) for permission in permissions)


async def ensure_admin_schema(store: Any) -> None:
    await ensure_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        for sql in (
            "ALTER TABLE client_provider_products ADD COLUMN source_type TEXT DEFAULT 'api'",
            "ALTER TABLE client_provider_products ADD COLUMN fulfillment_mode TEXT DEFAULT 'adapter'",
            "ALTER TABLE client_provider_products ADD COLUMN delivery_info TEXT DEFAULT ''",
            "ALTER TABLE client_provider_products ADD COLUMN reseller_price REAL DEFAULT 0",
            "ALTER TABLE client_provider_products ADD COLUMN local_product_id INTEGER DEFAULT 0",
        ):
            try:
                await db.execute(sql)
            except Exception:
                pass
        await db.execute("""
            CREATE TABLE IF NOT EXISTS client_store_settings (
                key TEXT PRIMARY KEY,
                value TEXT DEFAULT ''
            )
        """)
        await db.execute(
            "INSERT OR IGNORE INTO client_store_settings(key,value) VALUES('default_reseller_discount','0')"
        )
        await db.execute(
            "INSERT OR IGNORE INTO client_store_settings(key,value) VALUES('store_title','متجر الخدمات')"
        )
        await db.commit()


async def _edit(store: Any, callback: CallbackQuery, text: str, rows: list[list[InlineKeyboardButton]]) -> None:
    markup = InlineKeyboardMarkup(inline_keyboard=rows)
    try:
        await store.safe_edit_message(callback.message, text, markup)
    except Exception:
        try:
            await callback.message.edit_text(text, reply_markup=markup)
        except Exception:
            await callback.message.answer(text, reply_markup=markup)


def _walk_routers(router: Any):
    yield router
    for child in getattr(router, "sub_routers", []):
        yield from _walk_routers(child)


def _replace_named_handler(
    root_router: Any,
    observer_name: str,
    callback_name: str,
    replacement: Callable[..., Awaitable[Any]],
) -> int:
    replaced = 0
    for router in _walk_routers(root_router):
        observer = getattr(router, observer_name, None)
        for handler in getattr(observer, "handlers", []) if observer is not None else []:
            callback = getattr(handler, "callback", None)
            if getattr(callback, "__name__", "") != callback_name:
                continue
            try:
                handler.callback = replacement
            except Exception:
                try:
                    object.__setattr__(handler, "callback", replacement)
                except Exception:
                    continue
            replaced += 1
    return replaced


def _guard_named_handler(
    store: Any,
    observer_name: str,
    callback_name: str,
    *permissions: str,
) -> int:
    target = None
    for router in _walk_routers(store.dp):
        observer = getattr(router, observer_name, None)
        for handler in getattr(observer, "handlers", []) if observer is not None else []:
            callback = getattr(handler, "callback", None)
            if getattr(callback, "__name__", "") == callback_name:
                target = callback
                break
        if target is not None:
            break
    if target is None:
        return 0

    async def guarded(event: Any, *args: Any, **kwargs: Any) -> Any:
        user = getattr(event, "from_user", None)
        user_id = int(getattr(user, "id", 0) or 0)
        if not user_id or not await _allowed(store, user_id, *permissions):
            answer = getattr(event, "answer", None)
            if callable(answer):
                try:
                    await answer("غير مصرح لهذه العملية.", show_alert=True)
                except TypeError:
                    await answer("غير مصرح لهذه العملية.")
            return None
        return await target(event, *args, **kwargs)

    guarded.__name__ = f"guarded_{callback_name}"
    return _replace_named_handler(store.dp, observer_name, callback_name, guarded)


async def _manual_provider_id(store: Any, created_by: int) -> int:
    await ensure_admin_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            "SELECT id FROM client_api_providers WHERE adapter_key='manual' ORDER BY id LIMIT 1"
        ) as cursor:
            row = await cursor.fetchone()
        if row:
            return int(row[0])
        cursor = await db.execute(
            """
            INSERT INTO client_api_providers(
                name,base_url,catalog_path,adapter_key,is_active,created_by,last_sync_status
            ) VALUES('منتجات يدوية','','','manual',1,?,'local')
            """,
            (created_by,),
        )
        await db.commit()
        return int(cursor.lastrowid)


async def _mirror_manual_product(
    store: Any,
    *,
    name: str,
    price: float,
    delivery: str,
) -> int:
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    async with aiosqlite.connect(store.DB_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO products(
                category_id,name,description,price,stock,is_active,created_at,
                product_type,delivery_info,api_id,api_provider
            ) VALUES(NULL,?,?,?,999999,1,?,'manual',?,0,'client_manual')
            """,
            (
                name,
                "خدمة يدوية من متجر العميل",
                float(price),
                now,
                delivery,
            ),
        )
        await db.commit()
        return int(cursor.lastrowid)


async def _effective_price(store: Any, user_id: int, row: tuple[Any, ...]) -> tuple[float, str, float]:
    sale_price = max(float(row[1] or row[2] or 0), 0.0)
    reseller_price = max(float(row[3] or 0), 0.0)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            "SELECT COALESCE(account_rank,'customer'),COALESCE(reseller_discount,0) FROM users WHERE user_id=?",
            (user_id,),
        ) as cursor:
            user = await cursor.fetchone()
        async with db.execute(
            "SELECT value FROM client_store_settings WHERE key='default_reseller_discount'"
        ) as cursor:
            default_row = await cursor.fetchone()
    rank = str(user[0] if user else "customer")
    discount = float(user[1] or 0) if user else 0.0
    if rank != "reseller":
        return sale_price, rank, 0.0
    if reseller_price > 0:
        return reseller_price, rank, discount
    if discount <= 0 and default_row:
        try:
            discount = float(default_row[0] or 0)
        except (TypeError, ValueError):
            discount = 0.0
    discount = min(max(discount, 0.0), 100.0)
    return round(sale_price * (1 - discount / 100), 2), rank, discount


async def _fetch_item(store: Any, item_id: int) -> tuple[Any, ...] | None:
    await ensure_admin_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT p.name,p.sale_price,p.provider_price,COALESCE(p.reseller_price,0),
                   p.root_code,p.sub_code,p.status,p.is_active,
                   COALESCE(p.source_type,'api'),COALESCE(p.fulfillment_mode,'adapter'),
                   COALESCE(p.delivery_info,''),COALESCE(p.local_product_id,0),
                   p.sort_order,pr.name,p.provider_id
            FROM client_provider_products p
            JOIN client_api_providers pr ON pr.id=p.provider_id
            WHERE p.id=?
            """,
            (item_id,),
        ) as cursor:
            return await cursor.fetchone()


async def _render_admin_home(store: Any, callback: CallbackQuery) -> None:
    await ensure_admin_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM client_api_providers WHERE adapter_key<>'manual'"
        ) as cursor:
            providers = int((await cursor.fetchone() or [0])[0] or 0)
        async with db.execute(
            "SELECT COUNT(*) FROM client_provider_products WHERE status='unorganized'"
        ) as cursor:
            pending = int((await cursor.fetchone() or [0])[0] or 0)
        async with db.execute(
            "SELECT COUNT(*) FROM client_provider_products WHERE status='organized'"
        ) as cursor:
            organized = int((await cursor.fetchone() or [0])[0] or 0)
        async with db.execute(
            "SELECT COUNT(*) FROM client_provider_products WHERE COALESCE(source_type,'api')='manual'"
        ) as cursor:
            manual = int((await cursor.fetchone() or [0])[0] or 0)
        async with db.execute(
            "SELECT COUNT(*) FROM users WHERE COALESCE(account_rank,'customer')='reseller'"
        ) as cursor:
            resellers = int((await cursor.fetchone() or [0])[0] or 0)
    text = (
        "🧰 إدارة متجر العميل\n\n"
        f"🔌 مزودو API: {providers}\n"
        f"📥 غير مرتبة: {pending}\n"
        f"✅ مرتبة: {organized}\n"
        f"📝 منتجات يدوية: {manual}\n"
        f"👑 موزعون: {resellers}\n\n"
        "من هنا يدير صاحب البوت الكتالوج والأسعار والرتب بدون تعديل الكود."
    )
    rows = [
        [InlineKeyboardButton(text="➕ منتج يدوي", callback_data="cliadmin:manual:add")],
        [
            InlineKeyboardButton(text="📥 غير مرتبة", callback_data="cli:staged:unorganized"),
            InlineKeyboardButton(text="✅ كل المنتجات", callback_data="cliadmin:items"),
        ],
        [
            InlineKeyboardButton(text="🔌 مزودو API", callback_data="cli:providers"),
            InlineKeyboardButton(text="🔄 مزامنة API", callback_data="clisync:list"),
        ],
        [InlineKeyboardButton(text="👑 إعدادات الموزعين", callback_data="cliadmin:reseller")],
        [store.back_btn("admin_panel", "🔙 لوحة الإدارة")],
    ]
    await _edit(store, callback, text, rows)


async def _render_item_admin(store: Any, callback: CallbackQuery, item_id: int) -> None:
    row = await _fetch_item(store, item_id)
    if not row:
        await callback.answer("المنتج غير موجود.", show_alert=True)
        return
    target = ROOTS.get(str(row[4]), "غير محدد")
    if row[5]:
        target += " ← " + SUBS.get(str(row[4]), {}).get(str(row[5]), str(row[5]))
    text = (
        f"📦 {html.escape(_short(row[0], 90))}\n\n"
        f"💰 سعر البيع: {_money(row[1] or row[2])} $\n"
        f"👑 سعر الموزع: {_money(row[3]) if float(row[3] or 0) > 0 else 'حسب نسبة الخصم'}\n"
        f"💵 تكلفة المزوّد: {_money(row[2])} $\n"
        f"📍 المكان: {html.escape(target)}\n"
        f"🔢 الترتيب: {int(row[12] or 0)}\n"
        f"المصدر: {'📝 يدوي' if str(row[8]) == 'manual' else '🔌 API'}\n"
        f"الحالة: {'🟢 مفعّل' if int(row[7] or 0) else '⚫ متوقف'} / "
        f"{'✅ مرتب' if str(row[6]) == 'organized' else '📥 غير مرتب'}"
    )
    rows = [
        [
            InlineKeyboardButton(text="💰 سعر البيع", callback_data=f"cliadmin:price:{item_id}"),
            InlineKeyboardButton(text="👑 سعر الموزع", callback_data=f"cliadmin:rprice:{item_id}"),
        ],
        [
            InlineKeyboardButton(text="🔢 الترتيب", callback_data=f"cliadmin:sort:{item_id}"),
            InlineKeyboardButton(
                text="⚫ تعطيل" if int(row[7] or 0) else "🟢 تفعيل",
                callback_data=f"cliadmin:toggle:{item_id}",
            ),
        ],
        [InlineKeyboardButton(text="📍 تغيير القسم", callback_data=f"cli:arrange:{item_id}")],
        [InlineKeyboardButton(text="↩️ إعادة إلى غير مرتبة", callback_data=f"cliadmin:unorganize:{item_id}")],
        [store.back_btn("cliadmin:items", "🔙 المنتجات")],
    ]
    await _edit(store, callback, text, rows)


def _admin_panel_wrapper(original: Any):
    def wrapped(perms: dict | None = None, super_admin: bool = False) -> InlineKeyboardMarkup:
        markup = original(perms, super_admin)
        rows = [list(row) for row in markup.inline_keyboard]
        p = perms or {}
        if super_admin or p.get("can_manage_products") or p.get("can_manage_sync"):
            pos = max(len(rows) - 1, 0)
            if not any(
                button.callback_data == "cliadmin:home"
                for row in rows
                for button in row
                if getattr(button, "callback_data", None)
            ):
                rows.insert(pos, [InlineKeyboardButton(text="🧰 إدارة متجر العميل", callback_data="cliadmin:home")])
        return InlineKeyboardMarkup(inline_keyboard=rows)
    return wrapped


def install(store: Any) -> None:
    if getattr(store, "_client_store_admin_installed", False):
        return

    store.admin_panel_kb = _admin_panel_wrapper(store.admin_panel_kb)
    router = Router(name="client_store_admin")

    @router.callback_query(F.data == "cliadmin:home")
    async def admin_home(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        await _render_admin_home(store, callback)
        await callback.answer()

    @router.callback_query(F.data == "cliadmin:items")
    async def items(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        await ensure_admin_schema(store)
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute(
                """
                SELECT id,name,sale_price,provider_price,is_active,source_type,status
                FROM client_provider_products
                ORDER BY status='unorganized' DESC, sort_order, id DESC
                LIMIT 80
                """
            ) as cursor:
                rows_db = await cursor.fetchall()
        rows = [
            [
                InlineKeyboardButton(
                    text=f"{'🟢' if int(item[4] or 0) else '⚫'} "
                         f"{'📝' if str(item[5]) == 'manual' else '🔌'} "
                         f"{_short(item[1], 21)} • {_money(item[2] or item[3])}$",
                    callback_data=f"cliadmin:item:{int(item[0])}",
                )
            ]
            for item in rows_db
        ]
        if not rows:
            rows.append([InlineKeyboardButton(text="لا توجد منتجات بعد", callback_data="cli:noop")])
        rows.append([store.back_btn("cliadmin:home", "🔙 إدارة المتجر")])
        await _edit(store, callback, "✅ إدارة المنتجات\n\nاختر منتجًا لتعديل السعر والترتيب والتفعيل.", rows)
        await callback.answer()

    @router.callback_query(F.data.startswith("cliadmin:item:"))
    async def item_detail(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products", "can_manage_sync"):
            return await callback.answer("غير مصرح.", show_alert=True)
        item_id = int(str(callback.data).rsplit(":", 1)[1])
        await _render_item_admin(store, callback, item_id)
        await callback.answer()

    @router.callback_query(F.data == "cliadmin:manual:add")
    async def manual_add(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products"):
            return await callback.answer("غير مصرح.", show_alert=True)
        await state.clear()
        await state.set_state(ManualProductStates.name)
        await callback.message.answer("📝 أرسل اسم المنتج اليدوي.")
        await callback.answer()

    @router.message(ManualProductStates.name)
    async def manual_name(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products"):
            await state.clear()
            return
        name = _short(message.text, 160)
        if len(name) < 2:
            return await message.answer("اكتب اسمًا أوضح للمنتج.")
        await state.update_data(manual_name=name)
        await state.set_state(ManualProductStates.price)
        await message.answer("💰 أرسل سعر البيع بالدولار، مثال: 12.5")

    @router.message(ManualProductStates.price)
    async def manual_price(message: Message, state: Any) -> None:
        try:
            price = float(str(message.text or "").replace(",", ".").strip())
            if price <= 0:
                raise ValueError
        except ValueError:
            return await message.answer("أرسل سعرًا رقميًا أكبر من صفر.")
        await state.update_data(manual_price=round(price, 2))
        await state.set_state(ManualProductStates.delivery)
        await message.answer(
            "📦 أرسل تعليمات/وقت التسليم التي ستظهر في الطلب، مثال:\n"
            "يتم تجهيز الطلب يدويًا خلال 30 دقيقة."
        )

    @router.message(ManualProductStates.delivery)
    async def manual_delivery(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products"):
            await state.clear()
            return
        delivery = str(message.text or "").strip()[:1200]
        data = await state.get_data()
        provider_id = await _manual_provider_id(store, message.from_user.id)
        local_product_id = await _mirror_manual_product(
            store,
            name=str(data.get("manual_name") or "منتج يدوي"),
            price=float(data.get("manual_price") or 0),
            delivery=delivery,
        )
        external_id = f"manual-{uuid.uuid4().hex}"
        async with aiosqlite.connect(store.DB_PATH) as db:
            cursor = await db.execute(
                """
                INSERT INTO client_provider_products(
                    provider_id,external_id,name,provider_price,sale_price,status,
                    source_type,fulfillment_mode,delivery_info,local_product_id,is_active
                ) VALUES(?,?,?,?,?,'unorganized','manual','manual',?,?,1)
                """,
                (
                    provider_id,
                    external_id,
                    str(data.get("manual_name") or "منتج يدوي"),
                    float(data.get("manual_price") or 0),
                    float(data.get("manual_price") or 0),
                    delivery,
                    local_product_id,
                ),
            )
            await db.commit()
            item_id = int(cursor.lastrowid)
        await state.clear()
        await message.answer(
            "✅ تم إنشاء المنتج اليدوي.\n"
            "انتقل الآن إلى «📥 غير مرتبة» وحدد iOS/Android/Diamond FF والقسم المناسب.",
            reply_markup=InlineKeyboardMarkup(
                inline_keyboard=[[
                    InlineKeyboardButton(text="📍 ترتيب المنتج الآن", callback_data=f"cli:arrange:{item_id}")
                ]]
            ),
        )

    @router.callback_query(F.data.startswith("cliadmin:price:"))
    async def price_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products"):
            return await callback.answer("غير مصرح.", show_alert=True)
        item_id = int(str(callback.data).rsplit(":", 1)[1])
        await state.clear()
        await state.update_data(edit_item_id=item_id)
        await state.set_state(EditPriceStates.sale_price)
        await callback.message.answer("💰 أرسل سعر البيع الجديد.")
        await callback.answer()

    @router.message(EditPriceStates.sale_price)
    async def price_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products"):
            await state.clear()
            return
        try:
            price = float(str(message.text or "").replace(",", ".").strip())
            if price <= 0:
                raise ValueError
        except ValueError:
            return await message.answer("أرسل سعرًا رقميًا أكبر من صفر.")
        item_id = int((await state.get_data()).get("edit_item_id") or 0)
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute(
                "SELECT COALESCE(local_product_id,0) FROM client_provider_products WHERE id=?",
                (item_id,),
            ) as cursor:
                row = await cursor.fetchone()
            await db.execute(
                "UPDATE client_provider_products SET sale_price=? WHERE id=?",
                (round(price, 2), item_id),
            )
            local_product_id = int(row[0] or 0) if row else 0
            if local_product_id:
                await db.execute(
                    "UPDATE products SET price=? WHERE id=?",
                    (round(price, 2), local_product_id),
                )
            await db.commit()
        await state.clear()
        await message.answer("✅ تم تحديث سعر البيع.")

    @router.callback_query(F.data.startswith("cliadmin:rprice:"))
    async def reseller_price_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products"):
            return await callback.answer("غير مصرح.", show_alert=True)
        item_id = int(str(callback.data).rsplit(":", 1)[1])
        await state.clear()
        await state.update_data(edit_item_id=item_id)
        await state.set_state(EditPriceStates.reseller_price)
        await callback.message.answer("👑 أرسل سعر الموزع. أرسل 0 لاستخدام نسبة الخصم بدل سعر ثابت.")
        await callback.answer()

    @router.message(EditPriceStates.reseller_price)
    async def reseller_price_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products"):
            await state.clear()
            return
        try:
            price = float(str(message.text or "").replace(",", ".").strip())
            if price < 0:
                raise ValueError
        except ValueError:
            return await message.answer("أرسل رقمًا صفر أو أكبر.")
        item_id = int((await state.get_data()).get("edit_item_id") or 0)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                "UPDATE client_provider_products SET reseller_price=? WHERE id=?",
                (round(price, 2), item_id),
            )
            await db.commit()
        await state.clear()
        await message.answer("✅ تم تحديث سعر الموزع.")

    @router.callback_query(F.data.startswith("cliadmin:sort:"))
    async def sort_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products"):
            return await callback.answer("غير مصرح.", show_alert=True)
        item_id = int(str(callback.data).rsplit(":", 1)[1])
        await state.clear()
        await state.update_data(edit_item_id=item_id)
        await state.set_state(EditPriceStates.sort_order)
        await callback.message.answer("🔢 أرسل رقم الترتيب. الأصغر يظهر أولًا.")
        await callback.answer()

    @router.message(EditPriceStates.sort_order)
    async def sort_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_products"):
            await state.clear()
            return
        raw = str(message.text or "").strip()
        try:
            order = int(raw)
        except ValueError:
            return await message.answer("أرسل رقمًا صحيحًا.")
        order = max(min(order, 999999), -999999)
        item_id = int((await state.get_data()).get("edit_item_id") or 0)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                "UPDATE client_provider_products SET sort_order=? WHERE id=?",
                (order, item_id),
            )
            await db.commit()
        await state.clear()
        await message.answer("✅ تم تحديث الترتيب.")

    @router.callback_query(F.data.startswith("cliadmin:toggle:"))
    async def toggle(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products"):
            return await callback.answer("غير مصرح.", show_alert=True)
        item_id = int(str(callback.data).rsplit(":", 1)[1])
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute(
                "SELECT is_active,COALESCE(local_product_id,0) FROM client_provider_products WHERE id=?",
                (item_id,),
            ) as cursor:
                row = await cursor.fetchone()
            if not row:
                return await callback.answer("المنتج غير موجود.", show_alert=True)
            new_value = 0 if int(row[0] or 0) else 1
            await db.execute("UPDATE client_provider_products SET is_active=? WHERE id=?", (new_value, item_id))
            if int(row[1] or 0):
                await db.execute("UPDATE products SET is_active=? WHERE id=?", (new_value, int(row[1])))
            await db.commit()
        await callback.answer("تم تحديث حالة المنتج.", show_alert=True)
        await _render_item_admin(store, callback, item_id)

    @router.callback_query(F.data.startswith("cliadmin:unorganize:"))
    async def unorganize(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_products"):
            return await callback.answer("غير مصرح.", show_alert=True)
        item_id = int(str(callback.data).rsplit(":", 1)[1])
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                "UPDATE client_provider_products SET status='unorganized',organized_at='' WHERE id=?",
                (item_id,),
            )
            await db.commit()
        await callback.answer("↩️ أعيد المنتج إلى «غير مرتبة».", show_alert=True)

    @router.callback_query(F.data == "cliadmin:reseller")
    async def reseller(callback: CallbackQuery) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_users"):
            return await callback.answer("غير مصرح.", show_alert=True)
        await ensure_admin_schema(store)
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute(
                "SELECT value FROM client_store_settings WHERE key='default_reseller_discount'"
            ) as cursor:
                row = await cursor.fetchone()
            async with db.execute(
                "SELECT COUNT(*) FROM users WHERE COALESCE(account_rank,'customer')='reseller'"
            ) as cursor:
                count = int((await cursor.fetchone() or [0])[0] or 0)
        discount = float(row[0] or 0) if row else 0.0
        rows = [
            [InlineKeyboardButton(text="🎯 تعديل الخصم الافتراضي", callback_data="cliadmin:reseller:default")],
            [InlineKeyboardButton(text="👤 خصم موزع محدد", callback_data="cliadmin:reseller:user")],
            [InlineKeyboardButton(text="⭐👑 تغيير رتبة حساب", callback_data="cli:rank")],
            [store.back_btn("cliadmin:home", "🔙 إدارة المتجر")],
        ]
        await _edit(
            store,
            callback,
            f"👑 إعدادات الموزعين\n\nعدد الموزعين: {count}\nالخصم الافتراضي: {_money(discount)}%\n"
            "يمكن أيضًا وضع سعر موزع ثابت لكل منتج.",
            rows,
        )
        await callback.answer()

    @router.callback_query(F.data == "cliadmin:reseller:default")
    async def reseller_default_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_users"):
            return await callback.answer("غير مصرح.", show_alert=True)
        await state.clear()
        await state.update_data(reseller_uid=0)
        await state.set_state(ResellerSettingsStates.discount)
        await callback.message.answer("🎯 أرسل الخصم الافتراضي للموزعين من 0 إلى 100.")
        await callback.answer()

    @router.callback_query(F.data == "cliadmin:reseller:user")
    async def reseller_user_start(callback: CallbackQuery, state: Any) -> None:
        if not await _allowed(store, callback.from_user.id, "can_manage_users"):
            return await callback.answer("غير مصرح.", show_alert=True)
        await state.clear()
        await state.set_state(ResellerSettingsStates.user_id)
        await callback.message.answer("👤 أرسل Telegram User ID للموزع.")
        await callback.answer()

    @router.message(ResellerSettingsStates.user_id)
    async def reseller_user_id(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_users"):
            await state.clear()
            return
        raw = str(message.text or "").strip()
        if not raw.isdigit():
            return await message.answer("أرسل User ID رقميًا.")
        await state.update_data(reseller_uid=int(raw))
        await state.set_state(ResellerSettingsStates.discount)
        await message.answer("🎯 أرسل خصم هذا الموزع من 0 إلى 100.")

    @router.message(ResellerSettingsStates.discount)
    async def reseller_discount_save(message: Message, state: Any) -> None:
        if not await _allowed(store, message.from_user.id, "can_manage_users"):
            await state.clear()
            return
        try:
            discount = float(str(message.text or "").replace(",", ".").strip())
            if discount < 0 or discount > 100:
                raise ValueError
        except ValueError:
            return await message.answer("أرسل نسبة بين 0 و100.")
        data = await state.get_data()
        uid = int(data.get("reseller_uid") or 0)
        await ensure_admin_schema(store)
        async with aiosqlite.connect(store.DB_PATH) as db:
            if uid:
                async with db.execute("SELECT 1 FROM users WHERE user_id=?", (uid,)) as cursor:
                    exists = await cursor.fetchone()
                if not exists:
                    await state.clear()
                    return await message.answer("المستخدم غير موجود في البوت بعد.")
                await db.execute(
                    "UPDATE users SET account_rank='reseller',reseller_discount=? WHERE user_id=?",
                    (round(discount, 2), uid),
                )
            else:
                await db.execute(
                    """
                    INSERT INTO client_store_settings(key,value) VALUES('default_reseller_discount',?)
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value
                    """,
                    (str(round(discount, 2)),),
                )
            await db.commit()
        await state.clear()
        await message.answer("✅ تم حفظ إعدادات خصم الموزعين.")

    store.dp.include_router(router)

    for name in ("providers", "provider", "provider_add", "staged", "arrange", "pick_sub", "set_place", "organized"):
        _guard_named_handler(store, "callback_query", name, "can_manage_products", "can_manage_sync")
    _guard_named_handler(store, "callback_query", "rank", "can_manage_users")
    for name in ("sync_list", "sync_run"):
        _guard_named_handler(store, "callback_query", name, "can_manage_products", "can_manage_sync")

    async def product(callback: CallbackQuery) -> None:
        item_id = int(str(callback.data).rsplit(":", 1)[1])
        row = await _fetch_item(store, item_id)
        if not row or str(row[6]) != "organized" or not int(row[7] or 0):
            return await callback.answer("المنتج غير متاح.", show_alert=True)
        price, rank, discount = await _effective_price(store, callback.from_user.id, row)
        back = f"cli:sub:{row[4]}:{row[5]}" if row[5] else f"cli:root:{row[4]}"
        source = "📝 تجهيز يدوي" if str(row[8]) == "manual" else f"🔌 {html.escape(_short(row[13], 50))}"
        rank_line = ""
        if rank == "reseller":
            rank_line = f"\n👑 سعر الموزع مطبّق" + (f" ({_money(discount)}%)" if discount > 0 and float(row[3] or 0) <= 0 else "")
        text = (
            f"🛍 {html.escape(_short(row[0], 90))}\n\n"
            f"💰 السعر: {_money(price)} ${rank_line}\n"
            f"📦 التنفيذ: {source}"
        )
        if row[10]:
            text += f"\n🕒 {html.escape(_short(row[10], 300))}"
        rows = [
            [InlineKeyboardButton(text=f"🛒 طلب المنتج — {_money(price)} $", callback_data=f"cli:buy:{item_id}")],
            [store.back_btn(back, "🔙 رجوع")],
        ]
        await _edit(store, callback, text, rows)
        await callback.answer()

    async def buy(callback: CallbackQuery) -> None:
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
        rows = [
            [InlineKeyboardButton(text=f"✅ تأكيد وخصم {_money(price)} $", callback_data=f"cli:confirm:{item_id}")],
            [InlineKeyboardButton(text="❌ إلغاء", callback_data=f"cli:product:{item_id}")],
        ]
        await _edit(
            store,
            callback,
            f"🧾 تأكيد الطلب\n\n📦 {html.escape(_short(row[0], 90))}\n💰 المبلغ: {_money(price)} $\n\n"
            "لن يتم الخصم إلا بعد الضغط على التأكيد.",
            rows,
        )
        await callback.answer()

    _replace_named_handler(store.dp, "callback_query", "product", product)
    _replace_named_handler(store.dp, "callback_query", "buy", buy)

    @router.callback_query(F.data.startswith("cli:confirm:"))
    async def confirm_manual(callback: CallbackQuery) -> None:
        item_id = int(str(callback.data).rsplit(":", 1)[1])
        if await store.is_banned(callback.from_user.id):
            return await callback.answer("🚫 أنت محظور.", show_alert=True)
        row = await _fetch_item(store, item_id)
        if not row or str(row[9]) != "manual" or str(row[6]) != "organized" or not int(row[7] or 0):
            return await callback.answer("المنتج غير متاح للشراء.", show_alert=True)
        price, _, _ = await _effective_price(store, callback.from_user.id, row)
        user_id = callback.from_user.id
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        purchase_token = f"client-manual-{user_id}-{uuid.uuid4().hex}"
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute("BEGIN IMMEDIATE")
            try:
                async with db.execute(
                    "SELECT balance FROM users WHERE user_id=?",
                    (user_id,),
                ) as cursor:
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
                await db.execute(
                    "UPDATE users SET balance=balance-? WHERE user_id=?",
                    (price, user_id),
                )
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
                        f"Client catalog item #{item_id}",
                        str(row[10] or ""),
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
        rows = [
            [InlineKeyboardButton(text="📦 طلباتي", callback_data="my_orders")],
            [store.back_btn("main_menu", "🏠 الرئيسية")],
        ]
        await _edit(
            store,
            callback,
            f"✅ تم إنشاء الطلب #{order_id}\n\n"
            f"📦 {html.escape(_short(row[0], 90))}\n"
            f"💰 تم خصم: {_money(price)} $\n"
            f"🕒 {html.escape(str(row[10] or 'سيتم تجهيز الطلب يدويًا من الإدارة.'))}",
            rows,
        )
        try:
            admin_id = int(getattr(store, "ADMIN_ID", 0) or 0)
            if admin_id:
                await store.bot.send_message(
                    admin_id,
                    f"🆕 طلب يدوي جديد #{order_id}\n"
                    f"👤 المستخدم: {user_id}\n"
                    f"📦 {row[0]}\n"
                    f"💰 {_money(price)} $",
                )
        except Exception:
            pass
        await callback.answer("تم الطلب بنجاح.", show_alert=True)

    store._client_store_admin_installed = True
