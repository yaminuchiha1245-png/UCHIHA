from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import urljoin

import aiohttp
import aiosqlite
from aiogram import F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup
from cryptography.fernet import Fernet, InvalidToken

from client_services_store import _key_path, ensure_schema


COMMON_LIST_KEYS = ("products", "items", "data", "result", "catalog")
COMMON_ID_KEYS = ("id", "product_id", "productId", "sku", "code", "uuid")
COMMON_NAME_KEYS = ("name", "title", "product_name", "productName", "label")
COMMON_PRICE_KEYS = ("price", "cost", "amount", "price_usd", "priceUsd", "sell_price")


def _first(mapping: dict[str, Any], keys: tuple[str, ...], default: Any = "") -> Any:
    for key in keys:
        value = mapping.get(key)
        if value is not None and value != "":
            return value
    return default


def _extract_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in COMMON_LIST_KEYS:
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            nested = _extract_items(value)
            if nested:
                return nested
    for value in payload.values():
        if isinstance(value, list) and value and isinstance(value[0], dict):
            return [item for item in value if isinstance(item, dict)]
    return []


def _price(value: Any) -> float:
    try:
        return max(float(str(value).replace(",", ".")), 0.0)
    except (TypeError, ValueError):
        return 0.0


def _decrypt_token(store: Any, ciphertext: str) -> str:
    """Decrypt a provider token using the exact same key policy as _encrypt."""
    if not ciphertext:
        return ""
    env_key = os.getenv("CLIENT_STORE_MASTER_KEY", "").strip()
    try:
        if env_key:
            fernet = Fernet(env_key.encode("ascii"))
        else:
            fernet = Fernet(_key_path(store).read_bytes().strip())
        return fernet.decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except (OSError, InvalidToken, ValueError):
        return ""


async def _ensure_provider_schema(store: Any) -> None:
    await ensure_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        for sql in (
            "ALTER TABLE client_api_providers ADD COLUMN auth_mode TEXT DEFAULT 'auto'",
            "ALTER TABLE client_api_providers ADD COLUMN token_query_key TEXT DEFAULT 'api_key'",
            "ALTER TABLE client_provider_products ADD COLUMN source_type TEXT DEFAULT 'api'",
            "ALTER TABLE client_provider_products ADD COLUMN last_seen_at TEXT DEFAULT ''",
        ):
            try:
                await db.execute(sql)
            except Exception:
                pass
        await db.commit()


