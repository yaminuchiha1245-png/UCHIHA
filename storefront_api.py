"""Read-only storefront API backed by the live UCHIHA STORE database.

The API deliberately exposes catalog fields only. It never returns users,
orders, payment details, provider credentials, provider costs, or API params.
"""

from __future__ import annotations

import hmac
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

import aiosqlite
import uvicorn
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Response, status


router = APIRouter(prefix="/v1/storefront", tags=["storefront"])


def _env_flag(name: str, default: bool = False) -> bool:
    fallback = "1" if default else "0"
    return os.getenv(name, fallback).strip().lower() in {"1", "true", "yes", "on"}


def _db_path() -> Path:
    return Path(os.getenv("DB_PATH", "store.db").strip() or "store.db").expanduser().resolve()


def _safe_page(page: int) -> int:
    return max(1, int(page))


def _safe_limit(limit: int) -> int:
    return max(1, min(int(limit), 100))


async def _authorize(
    provided_key: str | None = Header(default=None, alias="X-UCHIHA-Storefront-Key"),
) -> None:
    """Require a shared key only when the owner configured one."""
    expected_key = os.getenv("STOREFRONT_API_KEY", "").strip()
    if not expected_key:
        return
    if not provided_key or not hmac.compare_digest(provided_key, expected_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="مفتاح واجهة المتجر غير صالح.",
        )


@asynccontextmanager
async def _readonly_db() -> AsyncIterator[aiosqlite.Connection]:
    path = _db_path()
    if not path.exists() or path.stat().st_size == 0:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="بيانات المتجر غير جاهزة حاليًا.",
        )

    db: aiosqlite.Connection | None = None
    try:
        db = await aiosqlite.connect(f"{path.as_uri()}?mode=ro", uri=True, timeout=5)
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA query_only = ON")
        await db.execute("PRAGMA busy_timeout = 5000")
        yield db
    except HTTPException:
        raise
    except (aiosqlite.Error, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="تعذر قراءة كتالوج المتجر مؤقتًا.",
        ) from exc
    finally:
        if db is not None:
            await db.close()


async def _fetch_settings(db: aiosqlite.Connection) -> dict[str, str]:
    async with db.execute(
        "SELECT key, value FROM settings WHERE key IN ('currency', 'bot_status')"
    ) as cursor:
        rows = await cursor.fetchall()
    return {str(row["key"]): str(row["value"] or "") for row in rows}


async def _fetch_categories(db: aiosqlite.Connection) -> list[dict[str, Any]]:
    async with db.execute(
        """
        SELECT
            c.id,
            COALESCE(NULLIF(c.display_name, ''), c.name) AS name,
            COALESCE(c.local_parent_id, c.parent_id, 0) AS parent_id,
            COALESCE(c.local_sort_order, c.sort_order, 0) AS sort_order
        FROM categories c
        WHERE c.is_active = 1
          AND COALESCE(c.is_hidden, 0) = 0
          AND NOT (
              COALESCE(c.api_provider, '') <> 'js4card'
              AND EXISTS (
                  SELECT 1 FROM payment_methods pm
                  WHERE LOWER(TRIM(pm.name)) = LOWER(TRIM(c.name))
              )
              AND NOT EXISTS (
                  SELECT 1 FROM products p
                  WHERE p.category_id = c.id AND p.is_active = 1 AND p.stock > 0
              )
              AND NOT EXISTS (
                  SELECT 1 FROM categories child
                  WHERE COALESCE(child.local_parent_id, child.parent_id, 0) = c.id
                    AND child.is_active = 1
                    AND COALESCE(child.is_hidden, 0) = 0
              )
          )
        ORDER BY sort_order, name
        """
    ) as cursor:
        rows = await cursor.fetchall()

    categories = [
        {
            "id": int(row["id"]),
            "name": str(row["name"] or "قسم"),
            "parent_id": int(row["parent_id"] or 0),
            "sort_order": int(row["sort_order"] or 0),
            "product_count": 0,
        }
        for row in rows
    ]
    allowed_ids = {category["id"] for category in categories}
    parent_by_id = {
        category["id"]: category["parent_id"]
        if category["parent_id"] in allowed_ids
        else 0
        for category in categories
    }

    async with db.execute(
        """
        SELECT p.category_id, COUNT(*) AS product_count
        FROM products p
        JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = 1
          AND p.stock > 0
          AND c.is_active = 1
          AND COALESCE(c.is_hidden, 0) = 0
        GROUP BY p.category_id
        """
    ) as cursor:
        count_rows = await cursor.fetchall()

    count_by_id = {category["id"]: 0 for category in categories}
    for row in count_rows:
        category_id = int(row["category_id"] or 0)
        count = int(row["product_count"] or 0)
        current = category_id
        seen: set[int] = set()
        while current in count_by_id and current not in seen:
            seen.add(current)
            count_by_id[current] += count
            current = parent_by_id.get(current, 0)

    for category in categories:
        category["parent_id"] = parent_by_id[category["id"]]
        category["product_count"] = count_by_id[category["id"]]
    return categories


