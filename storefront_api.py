"""Read-only storefront API and public web shop for UCHIHA STORE.

Only public catalog fields are exposed. Users, orders, payments, provider
credentials, provider costs, and API parameters never leave the database.
"""

from __future__ import annotations

import hmac
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

import aiosqlite
import uvicorn
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Response, status
from fastapi.responses import HTMLResponse


router = APIRouter(prefix="/v1/storefront", tags=["storefront"])
site_router = APIRouter(tags=["storefront-web"])


def _env_flag(name: str, default: bool = False) -> bool:
    fallback = "1" if default else "0"
    return os.getenv(name, fallback).strip().lower() in {"1", "true", "yes", "on"}


def _db_path() -> Path:
    return Path(os.getenv("DB_PATH", "store.db").strip() or "store.db").expanduser().resolve()


def _safe_page(page: int) -> int:
    return max(1, int(page))


def _safe_limit(limit: int) -> int:
    return max(1, min(int(limit), 100))


def _exchange_rates(base_currency: str) -> dict[str, float]:
    """Return owner-configured display rates relative to the base currency."""
    rates: dict[str, float] = {base_currency: 1.0}
    raw = os.getenv("STOREFRONT_EXCHANGE_RATES", "").strip()
    if not raw:
        return rates
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return rates
    if not isinstance(payload, dict):
        return rates
    for code, value in payload.items():
        normalized = str(code).strip().upper()[:8]
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            continue
        if normalized and numeric > 0:
            rates[normalized] = numeric
    rates[base_currency] = 1.0
    return rates


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
        category["id"]: category["parent_id"] if category["parent_id"] in allowed_ids else 0
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
        filters.append(
            "(LOWER(p.name) LIKE LOWER(?) OR LOWER(COALESCE(p.description, '')) LIKE LOWER(?))"
        )
        pattern = f"%{query}%"
        filter_params.extend([pattern, pattern])

    where_sql = " AND ".join(filters)
    count_sql = (
        f"{prefix} SELECT COUNT(*) AS total FROM products p "
        f"JOIN categories c ON c.id = p.category_id WHERE {where_sql}"
    )
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
            "category_name": category_name_by_id.get(
                int(row["category_id"] or 0), "منتجات رقمية"
            ),
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
    currency = (os.getenv("STOREFRONT_CURRENCY_CODE", "USD").strip() or "USD").upper()[:8]
    telegram_url = os.getenv("STOREFRONT_TELEGRAM_URL", "").strip()
    support_url = os.getenv("STOREFRONT_SUPPORT_URL", "").strip() or telegram_url
    return {
        "name": os.getenv("STOREFRONT_NAME", "UCHIHA STORE").strip() or "UCHIHA STORE",
        "currency": currency,
        "currency_symbol": settings.get("currency", "$"),
        "exchange_rates": _exchange_rates(currency),
        "telegram_url": telegram_url,
        "support_url": support_url,
        "announcement": os.getenv(
            "STOREFRONT_ANNOUNCEMENT",
            "منتجات رقمية أصلية وتسليم سريع عبر تيليجرام",
        ).strip(),
        "accepting_orders": settings.get("bot_status", "active") == "active",
    }


def _cache(response: Response, seconds: int = 30) -> None:
    response.headers["Cache-Control"] = f"public, max-age={seconds}, stale-while-revalidate=120"
    response.headers["X-Content-Type-Options"] = "nosniff"


async def _catalog_payload(
    *, category_id: int | None, query: str, page: int, limit: int
) -> dict[str, Any]:
    async with _readonly_db() as db:
        settings = await _fetch_settings(db)
        categories = await _fetch_categories(db)
        products = await _fetch_products(
            db,
            categories,
            category_id=category_id,
            query=query,
            page=page,
            limit=limit,
        )
    return {
        "version": 2,
        "store": _store_payload(settings),
        "categories": categories,
        "products": products,
    }