async def _provider(store: Any, provider_id: int) -> tuple[Any, ...] | None:
    await _ensure_provider_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT id,name,base_url,catalog_path,token_cipher,is_active,
                   COALESCE(auth_mode,'auto'),COALESCE(token_query_key,'api_key')
            FROM client_api_providers WHERE id=?
            """,
            (provider_id,),
        ) as cursor:
            return await cursor.fetchone()


def _auth_request_parts(mode: str, token: str, query_key: str) -> tuple[dict[str, str], dict[str, str]]:
    headers: dict[str, str] = {"Accept": "application/json"}
    params: dict[str, str] = {}
    if mode == "none":
        return headers, params
    if mode == "bearer":
        headers["Authorization"] = f"Bearer {token}"
    elif mode == "x_api_key":
        headers["X-API-Key"] = token
    elif mode == "query":
        params[query_key or "api_key"] = token
    else:
        headers["Authorization"] = f"Bearer {token}"
        headers["X-API-Key"] = token
    return headers, params


async def sync_provider(store: Any, provider_id: int) -> tuple[bool, str, int]:
    row = await _provider(store, provider_id)
    if not row:
        return False, "المزوّد غير موجود.", 0
    if not int(row[5] or 0):
        return False, "المزوّد متوقف حاليًا.", 0

    base_url = str(row[2] or "").strip().rstrip("/") + "/"
    catalog_path = str(row[3] or "").strip()
    if not base_url.strip("/") or not catalog_path:
        return False, "أكمل Base URL ومسار الكتالوج أولًا.", 0

    endpoint = catalog_path if catalog_path.startswith("http") else urljoin(base_url, catalog_path.lstrip("/"))
    allow_insecure = os.getenv("CLIENT_STORE_ALLOW_INSECURE_API", "0").strip().lower() in {"1", "true", "yes", "on"}
    if not endpoint.startswith("https://") and not allow_insecure:
        return False, "رفضت المزامنة لأن رابط API ليس HTTPS. يمكن تغييره من إعدادات المزوّد.", 0

    mode = str(row[6] or "auto")
    query_key = str(row[7] or "api_key").strip() or "api_key"
    token = _decrypt_token(store, str(row[4] or ""))
    if mode != "none" and not token:
        return False, "تعذر قراءة التوكن المشفّر. بدّل التوكن من إعدادات المزوّد.", 0

    headers, params = _auth_request_parts(mode, token, query_key)
    timeout = aiohttp.ClientTimeout(total=30)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(endpoint, headers=headers, params=params) as response:
                body = await response.text()
                if response.status < 200 or response.status >= 300:
                    raise RuntimeError(f"HTTP {response.status}")
                try:
                    payload = json.loads(body)
                except json.JSONDecodeError as exc:
                    raise RuntimeError("الاستجابة ليست JSON صالحًا.") from exc
    except Exception as exc:
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                """
                UPDATE client_api_providers
                SET last_sync_status='failed',last_error=?,last_sync_at=CURRENT_TIMESTAMP
                WHERE id=?
                """,
                (str(exc)[:500], provider_id),
            )
            await db.commit()
        return False, f"فشلت المزامنة: {str(exc)[:180]}", 0

    items = _extract_items(payload)
    if not items:
        async with aiosqlite.connect(store.DB_PATH) as db:
            await db.execute(
                """
                UPDATE client_api_providers
                SET last_sync_status='empty',last_error='No recognizable product list',
                    last_sync_at=CURRENT_TIMESTAMP
                WHERE id=?
                """,
                (provider_id,),
            )
            await db.commit()
        return False, "تم الاتصال لكن لم أجد قائمة منتجات معروفة في JSON. يحتاج هذا المزوّد Adapter مخصصًا.", 0

    imported = 0
    async with aiosqlite.connect(store.DB_PATH) as db:
        for index, item in enumerate(items, start=1):
            external_id = str(_first(item, COMMON_ID_KEYS, index)).strip()
            name = str(_first(item, COMMON_NAME_KEYS, f"Product {external_id}")).strip()
            provider_price = _price(_first(item, COMMON_PRICE_KEYS, 0))
            await db.execute(
                """
                INSERT INTO client_provider_products(
                    provider_id,external_id,name,provider_price,sale_price,raw_json,
                    source_type,last_seen_at
                ) VALUES(?,?,?,?,?,?,'api',CURRENT_TIMESTAMP)
                ON CONFLICT(provider_id,external_id) DO UPDATE SET
                    name=excluded.name,
                    provider_price=excluded.provider_price,
                    sale_price=CASE
                        WHEN client_provider_products.status='unorganized'
                        THEN excluded.provider_price
                        ELSE client_provider_products.sale_price
                    END,
                    raw_json=excluded.raw_json,
                    source_type='api',
                    last_seen_at=CURRENT_TIMESTAMP
                """,
                (
                    provider_id,
                    external_id,
                    name[:180],
                    provider_price,
                    provider_price,
                    json.dumps(item, ensure_ascii=False)[:12000],
                ),
            )
            imported += 1
        await db.execute(
            """
            UPDATE client_api_providers
            SET last_sync_status='success',last_error='',last_sync_at=CURRENT_TIMESTAMP
            WHERE id=?
            """,
            (provider_id,),
        )
        await db.commit()
    return True, (
        f"تم استيراد/تحديث {imported} منتجًا. "
        "الجديد يدخل «📥 غير مرتبة»، والمنتجات المرتبة تحتفظ بمكانها وسعر البيع الذي حدده صاحب البوت."
    ), imported


def _wrap_admin_panel(store: Any, original: Any):
    def wrapped(perms: dict | None = None, super_admin: bool = False) -> InlineKeyboardMarkup:
        markup = original(perms, super_admin)
        rows = [list(row) for row in markup.inline_keyboard]
        p = perms or {}
        if super_admin or p.get("can_manage_products") or p.get("can_manage_sync"):
            pos = max(len(rows) - 1, 0)
            rows.insert(pos, [InlineKeyboardButton(text="🔄 مزامنة مزودي API", callback_data="clisync:list")])
        return InlineKeyboardMarkup(inline_keyboard=rows)
    return wrapped


def install(store: Any) -> None:
    if getattr(store, "_client_api_sync_installed", False):
        return

    store.admin_panel_kb = _wrap_admin_panel(store, store.admin_panel_kb)
    router = Router(name="client_api_sync")

    @router.callback_query(F.data == "clisync:list")
    async def sync_list(callback: CallbackQuery) -> None:
        if not await store.is_admin(callback.from_user.id):
            return await callback.answer("غير مصرح.", show_alert=True)
        await _ensure_provider_schema(store)
        async with aiosqlite.connect(store.DB_PATH) as db:
            async with db.execute(
                """
                SELECT id,name,is_active,last_sync_status,last_sync_at
                FROM client_api_providers
                WHERE adapter_key<>'manual'
                ORDER BY id DESC
                """
            ) as cursor:
                providers = await cursor.fetchall()
        rows = [[InlineKeyboardButton(text=f"{'🟢' if int(p[2] or 0) else '⚫'} {str(p[1])[:24]}", callback_data=f"clisync:run:{int(p[0])}")] for p in providers]
        if not rows:
            rows.append([InlineKeyboardButton(text="لا يوجد مزودون بعد", callback_data="cli:noop")])
        rows.append([store.back_btn("cliadmin:home", "🔙 إدارة المتجر")])
        await callback.message.edit_text(
            "🔄 مزامنة مزودي API\n\nالمزامنة قراءة فقط: تجلب الكتالوج والأسعار ولا تنفذ أي عملية شراء أو خصم عند المزوّد.",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=rows),
        )
        await callback.answer()

    @router.callback_query(F.data.startswith("clisync:run:"))
    async def sync_run(callback: CallbackQuery) -> None:
        if not await store.is_admin(callback.from_user.id):
            return await callback.answer("غير مصرح.", show_alert=True)
        provider_id = int(str(callback.data).rsplit(":", 1)[1])
        await callback.answer("جاري المزامنة…")
        ok, message, _ = await sync_provider(store, provider_id)
        await callback.message.answer(("✅ " if ok else "⚠️ ") + message)

    store.dp.include_router(router)
    store._client_api_sync_installed = True
