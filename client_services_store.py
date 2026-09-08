from __future__ import annotations

import hashlib
import html
import os
from pathlib import Path
from typing import Any

import aiosqlite
from aiogram import F, Router
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from cryptography.fernet import Fernet

ROOTS = {
    "ios": "📱 منتجات iOS",
    "android": "🤖 منتجات Android",
    "diamond_ff": "💎 Diamond FF",
}
SUBS = {
    "ios": {
        "certificates": "📜 الشهادات",
        "files": "📂 الملفات",
        "proxy": "🌐 البروكسي",
        "panels": "🖥️ البنلات",
    },
    "android": {
        "panels": "🖥️ البنلات",
        "files": "📂 الملفات",
        "proxy": "🌐 البروكسي",
    },
}
RANKS = {"customer": "⭐ عميل", "reseller": "👑 موزع"}


class ProviderStates(StatesGroup):
    name = State()
    base_url = State()
    token = State()
    catalog_path = State()


class RankStates(StatesGroup):
    user_id = State()
    rank = State()


def _short(value: Any, limit: int = 28) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _money(value: Any) -> str:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        number = 0.0
    return f"{number:.2f}".rstrip("0").rstrip(".") or "0"


def _key_path(store: Any) -> Path:
    custom = os.getenv("CLIENT_STORE_MASTER_KEY_FILE", "").strip()
    if custom:
        return Path(custom).expanduser()
    db = Path(str(store.DB_PATH)).expanduser()
    return db.with_name(db.name + ".client.key")


def _encrypt(store: Any, value: str) -> tuple[str, str]:
    env_key = os.getenv("CLIENT_STORE_MASTER_KEY", "").strip()
    if env_key:
        fernet = Fernet(env_key.encode("ascii"))
    else:
        path = _key_path(store)
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.write_bytes(Fernet.generate_key() + b"\n")
            try:
                path.chmod(0o600)
            except OSError:
                pass
        fernet = Fernet(path.read_bytes().strip())
    raw = value.strip()
    return (
        fernet.encrypt(raw.encode("utf-8")).decode("ascii"),
        hashlib.sha256(raw.encode("utf-8")).hexdigest()[:10],
    )