def _root_category(category_id: int, parent_by_id: dict[int, int]) -> int:
    current = int(category_id or 0)
    seen: set[int] = set()
    while current and current not in seen:
        seen.add(current)
        parent = int(parent_by_id.get(current, 0) or 0)
        if not parent:
            return current
        current = parent
    return int(category_id or 0)


def _category_filter(category_id: int | None) -> tuple[str, list[Any]]:
    if category_id is None:
        return "", []
    return (
        """
        WITH RECURSIVE category_tree(id) AS (
            SELECT ?
            UNION
            SELECT c.id
            FROM categories c
            JOIN category_tree tree
              ON COALESCE(c.local_parent_id, c.parent_id, 0) = tree.id
            WHERE c.is_active = 1 AND COALESCE(c.is_hidden, 0) = 0
        )
        """,
        [int(category_id)],
    )


async def _fetch_products(
    db: aiosqlite.Connection,
    categories: list[dict[str, Any]],
    *,
    category_id: int | None,
    query: str,
    page: int,
    limit: int,
) -> dict[str, Any]:
    page = _safe_page(page)
    limit = _safe_limit(limit)
    query = (query or "").strip()[:100]
    prefix, prefix_params = _category_filter(category_id)

    filters = [
        "p.is_active = 1",
        "p.stock > 0",
        "c.is_active = 1",
        "COALESCE(c.is_hidden, 0) = 0",
    ]
    filter_params: list[Any] = []
    if category_id is not None:
        filters.append("p.category_id IN (SELECT id FROM category_tree)")
    if query:
        filters.append("(LOWER(p.name) LIKE LOWER(?) OR LOWER(COALESCE(p.description, '')) LIKE LOWER(?))")
        pattern = f"%{query}%"
        filter_params.extend([pattern, pattern])

    where_sql = " AND ".join(filters)
    count_sql = f"{prefix} SELECT COUNT(*) AS total FROM products p JOIN categories c ON c.id = p.category_id WHERE {where_sql}"
    async with db.execute(count_sql, [*prefix_params, *filter_params]) as cursor:
        count_row = await cursor.fetchone()
    total = int(count_row["total"] if count_row else 0)

    product_sql = f"""
        {prefix}
        SELECT
            p.id,
            p.category_id,
            p.name,
            COALESCE(p.description, '') AS description,
            p.price,
            p.stock,
            COALESCE(p.product_type, 'stock') AS product_type,
            COALESCE(p.delivery_time, '') AS delivery_time,
            COALESCE(p.has_variants, 0) AS has_variants,
            COALESCE(p.sort_order, 0) AS sort_order
        FROM products p
        JOIN categories c ON c.id = p.category_id
        WHERE {where_sql}
        ORDER BY
            COALESCE(c.local_sort_order, c.sort_order, 0),
            COALESCE(p.sort_order, 0),
            p.name,
            p.id
        LIMIT ? OFFSET ?
    """
    params = [*prefix_params, *filter_params, limit, (page - 1) * limit]
    async with db.execute(product_sql, params) as cursor:
        rows = await cursor.fetchall()

    parent_by_id = {int(item["id"]): int(item["parent_id"] or 0) for item in categories}
    category_name_by_id = {int(item["id"]): str(item["name"]) for item in categories}
    currency_code = (os.getenv("STOREFRONT_CURRENCY_CODE", "USD").strip() or "USD").upper()[:8]
    items = [
        {
            "id": int(row["id"]),
            "category_id": int(row["category_id"] or 0),
            "root_category_id": _root_category(int(row["category_id"] or 0), parent_by_id),
            "category_name": category_name_by_id.get(int(row["category_id"] or 0), "منتجات رقمية"),
            "name": str(row["name"] or "منتج رقمي"),
            "description": str(row["description"] or "منتج رقمي متاح عبر UCHIHA STORE."),
            "price": round(float(row["price"] or 0), 6),
            "currency": currency_code,
            "available": int(row["stock"] or 0) > 0,
            "product_type": str(row["product_type"] or "stock"),
            "delivery_time": str(row["delivery_time"] or ""),
            "has_variants": bool(row["has_variants"]),
        }
        for row in rows
    ]
    return {
        "page": page,
        "limit": limit,
        "total": total,
        "pages": (total + limit - 1) // limit if total else 0,
        "items": items,
    }


