from __future__ import annotations

from typing import Any, Awaitable, Callable

import aiosqlite
from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery


async def _effective_catalog_price(store: Any, item_id: int) -> float | None:
    async with aiosqlite.connect(store.DB_PATH) as db:
        try:
            async with db.execute(
                """
                SELECT CASE
                    WHEN COALESCE(sale_price,0) > 0 THEN sale_price
                    ELSE COALESCE(provider_price,0)
                END
                FROM client_provider_products WHERE id=?
                """,
                (item_id,),
            ) as cursor:
                row = await cursor.fetchone()
        except Exception:
            return None
    if not row:
        return None
    try:
        return float(row[0] or 0)
    except (TypeError, ValueError):
        return 0.0


async def quarantine_invalid_priced_products(store: Any) -> int:
    """Hide already-organized zero-price rows inherited from older client builds."""
    async with aiosqlite.connect(store.DB_PATH) as db:
        try:
            cursor = await db.execute(
                """
                UPDATE client_provider_products
                SET is_active=0
                WHERE status='organized'
                  AND CASE
                        WHEN COALESCE(sale_price,0) > 0 THEN sale_price
                        ELSE COALESCE(provider_price,0)
                      END <= 0
                """
            )
            await db.commit()
            return max(int(cursor.rowcount or 0), 0)
        except Exception:
            return 0


class ClientCatalogSafetyMiddleware(BaseMiddleware):
    def __init__(self, store: Any) -> None:
        self.store = store

    async def __call__(
        self,
        handler: Callable[[CallbackQuery, dict[str, Any]], Awaitable[Any]],
        event: CallbackQuery,
        data: dict[str, Any],
    ) -> Any:
        callback_data = str(getattr(event, "data", "") or "")
        prefixes = ("cli:organized:", "cli:product:", "cli:buy:", "cli:api-confirm:", "cli:confirm:")
        matching = next((prefix for prefix in prefixes if callback_data.startswith(prefix)), None)
        if not matching:
            return await handler(event, data)

        try:
            item_id = int(callback_data.rsplit(":", 1)[1])
        except (TypeError, ValueError):
            return await handler(event, data)
        price = await _effective_catalog_price(self.store, item_id)
        if price is None:
            return await handler(event, data)
        if price <= 0:
            if callback_data.startswith("cli:organized:"):
                message = "ضع سعر بيع أكبر من صفر قبل اعتماد ترتيب المنتج."
            else:
                message = "هذا المنتج غير متاح حاليًا لأن سعره غير مضبوط."
            await event.answer(message, show_alert=True)
            return None
        return await handler(event, data)


def install(store: Any) -> None:
    if getattr(store, "_client_catalog_safety_installed", False):
        return

    original_init_db = store.init_db

    async def init_db() -> None:
        await original_init_db()
        await quarantine_invalid_priced_products(store)

    store.init_db = init_db
    store.dp.callback_query.outer_middleware(ClientCatalogSafetyMiddleware(store))
    store._client_catalog_safety_installed = True