@router.get("/health")
async def storefront_health(response: Response) -> dict[str, Any]:
    path = _db_path()
    _cache(response, 10)
    return {
        "status": "ok" if path.exists() and path.stat().st_size > 0 else "starting",
        "service": "uchiha-storefront",
        "catalog_enabled": _env_flag("STOREFRONT_API_ENABLED", True),
        "web_enabled": _env_flag("STOREFRONT_WEB_ENABLED", True),
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
    payload = await _catalog_payload(
        category_id=category_id, query=q, page=page, limit=limit
    )
    _cache(response)
    return payload


@router.get("/public-catalog")
async def storefront_public_catalog(
    response: Response,
    category_id: int | None = Query(default=None, ge=1),
    q: str = Query(default="", max_length=100),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=48, ge=1, le=100),
) -> dict[str, Any]:
    if not _env_flag("STOREFRONT_PUBLIC_CATALOG_ENABLED", True):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    payload = await _catalog_payload(
        category_id=category_id, query=q, page=page, limit=limit
    )
    _cache(response, 20)
    return payload


_STOREFRONT_HTML = r'''<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#0b0d12">
  <meta name="description" content="UCHIHA STORE للمنتجات الرقمية والتسليم السريع عبر تيليجرام">
  <title>UCHIHA STORE</title>
  <style>
    :root{--bg:#07080b;--panel:#101218;--panel2:#161922;--line:#252a36;--text:#f7f8fb;--muted:#9aa3b5;--brand:#e32736;--brand2:#8d101d;--ok:#32d583;--shadow:0 18px 60px rgba(0,0,0,.35)}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 90% -10%,rgba(227,39,54,.22),transparent 34%),radial-gradient(circle at 0 20%,rgba(79,70,229,.10),transparent 28%),var(--bg);color:var(--text);font-family:Tahoma,Arial,sans-serif;min-height:100vh}
    button,input,select{font:inherit}.shell{width:min(1180px,calc(100% - 28px));margin:auto}.top{position:sticky;top:0;z-index:30;background:rgba(7,8,11,.82);backdrop-filter:blur(18px);border-bottom:1px solid rgba(255,255,255,.06)}
    .nav{height:76px;display:flex;align-items:center;gap:18px}.brand{display:flex;align-items:center;gap:11px;font-weight:900;letter-spacing:.5px;white-space:nowrap}.mark{width:42px;height:42px;border-radius:14px;background:linear-gradient(145deg,var(--brand),#5b0911);display:grid;place-items:center;box-shadow:0 9px 25px rgba(227,39,54,.3);font-size:21px}.brand small{display:block;color:var(--muted);font-size:10px;font-weight:700;letter-spacing:1.5px;margin-top:2px}
    .search{flex:1;position:relative}.search input{width:100%;height:46px;background:#11141b;border:1px solid var(--line);border-radius:14px;color:var(--text);padding:0 46px 0 14px;outline:none;transition:.2s}.search input:focus{border-color:rgba(227,39,54,.8);box-shadow:0 0 0 4px rgba(227,39,54,.1)}.search span{position:absolute;right:16px;top:12px;color:var(--muted)}
    .nav-actions{display:flex;gap:9px}.icon-btn,.currency{height:44px;border:1px solid var(--line);background:#12151c;color:var(--text);border-radius:13px;padding:0 14px;cursor:pointer}.cart-btn{position:relative}.badge{position:absolute;top:-7px;left:-7px;background:var(--brand);min-width:21px;height:21px;border-radius:20px;font-size:11px;display:grid;place-items:center;border:2px solid var(--bg)}
    .hero{padding:54px 0 28px}.hero-box{position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.08);border-radius:28px;min-height:290px;padding:42px;background:linear-gradient(120deg,rgba(227,39,54,.21),rgba(18,21,28,.93) 48%,rgba(15,18,25,.96));box-shadow:var(--shadow)}.hero-box:after{content:"UCHIHA";position:absolute;left:-10px;bottom:-33px;font-size:130px;font-weight:900;color:rgba(255,255,255,.025);letter-spacing:10px}.eyebrow{display:inline-flex;gap:8px;align-items:center;color:#ffb6bc;background:rgba(227,39,54,.12);border:1px solid rgba(227,39,54,.25);padding:8px 12px;border-radius:99px;font-size:12px;font-weight:800}.hero h1{font-size:clamp(34px,6vw,68px);line-height:1.02;margin:18px 0 14px;max-width:700px}.hero p{color:#c3c8d2;font-size:17px;line-height:1.9;max-width:680px;margin:0}.hero-actions{display:flex;gap:11px;margin-top:25px;flex-wrap:wrap}.primary,.secondary{border:0;border-radius:14px;min-height:48px;padding:0 20px;font-weight:900;cursor:pointer}.primary{background:linear-gradient(135deg,var(--brand),var(--brand2));color:white;box-shadow:0 12px 28px rgba(227,39,54,.25)}.secondary{background:rgba(255,255,255,.06);color:white;border:1px solid rgba(255,255,255,.1)}
    .trust{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}.trust div{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:14px;color:#cfd4de}.trust b{display:block;color:white;margin-bottom:5px}
    .section-head{display:flex;justify-content:space-between;align-items:end;gap:12px;margin:28px 0 16px}.section-head h2{margin:0;font-size:25px}.section-head p{color:var(--muted);margin:6px 0 0}.result-count{color:var(--muted);font-size:13px}.cats{display:flex;gap:10px;overflow:auto;padding:2px 0 10px;scrollbar-width:none}.cat{white-space:nowrap;border:1px solid var(--line);background:#11141a;color:#cdd2dc;border-radius:13px;padding:11px 15px;cursor:pointer}.cat.active{background:linear-gradient(135deg,var(--brand),var(--brand2));border-color:transparent;color:#fff}.cat small{opacity:.65;margin-right:6px}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px}.card{background:linear-gradient(155deg,#151821,#0f1117);border:1px solid var(--line);border-radius:19px;overflow:hidden;display:flex;flex-direction:column;min-height:320px;transition:.23s}.card:hover{transform:translateY(-4px);border-color:#3a4050;box-shadow:0 18px 35px rgba(0,0,0,.25)}.visual{height:128px;position:relative;display:grid;place-items:center;background:radial-gradient(circle at 70% 20%,rgba(227,39,54,.28),transparent 40%),linear-gradient(135deg,#1b1e28,#11131a);font-size:41px;font-weight:900;color:rgba(255,255,255,.88)}.visual .tag{position:absolute;top:11px;right:11px;font-size:10px;background:rgba(7,8,11,.72);border:1px solid rgba(255,255,255,.09);padding:6px 8px;border-radius:10px;color:#d9dde5}.content{padding:15px;display:flex;flex-direction:column;gap:10px;flex:1}.content h3{font-size:15px;line-height:1.55;margin:0}.desc{font-size:12px;line-height:1.7;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.meta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto}.price{font-size:19px;font-weight:900}.delivery{font-size:10px;color:var(--ok)}.add{width:100%;border:0;border-radius:12px;height:41px;background:#232735;color:#fff;font-weight:800;cursor:pointer}.add:hover{background:var(--brand)}
    .empty,.loading{grid-column:1/-1;border:1px dashed #303543;border-radius:18px;padding:46px 20px;text-align:center;color:var(--muted)}.more-wrap{text-align:center;padding:24px 0 50px}.more{display:none}
    .overlay{position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:50;opacity:0;pointer-events:none;transition:.2s}.overlay.show{opacity:1;pointer-events:auto}.drawer{position:fixed;top:0;bottom:0;left:0;width:min(430px,92vw);background:#0d0f14;border-right:1px solid var(--line);z-index:60;transform:translateX(-102%);transition:.28s;display:flex;flex-direction:column}.drawer.show{transform:none}.drawer-head{height:74px;padding:0 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line)}.drawer-body{padding:15px;overflow:auto;flex:1}.cart-item{display:grid;grid-template-columns:1fr auto;gap:10px;background:#141720;border:1px solid var(--line);padding:13px;border-radius:14px;margin-bottom:10px}.cart-item b{font-size:13px}.cart-item small{color:var(--muted);display:block;margin-top:5px}.remove{background:none;border:0;color:#ff7883;cursor:pointer}.drawer-foot{border-top:1px solid var(--line);padding:17px}.total{display:flex;justify-content:space-between;font-size:19px;font-weight:900;margin-bottom:14px}.checkout{width:100%}.notice{font-size:11px;color:var(--muted);line-height:1.7;margin-top:10px;text-align:center}.toast{position:fixed;bottom:22px;right:50%;transform:translate(50%,25px);z-index:100;background:#20242e;border:1px solid #343a49;color:#fff;padding:12px 17px;border-radius:13px;opacity:0;pointer-events:none;transition:.2s}.toast.show{opacity:1;transform:translate(50%,0)}
    footer{border-top:1px solid rgba(255,255,255,.06);color:var(--muted);padding:24px 0 35px;text-align:center;font-size:12px}
    @media(max-width:900px){.grid{grid-template-columns:repeat(3,1fr)}.trust{grid-template-columns:1fr}.hero-box{padding:31px}.nav{flex-wrap:wrap;height:auto;padding:12px 0}.brand{order:1}.nav-actions{order:2;margin-right:auto}.search{order:3;flex-basis:100%}}
    @media(max-width:650px){.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.shell{width:min(100% - 18px,1180px)}.hero{padding-top:22px}.hero-box{padding:25px 20px;min-height:260px;border-radius:21px}.hero p{font-size:14px}.card{min-height:300px}.visual{height:108px}.currency{max-width:83px}.brand small{display:none}}
    @media(max-width:390px){.grid{grid-template-columns:1fr}.card{min-height:270px}}
  </style>
</head>
<body>
  <header class="top"><div class="shell nav">
    <div class="brand"><div class="mark">火</div><div><span id="brandName">UCHIHA STORE</span><small>DIGITAL MARKET</small></div></div>
    <div class="search"><span>⌕</span><input id="searchInput" autocomplete="off" placeholder="ابحث عن لعبة، بطاقة أو خدمة رقمية..."></div>
    <div class="nav-actions"><select id="currency" class="currency" aria-label="العملة"></select><button class="icon-btn cart-btn" id="openCart">السلة <span class="badge" id="cartCount">0</span></button></div>
  </div></header>

  <main class="shell">
    <section class="hero"><div class="hero-box">
      <span class="eyebrow">● تسليم رقمي سريع وآمن</span>
      <h1>كل منتجاتك الرقمية<br>في متجر واحد.</h1>
      <p>تصفّح كتالوج UCHIHA STORE الحقيقي، ابحث عن منتجك، ثم أكمل الطلب بسهولة عبر بوت تيليجرام.</p>
      <div class="hero-actions"><button class="primary" onclick="document.getElementById('products').scrollIntoView()">تصفّح المنتجات</button><button class="secondary" id="heroTelegram">فتح بوت المتجر</button></div>
      <div class="trust"><div><b>تحديث تلقائي</b>الأسعار والتوفر من قاعدة المتجر</div><div><b>دفع وتسليم</b>إكمال آمن من داخل البوت</div><div><b>دعم مباشر</b>متابعة الطلب عبر تيليجرام</div></div>
    </div></section>

    <section id="products">
      <div class="section-head"><div><h2>أقسام المتجر</h2><p>اختر القسم أو ابحث باسم المنتج</p></div><div class="result-count" id="resultCount"></div></div>
      <div class="cats" id="categories"><button class="cat active" data-id="">كل المنتجات</button></div>
      <div class="section-head"><div><h2 id="productsTitle">أحدث المنتجات</h2></div></div>
      <div class="grid" id="productGrid"><div class="loading">جاري تحميل كتالوج المتجر...</div></div>
      <div class="more-wrap"><button class="secondary more" id="loadMore">عرض المزيد</button></div>
    </section>
  </main>

  <footer><div class="shell">© <span id="year"></span> <span id="footerName">UCHIHA STORE</span> — جميع الحقوق محفوظة</div></footer>

  <div class="overlay" id="overlay"></div>
  <aside class="drawer" id="drawer" aria-hidden="true"><div class="drawer-head"><b>سلة المشتريات</b><button class="icon-btn" id="closeCart">إغلاق</button></div><div class="drawer-body" id="cartItems"></div><div class="drawer-foot"><div class="total"><span>الإجمالي</span><span id="cartTotal">0</span></div><button class="primary checkout" id="checkout">إكمال الطلب عبر تيليجرام</button><div class="notice">سيتم نسخ ملخص الطلب وفتح بوت المتجر لإكمال الدفع والتسليم.</div></div></aside>
  <div class="toast" id="toast"></div>

<script>
const state={store:{name:'UCHIHA STORE',currency:'USD',currency_symbol:'$',exchange_rates:{USD:1},telegram_url:''},categories:[],products:[],page:1,pages:1,total:0,category:'',query:'',currency:'USD',cart:JSON.parse(localStorage.getItem('uchiha_cart')||'[]')};
const $=s=>document.querySelector(s);const grid=$('#productGrid');let searchTimer;
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function toast(text){const e=$('#toast');e.textContent=text;e.classList.add('show');clearTimeout(e.t);e.t=setTimeout(()=>e.classList.remove('show'),2200)}
function money(value){const rate=Number(state.store.exchange_rates?.[state.currency]||1);const n=Number(value||0)*rate;try{return new Intl.NumberFormat('ar',{style:'currency',currency:state.currency,maximumFractionDigits:2}).format(n)}catch{return `${n.toFixed(2)} ${state.currency}`}}
function initials(name){const words=String(name||'U').trim().split(/\s+/).slice(0,2);return words.map(w=>w[0]||'').join('').toUpperCase()||'U'}
function saveCart(){localStorage.setItem('uchiha_cart',JSON.stringify(state.cart));renderCart()}
function addCart(id){const p=state.products.find(x=>x.id===id);if(!p)return;const old=state.cart.find(x=>x.id===id);if(old)old.qty+=1;else state.cart.push({...p,qty:1});saveCart();toast('تمت إضافة المنتج إلى السلة')}
function removeCart(id){state.cart=state.cart.filter(x=>x.id!==id);saveCart()}
function cartTotal(){return state.cart.reduce((s,x)=>s+Number(x.price||0)*Number(x.qty||1),0)}
function renderCart(){const body=$('#cartItems');$('#cartCount').textContent=state.cart.reduce((s,x)=>s+x.qty,0);$('#cartTotal').textContent=money(cartTotal());if(!state.cart.length){body.innerHTML='<div class="empty">السلة فارغة حاليًا</div>';return}body.innerHTML=state.cart.map(x=>`<div class="cart-item"><div><b>${esc(x.name)}</b><small>${x.qty} × ${money(x.price)}</small></div><button class="remove" onclick="removeCart(${x.id})">حذف</button></div>`).join('')}
function openCart(){ $('#overlay').classList.add('show');$('#drawer').classList.add('show');$('#drawer').setAttribute('aria-hidden','false') }
function closeCart(){ $('#overlay').classList.remove('show');$('#drawer').classList.remove('show');$('#drawer').setAttribute('aria-hidden','true') }
function renderCurrencies(){const rates=state.store.exchange_rates||{[state.store.currency]:1};const codes=Object.keys(rates);if(!codes.includes(state.store.currency))codes.unshift(state.store.currency);$('#currency').innerHTML=codes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');state.currency=codes.includes(state.currency)?state.currency:state.store.currency;$('#currency').value=state.currency}
function renderCategories(){const roots=state.categories.filter(c=>!c.parent_id&&c.product_count>0);$('#categories').innerHTML=`<button class="cat ${state.category===''?'active':''}" data-id="">كل المنتجات <small>${state.total}</small></button>`+roots.map(c=>`<button class="cat ${String(c.id)===String(state.category)?'active':''}" data-id="${c.id}">${esc(c.name)} <small>${c.product_count}</small></button>`).join('');document.querySelectorAll('.cat').forEach(b=>b.onclick=()=>{state.category=b.dataset.id;state.page=1;loadCatalog(false)})}
function renderProducts(append=false){if(!append)grid.innerHTML='';if(!state.products.length&&!append){grid.innerHTML='<div class="empty">لم يتم العثور على منتجات مطابقة.</div>';return}const html=state.products.map(p=>`<article class="card"><div class="visual"><span class="tag">${esc(p.category_name)}</span>${esc(initials(p.name))}</div><div class="content"><h3>${esc(p.name)}</h3><div class="desc">${esc(p.description)}</div><div class="meta"><div><div class="price">${money(p.price)}</div><div class="delivery">${p.delivery_time?esc(p.delivery_time):'متوفر الآن'}</div></div></div><button class="add" onclick="addCart(${p.id})">أضف إلى السلة</button></div></article>`).join('');grid.insertAdjacentHTML('beforeend',html)}
async function loadCatalog(append=false){if(!append){grid.innerHTML='<div class="loading">جاري تحميل المنتجات...</div>';state.page=1}const params=new URLSearchParams({page:String(state.page),limit:'48'});if(state.category)params.set('category_id',state.category);if(state.query)params.set('q',state.query);try{const r=await fetch('/v1/storefront/public-catalog?'+params.toString(),{headers:{Accept:'application/json'}});if(!r.ok)throw new Error('catalog');const data=await r.json();state.store=data.store||state.store;state.categories=data.categories||[];state.pages=data.products?.pages||0;state.total=data.products?.total||0;const batch=data.products?.items||[];state.products=append?[...state.products,...batch]:batch;document.title=state.store.name;$('#brandName').textContent=state.store.name;$('#footerName').textContent=state.store.name;renderCurrencies();renderCategories();renderProducts(false);$('#resultCount').textContent=`${state.total} منتج`;$('#loadMore').style.display=state.page<state.pages?'inline-block':'none';renderCart()}catch(e){grid.innerHTML='<div class="empty">تعذر تحميل المنتجات الآن. حاول مرة أخرى بعد قليل.</div>';$('#loadMore').style.display='none'}}
function telegramUrl(){return String(state.store.telegram_url||'').trim()}
async function checkout(){if(!state.cart.length){toast('أضف منتجًا إلى السلة أولًا');return}const summary=['طلب جديد من موقع UCHIHA STORE','',...state.cart.map((x,i)=>`${i+1}. ${x.name} × ${x.qty}`),'',`الإجمالي التقريبي: ${money(cartTotal())}`].join('\n');try{await navigator.clipboard.writeText(summary);toast('تم نسخ ملخص الطلب')}catch{}const url=telegramUrl();if(url)window.open(url,'_blank','noopener');else toast('رابط بوت المتجر غير مضبوط بعد')}
$('#searchInput').addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.query=e.target.value.trim();state.page=1;loadCatalog(false)},400)});$('#currency').onchange=e=>{state.currency=e.target.value;renderProducts(false);renderCart()};$('#openCart').onclick=openCart;$('#closeCart').onclick=closeCart;$('#overlay').onclick=closeCart;$('#checkout').onclick=checkout;$('#heroTelegram').onclick=()=>{const u=telegramUrl();u?window.open(u,'_blank','noopener'):toast('رابط بوت المتجر غير مضبوط بعد')};$('#loadMore').onclick=async()=>{state.page+=1;await loadCatalog(true)};$('#year').textContent=new Date().getFullYear();renderCart();loadCatalog(false);
</script>
</body></html>'''