def _store_payload(settings: dict[str, str]) -> dict[str, Any]:
    return {
        "name": os.getenv("STOREFRONT_NAME", "UCHIHA STORE").strip() or "UCHIHA STORE",
        "currency": (os.getenv("STOREFRONT_CURRENCY_CODE", "USD").strip() or "USD").upper()[:8],
        "currency_symbol": settings.get("currency", "$"),
        "telegram_url": os.getenv("STOREFRONT_TELEGRAM_URL", "").strip(),
        "accepting_orders": settings.get("bot_status", "active") == "active",
    }


def _cache(response: Response, seconds: int = 30) -> None:
    response.headers["Cache-Control"] = f"public, max-age={seconds}, stale-while-revalidate=120"
    response.headers["X-Content-Type-Options"] = "nosniff"


@router.get("/health")
async def storefront_health(response: Response) -> dict[str, Any]:
    path = _db_path()
    _cache(response, 10)
    return {
        "status": "ok" if path.exists() and path.stat().st_size > 0 else "starting",
        "service": "uchiha-storefront",
        "catalog_enabled": _env_flag("STOREFRONT_API_ENABLED", True),
    }


@router.get("/categories", dependencies=[Depends(_authorize)])
async def storefront_categories(response: Response) -> dict[str, Any]:
    async with _readonly_db() as db:
        categories = await _fetch_categories(db)
    _cache(response)
    return {"items": categories, "total": len(categories)}


@router.get("/products", dependencies=[Depends(_authorize)])
async def storefront_products(
    response: Response,
    category_id: int | None = Query(default=None, ge=1),
    q: str = Query(default="", max_length=100),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=48, ge=1, le=100),
) -> dict[str, Any]:
    async with _readonly_db() as db:
        categories = await _fetch_categories(db)
        result = await _fetch_products(
            db,
            categories,
            category_id=category_id,
            query=q,
            page=page,
            limit=limit,
        )
    _cache(response)
    return result


@router.get("/catalog", dependencies=[Depends(_authorize)])
async def storefront_catalog(
    response: Response,
    category_id: int | None = Query(default=None, ge=1),
    q: str = Query(default="", max_length=100),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=48, ge=1, le=100),
) -> dict[str, Any]:
    async with _readonly_db() as db:
        settings = await _fetch_settings(db)
        categories = await _fetch_categories(db)
        products = await _fetch_products(
            db,
            categories,
            category_id=category_id,
            query=q,
            page=page,
            limit=limit,
        )
    _cache(response)
    return {
        "version": 1,
        "store": _store_payload(settings),
        "categories": categories,
        "products": products,
    }


def install_storefront_routes(app: FastAPI) -> None:
    """Attach routes once to the existing UCHIHA Platform FastAPI app."""
    if getattr(app.state, "uchiha_storefront_routes", False):
        return
    app.include_router(router)
    app.state.uchiha_storefront_routes = True


app = FastAPI(
    title="UCHIHA Storefront",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
install_storefront_routes(app)


async def run_storefront_api() -> None:
    """Serve only the public read-only catalog on Railway's HTTP port."""
    raw_port = os.getenv("API_PORT", os.getenv("PORT", "8080")).strip() or "8080"
    try:
        port = int(raw_port)
    except ValueError:
        port = 8080
    config = uvicorn.Config(
        app,
        host=os.getenv("STOREFRONT_HOST", "0.0.0.0").strip() or "0.0.0.0",
        port=port,
        log_level=os.getenv("LOG_LEVEL", "info").strip().lower() or "info",
        access_log=False,
        lifespan="off",
    )
    server = uvicorn.Server(config)
    await server.serve()