async def ensure_schema(store: Any) -> None:
    async with aiosqlite.connect(store.DB_PATH) as db:
        for sql in (
            "ALTER TABLE users ADD COLUMN account_rank TEXT DEFAULT 'customer'",
            "ALTER TABLE users ADD COLUMN reseller_discount REAL DEFAULT 0",
        ):
            try:
                await db.execute(sql)
            except Exception:
                pass
        await db.execute("""
            CREATE TABLE IF NOT EXISTS client_api_providers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                base_url TEXT DEFAULT '',
                catalog_path TEXT DEFAULT '',
                token_cipher TEXT DEFAULT '',
                token_fingerprint TEXT DEFAULT '',
                adapter_key TEXT DEFAULT 'custom_json',
                is_active INTEGER DEFAULT 1,
                created_by INTEGER DEFAULT 0,
                last_sync_at TEXT DEFAULT '',
                last_sync_status TEXT DEFAULT 'never',
                last_error TEXT DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS client_provider_products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider_id INTEGER NOT NULL,
                external_id TEXT NOT NULL,
                name TEXT NOT NULL,
                provider_price REAL DEFAULT 0,
                sale_price REAL DEFAULT 0,
                root_code TEXT DEFAULT '',
                sub_code TEXT DEFAULT '',
                status TEXT DEFAULT 'unorganized',
                sort_order INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                raw_json TEXT DEFAULT '{}',
                imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
                organized_at TEXT DEFAULT '',
                UNIQUE(provider_id, external_id),
                FOREIGN KEY(provider_id) REFERENCES client_api_providers(id)
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_client_products_status "
            "ON client_provider_products(status, provider_id, sort_order)"
        )
        await db.commit()


async def _edit(store: Any, callback: CallbackQuery, text: str, rows: list[list[InlineKeyboardButton]]) -> None:
    kb = InlineKeyboardMarkup(inline_keyboard=rows)
    try:
        await store.safe_edit_message(callback.message, text, kb)
    except Exception:
        try:
            await callback.message.edit_text(text, reply_markup=kb)
        except Exception:
            await callback.message.answer(text, reply_markup=kb)


def client_main_menu(store: Any, is_admin_user: bool = False) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text="📱 منتجات iOS", callback_data="cli:root:ios")],
        [InlineKeyboardButton(text="🤖 منتجات Android", callback_data="cli:root:android")],
        [
            InlineKeyboardButton(text="💎 Diamond FF", callback_data="cli:root:diamond_ff"),
            InlineKeyboardButton(text="💳 شحن رصيد", callback_data="deposit_request"),
        ],
        [InlineKeyboardButton(text="👤 حسابي", callback_data="cli:account")],
        [
            InlineKeyboardButton(text="📦 طلباتي", callback_data="my_orders"),
            InlineKeyboardButton(text="📞 الدعم", callback_data="support"),
        ],
    ]
    if is_admin_user:
        rows.append([InlineKeyboardButton(text="⚙️ لوحة الإدارة", callback_data="admin_panel")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def _admin_panel_wrapper(original: Any):
    def wrapped(perms: dict | None = None, super_admin: bool = False) -> InlineKeyboardMarkup:
        markup = original(perms, super_admin)
        rows = [list(row) for row in markup.inline_keyboard]
        p = perms or {}
        if super_admin or p.get("can_manage_products") or p.get("can_manage_sync"):
            pos = max(len(rows) - 1, 0)
            rows[pos:pos] = [
                [InlineKeyboardButton(text="🔌 مزودو API", callback_data="cli:providers")],
                [
                    InlineKeyboardButton(text="📥 غير مرتبة", callback_data="cli:staged:unorganized"),
                    InlineKeyboardButton(text="✅ تم ترتيبها", callback_data="cli:staged:organized"),
                ],
            ]
        if super_admin or p.get("can_manage_users"):
            pos = max(len(rows) - 1, 0)
            rows.insert(pos, [InlineKeyboardButton(text="⭐👑 رتب الحسابات", callback_data="cli:rank")])
        return InlineKeyboardMarkup(inline_keyboard=rows)
    return wrapped


async def _render_products(store: Any, callback: CallbackQuery, root: str, sub: str, back: str) -> None:
    await ensure_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute("""
            SELECT p.id,p.name,p.sale_price,p.provider_price
            FROM client_provider_products p
            JOIN client_api_providers pr ON pr.id=p.provider_id
            WHERE p.status='organized' AND p.is_active=1 AND pr.is_active=1
              AND p.root_code=? AND p.sub_code=?
            ORDER BY p.sort_order,p.name COLLATE NOCASE LIMIT 60
        """, (root, sub)) as cur:
            products = await cur.fetchall()
    rows = [[InlineKeyboardButton(
        text=f"{_short(p[1], 24)} — {_money(p[2] or p[3])} $",
        callback_data=f"cli:product:{int(p[0])}",
    )] for p in products]
    if not rows:
        rows.append([InlineKeyboardButton(text="لا توجد منتجات مضافة بعد", callback_data="cli:noop")])
    rows.append([store.back_btn(back, "🔙 رجوع")])
    label = SUBS.get(root, {}).get(sub, ROOTS.get(root, "📦 المنتجات"))
    await _edit(store, callback, f"{label}\n\n" + ("اختر المنتج:" if products else "سيظهر هنا كل منتج يرتبه صاحب البوت لهذا القسم."), rows)


async def _render_staged(store: Any, callback: CallbackQuery, status: str) -> None:
    await ensure_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute("""
            SELECT p.id,p.name,p.sale_price,p.provider_price,pr.name
            FROM client_provider_products p
            JOIN client_api_providers pr ON pr.id=p.provider_id
            WHERE p.status=? ORDER BY p.id DESC LIMIT 60
        """, (status,)) as cur:
            products = await cur.fetchall()
    rows = [[InlineKeyboardButton(
        text=f"{_short(p[1], 22)} • {_money(p[2] or p[3])} $",
        callback_data=f"cli:arrange:{int(p[0])}",
    )] for p in products]
    if not rows:
        rows.append([InlineKeyboardButton(text="لا توجد منتجات هنا", callback_data="cli:noop")])
    rows.append([store.back_btn("admin_panel", "🔙 لوحة الإدارة")])
    label = "✅ تم ترتيبها" if status == "organized" else "📥 غير مرتبة"
    await _edit(store, callback, f"{label}\n\n" + ("كل منتج هنا أصبح في مكانه داخل المتجر." if status == "organized" else "افتح المنتج وحدد القسم الذي سيظهر فيه ثم اعتمد الترتيب."), rows)


def install(store: Any) -> None:
    if getattr(store, "_client_services_store_installed", False):
        return

    original_init_db = store.init_db
    async def init_db() -> None:
        await original_init_db()
        await ensure_schema(store)
    store.init_db = init_db
    store.main_menu_kb = lambda is_admin_user=False: client_main_menu(store, is_admin_user)
    store.admin_panel_kb = _admin_panel_wrapper(store.admin_panel_kb)

    router = Router(name="client_services_store")

    @router.callback_query(F.data == "cli:noop")
    async def noop(callback: CallbackQuery) -> None:
        await callback.answer()

    @router.callback_query(F.data.startswith("cli:root:"))
    async def root(callback: CallbackQuery) -> None:
        root_code = str(callback.data).split(":", 2)[2]
        if root_code in SUBS:
            rows = [[InlineKeyboardButton(text=label, callback_data=f"cli:sub:{root_code}:{code}")] for code, label in SUBS[root_code].items()]
            rows.append([store.back_btn("main_menu", "🏠 الرئيسية")])
            await _edit(store, callback, f"{ROOTS[root_code]}\n\nاختر القسم:", rows)
        else:
            await _render_products(store, callback, root_code, "", "main_menu")
        await callback.answer()

    @router.callback_query(F.data.startswith("cli:sub:"))
    async def sub(callback: CallbackQuery) -> None:
        _, _, root_code, sub_code = str(callback.data).split(":", 3)
        await _render_products(store, callback, root_code, sub_code, f"cli:root:{root_code}")
        await callback.answer()

    @router.callback_query(F.data == "cli:account")
    async def account(callback: CallbackQuery) -> None:
        await ensure_schema(store)
        uid = callback.from_user.id
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute("""
                SELECT username,full_name,balance,joined_date,
                       COALESCE(store_user_id,''),COALESCE(account_rank,'customer'),
                       COALESCE(reseller_discount,0)
                FROM users WHERE user_id=?
            """, (uid,)) as cur:
                row = await cur.fetchone()
            async with db.execute("SELECT COUNT(*) FROM orders WHERE user_id=?", (uid,)) as cur:
                order_count = int((await cur.fetchone() or [0])[0] or 0)
        if not row:
            await store.create_or_update_user(uid, callback.from_user.username, callback.from_user.full_name)
            return await account(callback)
        rank = str(row[5] or "customer")
        discount = float(row[6] or 0)
        text = (
            "👤 حسابي\n\n"
            f"الاسم: {html.escape(str(row[1] or callback.from_user.full_name or '—'))}\n"
            f"المعرف: @{html.escape(str(row[0] or 'بدون معرف'))}\n"
            f"🆔 رقم الحساب: {html.escape(str(row[4] or uid))}\n"
            f"الرتبة: {RANKS.get(rank, RANKS['customer'])}\n"
            + (f"🎯 خصم الموزع: {_money(discount)}%\n" if rank == "reseller" and discount > 0 else "")
            + f"💵 الرصيد: {_money(row[2])} $\n📦 الطلبات: {order_count}\n📅 الانضمام: {html.escape(str(row[3] or '—'))}"
        )
        await _edit(store, callback, text, [
            [InlineKeyboardButton(text="💳 شحن الرصيد", callback_data="deposit_request")],
            [InlineKeyboardButton(text="📦 طلباتي", callback_data="my_orders")],
            [store.back_btn("main_menu", "🏠 الرئيسية")],
        ])
        await callback.answer()

    @router.callback_query(F.data.startswith("cli:product:"))
    async def product(callback: CallbackQuery) -> None:
        product_id = int(str(callback.data).rsplit(":", 1)[1])
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute("""
                SELECT p.name,p.sale_price,p.provider_price,p.root_code,p.sub_code,pr.name
                FROM client_provider_products p JOIN client_api_providers pr ON pr.id=p.provider_id
                WHERE p.id=? AND p.status='organized' AND p.is_active=1
            """, (product_id,)) as cur:
                row = await cur.fetchone()
        if not row:
            return await callback.answer("المنتج غير متاح.", show_alert=True)
        price = float(row[1] or row[2] or 0)
        back = f"cli:sub:{row[3]}:{row[4]}" if row[4] else f"cli:root:{row[3]}"
        await _edit(store, callback, f"🛍 {_short(row[0], 90)}\n\n💰 السعر: {_money(price)} $\n🔌 المزوّد: {_short(row[5], 50)}", [
            [InlineKeyboardButton(text=f"🛒 طلب المنتج — {_money(price)} $", callback_data=f"cli:buy:{product_id}")],
            [store.back_btn(back, "🔙 رجوع")],
        ])
        await callback.answer()

    @router.callback_query(F.data.startswith("cli:buy:"))
    async def buy(callback: CallbackQuery) -> None:
        await callback.answer("المنتج مرتب وجاهز. تنفيذ الشراء يتفعل عند تركيب Adapter الخاص بمزوّد الـAPI.", show_alert=True)

    @router.callback_query(F.data == "cli:providers")
    async def providers(callback: CallbackQuery) -> None:
        if not await store.is_admin(callback.from_user.id):
            return await callback.answer("غير مصرح.", show_alert=True)
        await ensure_schema(store)
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute("SELECT id,name,is_active,token_fingerprint FROM client_api_providers ORDER BY id DESC") as cur:
                items = await cur.fetchall()
        rows = [[InlineKeyboardButton(text=f"{'🟢' if int(p[2] or 0) else '⚫'} {_short(p[1])}", callback_data=f"cli:provider:{int(p[0])}")] for p in items]
        rows += [[InlineKeyboardButton(text="➕ إضافة مزوّد API", callback_data="cli:provider_add")], [store.back_btn("admin_panel", "🔙 لوحة الإدارة")]]
        await _edit(store, callback, "🔌 مزودو API\n\nالتوكنات يدخلها صاحب البوت هنا وتُحفظ مشفّرة، ولا تظهر كاملة بعد الحفظ.", rows)
        await callback.answer()

    @router.callback_query(F.data.startswith("cli:provider:"))
    async def provider(callback: CallbackQuery) -> None:
        if not await store.is_admin(callback.from_user.id):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute("SELECT name,base_url,catalog_path,token_fingerprint,is_active,last_sync_status,last_sync_at FROM client_api_providers WHERE id=?", (provider_id,)) as cur:
                row = await cur.fetchone()
        if not row:
            return await callback.answer("المزوّد غير موجود.", show_alert=True)
        token = f"محفوظ •••• {str(row[3])[-6:]}" if row[3] else "غير مضاف"
        await _edit(store, callback, f"🔌 {html.escape(str(row[0]))}\n\nالحالة: {'🟢 مفعّل' if int(row[4] or 0) else '⚫ متوقف'}\nBase URL: {html.escape(str(row[1] or '—'))}\nCatalog: {html.escape(str(row[2] or '—'))}\nToken: {token}\nآخر مزامنة: {html.escape(str(row[6] or 'لم تتم'))}\nالنتيجة: {html.escape(str(row[5] or 'never'))}", [[store.back_btn("cli:providers", "🔙 المزودون")]])
        await callback.answer()

    @router.callback_query(F.data == "cli:provider_add")
    async def provider_add(callback: CallbackQuery, state: Any) -> None:
        if not await store.is_admin(callback.from_user.id):
            return await callback.answer("غير مصرح.", show_alert=True)
        await state.clear(); await state.set_state(ProviderStates.name)
        await callback.message.answer("🔌 أرسل اسم مزوّد الـAPI.")
        await callback.answer()

    @router.message(ProviderStates.name)
    async def provider_name(message: Message, state: Any) -> None:
        await state.update_data(provider_name=_short(message.text, 80)); await state.set_state(ProviderStates.base_url)
        await message.answer("🌐 أرسل Base URL، مثال: https://api.example.com")

    @router.message(ProviderStates.base_url)
    async def provider_url(message: Message, state: Any) -> None:
        url = str(message.text or "").strip().rstrip("/")
        if not (url.startswith("https://") or url.startswith("http://")):
            return await message.answer("أرسل رابطًا يبدأ بـ https:// أو http://")
        await state.update_data(provider_url=url); await state.set_state(ProviderStates.token)
        await message.answer("🔑 أرسل API Token / Key. سيُحفظ مشفّرًا ولن أعرضه كاملًا بعد الحفظ.")

    @router.message(ProviderStates.token)
    async def provider_token(message: Message, state: Any) -> None:
        token = str(message.text or "").strip()
        if len(token) < 4:
            return await message.answer("التوكن قصير جدًا.")
        cipher, fingerprint = _encrypt(store, token)
        await state.update_data(token_cipher=cipher, token_fingerprint=fingerprint); await state.set_state(ProviderStates.catalog_path)
        try:
            await message.delete()
        except Exception:
            pass
        await message.answer("📦 أرسل مسار الكتالوج، مثال: /products أو /api/catalog")

    @router.message(ProviderStates.catalog_path)
    async def provider_path(message: Message, state: Any) -> None:
        path = str(message.text or "").strip()
        if path and not path.startswith("/") and not path.startswith("http"):
            path = "/" + path
        data = await state.get_data(); await ensure_schema(store)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute("INSERT INTO client_api_providers(name,base_url,catalog_path,token_cipher,token_fingerprint,created_by) VALUES(?,?,?,?,?,?)", (data.get("provider_name","Provider"), data.get("provider_url",""), path, data.get("token_cipher",""), data.get("token_fingerprint",""), message.from_user.id))
            await db.commit()
        await state.clear()
        await message.answer("✅ تم حفظ المزوّد والتوكن المشفّر. بعد تركيب Adapter الخاص به ستدخل منتجاته إلى «📥 غير مرتبة».")

    @router.callback_query(F.data.startswith("cli:staged:"))
    async def staged(callback: CallbackQuery) -> None:
        if not await store.is_admin(callback.from_user.id):
            return await callback.answer("غير مصرح.", show_alert=True)
        await _render_staged(store, callback, str(callback.data).rsplit(":", 1)[1])
        await callback.answer()

    @router.callback_query(F.data.startswith("cli:arrange:"))
    async def arrange(callback: CallbackQuery) -> None:
        if not await store.is_admin(callback.from_user.id):
            return await callback.answer("غير مصرح.", show_alert=True)
        product_id = int(str(callback.data).rsplit(":", 1)[1])
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute("SELECT name,provider_price,sale_price,root_code,sub_code,status FROM client_provider_products WHERE id=?", (product_id,)) as cur:
                row = await cur.fetchone()
        if not row:
            return await callback.answer("المنتج غير موجود.", show_alert=True)
        target = ROOTS.get(str(row[3]), "غير محدد")
        if row[4]:
            target += " ← " + SUBS.get(str(row[3]), {}).get(str(row[4]), str(row[4]))
        rows = []
        for root_code, label in ROOTS.items():
            if root_code in SUBS:
                rows.append([InlineKeyboardButton(text=f"📍 {label}", callback_data=f"cli:picksub:{product_id}:{root_code}")])
            else:
                rows.append([InlineKeyboardButton(text=f"📍 {label}", callback_data=f"cli:set:{product_id}:{root_code}:-")])
        rows += [[InlineKeyboardButton(text="✅ اعتماد الترتيب", callback_data=f"cli:organized:{product_id}")], [store.back_btn(f"cli:staged:{row[5]}", "🔙 رجوع")]]
        await _edit(store, callback, f"📦 {_short(row[0], 80)}\n\nسعر المزوّد: {_money(row[1])} $\nسعر البيع: {_money(row[2] or row[1])} $\nالمكان الحالي: {target}\nالحالة: {'✅ مرتب' if row[5]=='organized' else '📥 غير مرتب'}\n\nحدد القسم ثم اعتمد الترتيب.", rows)
        await callback.answer()

    @router.callback_query(F.data.startswith("cli:picksub:"))
    async def pick_sub(callback: CallbackQuery) -> None:
        _, _, product_id, root_code = str(callback.data).split(":", 3)
        rows = [[InlineKeyboardButton(text=label, callback_data=f"cli:set:{product_id}:{root_code}:{sub_code}")] for sub_code, label in SUBS[root_code].items()]
        rows.append([store.back_btn(f"cli:arrange:{product_id}", "🔙 رجوع")])
        await _edit(store, callback, f"📍 اختر القسم الفرعي داخل {ROOTS[root_code]}:", rows)
        await callback.answer()

    @router.callback_query(F.data.startswith("cli:set:"))
    async def set_place(callback: CallbackQuery) -> None:
        if not await store.is_admin(callback.from_user.id):
            return await callback.answer("غير مصرح.", show_alert=True)
        _, _, product_id, root_code, sub_code = str(callback.data).split(":", 4)
        sub_code = "" if sub_code == "-" else sub_code
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute("UPDATE client_provider_products SET root_code=?,sub_code=? WHERE id=?", (root_code, sub_code, int(product_id)))
            await db.commit()
        await callback.answer("تم تحديد مكان المنتج.", show_alert=True)

    @router.callback_query(F.data.startswith("cli:organized:"))
    async def organized(callback: CallbackQuery) -> None:
        if not await store.is_admin(callback.from_user.id):
            return await callback.answer("غير مصرح.", show_alert=True)
        product_id = int(str(callback.data).rsplit(":", 1)[1])
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute("SELECT root_code,sub_code FROM client_provider_products WHERE id=?", (product_id,)) as cur:
                row = await cur.fetchone()
            if not row or not row[0]:
                return await callback.answer("حدد القسم أولًا.", show_alert=True)
            if str(row[0]) in SUBS and not row[1]:
                return await callback.answer("حدد القسم الفرعي أولًا.", show_alert=True)
            await db.execute("UPDATE client_provider_products SET status='organized',organized_at=CURRENT_TIMESTAMP WHERE id=?", (product_id,))
            await db.commit()
        await callback.answer("✅ تم ترتيب المنتج ونقله إلى «تم ترتيبها».", show_alert=True)

    @router.callback_query(F.data == "cli:rank")
    async def rank(callback: CallbackQuery, state: Any) -> None:
        if not await store.is_admin(callback.from_user.id):
            return await callback.answer("غير مصرح.", show_alert=True)
        await state.clear(); await state.set_state(RankStates.user_id)
        await callback.message.answer("⭐👑 أرسل Telegram User ID للمستخدم.")
        await callback.answer()

    @router.message(RankStates.user_id)
    async def rank_user(message: Message, state: Any) -> None:
        raw = str(message.text or "").strip()
        if not raw.isdigit():
            return await message.answer("أرسل User ID رقميًا فقط.")
        await state.update_data(rank_uid=int(raw)); await state.set_state(RankStates.rank)
        await message.answer("أرسل الرتبة: عميل أو موزع")

    @router.message(RankStates.rank)
    async def rank_save(message: Message, state: Any) -> None:
        raw = str(message.text or "").strip().lower()
        rank_value = "reseller" if raw in {"موزع", "reseller"} else "customer" if raw in {"عميل", "customer"} else ""
        if not rank_value:
            return await message.answer("أرسل فقط: عميل أو موزع")
        uid = int((await state.get_data()).get("rank_uid") or 0)
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute("UPDATE users SET account_rank=? WHERE user_id=?", (rank_value, uid))
            await db.commit()
        await state.clear()
        await message.answer(f"✅ تم تحديث الرتبة إلى {RANKS[rank_value]}.")

    store.dp.include_router(router)
    store._client_services_store_installed = True