@site_router.get("/", response_class=HTMLResponse, include_in_schema=False)
@site_router.get("/shop", response_class=HTMLResponse, include_in_schema=False)
async def storefront_web() -> HTMLResponse:
    if not _env_flag("STOREFRONT_WEB_ENABLED", True):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    try:
        from storefront_theme import STOREFRONT_HTML

        html_document = STOREFRONT_HTML
    except (ImportError, AttributeError):
        html_document = _STOREFRONT_HTML
    return HTMLResponse(
        html_document,
        headers={
            "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
            "Content-Language": "ar",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "X-Frame-Options": "DENY",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
            "Content-Security-Policy": (
                "default-src 'self'; style-src 'self' 'unsafe-inline'; "
                "script-src 'self' 'unsafe-inline'; connect-src 'self'; "
                "img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"
            ),
        },
    )


def install_storefront_routes(app: FastAPI) -> None:
    """Attach storefront API and web routes once to a FastAPI app."""
    if getattr(app.state, "uchiha_storefront_routes", False):
        return
    app.include_router(router)
    app.include_router(site_router)
    app.state.uchiha_storefront_routes = True


app = FastAPI(
    title="UCHIHA Storefront",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
install_storefront_routes(app)


async def run_storefront_api() -> None:
    """Serve the public read-only catalog and web shop on Railway's HTTP port."""
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
