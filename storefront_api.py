"""Uchiha Store web API, customer app, admin panel and PWA endpoints."""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

import aiosqlite
import uvicorn
from fastapi import APIRouter, Body, Depends, FastAPI, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse

import storefront_core as core


router = APIRouter(prefix="/v1/storefront", tags=["storefront"])
admin_router = APIRouter(prefix="/v1/storefront/admin", tags=["storefront-admin"])
site_router = APIRouter(tags=["storefront-web"])
_READY = False
_READY_LOCK = asyncio.Lock()


def _env_flag(name: str, default: bool = False) -> bool:
    return os.getenv(name, "1" if default else "0").strip().casefold() in {"1", "true", "yes", "on"}


async def _ensure_ready() -> None:
    global _READY
    if _READY:
        return
    async with _READY_LOCK:
        if not _READY:
            await core.ensure_schema()
            _READY = True


def _error(exc: core.StorefrontError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message})


def _cookie_secure(request: Request) -> bool:
    configured = os.getenv("STOREFRONT_COOKIE_SECURE", "").strip()
    if configured:
        return configured.casefold() in {"1", "true", "yes", "on"}
    forwarded = request.headers.get("x-forwarded-proto", "").casefold()
    return forwarded == "https" or request.url.scheme == "https"


def _set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        core.SESSION_COOKIE,
        token,
        max_age=core.SESSION_HOURS * 3600,
        httponly=True,
        secure=_cookie_secure(request),
        samesite="lax",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"


async def _session(request: Request, role: str | None = None) -> core.Session:
    await _ensure_ready()
    session = await core.get_session(request.cookies.get(core.SESSION_COOKIE), role=role)
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "authentication_required", "message": "سجّل الدخول للمتابعة."})
    return session


async def require_customer(request: Request) -> core.Session:
    return await _session(request, "customer")


async def require_admin(request: Request) -> core.Session:
    return await _session(request, "admin")


def _check_csrf(session: core.Session, csrf_token: str | None) -> None:
    if not csrf_token or not secrets_compare(csrf_token, session.csrf_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "invalid_csrf", "message": "انتهت حماية الجلسة؛ حدّث الصفحة وحاول مجددًا."})


def secrets_compare(left: str, right: str) -> bool:
    import hmac
    return hmac.compare_digest(str(left), str(right))


def _decode_image(payload: dict[str, Any], key: str = "image") -> tuple[bytes | None, str]:
    raw = str(payload.get(key) or "").strip()
    if not raw:
        return None, ""
    match = re.fullmatch(r"data:(image/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)", raw)
    if not match:
        raise core.StorefrontError("invalid_image", "صيغة الصورة المرفوعة غير صحيحة.")
    try:
        data = base64.b64decode(re.sub(r"\s+", "", match.group(2)), validate=True)
    except ValueError as exc:
        raise core.StorefrontError("invalid_image", "تعذر قراءة الصورة.") from exc
    if len(data) > core.MAX_IMAGE_BYTES:
        raise core.StorefrontError("image_too_large", "حجم الصورة يجب ألا يتجاوز 3 ميغابايت.")
    return data, match.group(1)


@asynccontextmanager
async def _readonly_db() -> AsyncIterator[aiosqlite.Connection]:
    await _ensure_ready()
    path = core.db_path()
    if not path.exists() or path.stat().st_size == 0:
        raise HTTPException(status_code=503, detail={"code": "store_starting", "message": "بيانات المتجر قيد التجهيز."})
    db: aiosqlite.Connection | None = None
    try:
        db = await aiosqlite.connect(f"{path.as_uri()}?mode=ro", uri=True, timeout=5)
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA query_only=ON")
        await db.execute("PRAGMA busy_timeout=5000")
        yield db
    finally:
        if db is not None:
            await db.close()


def _exchange_rates(base_currency: str) -> dict[str, float]:
    result = {base_currency: 1.0}
    try:
        raw = json.loads(os.getenv("STOREFRONT_EXCHANGE_RATES", "{}") or "{}")
    except json.JSONDecodeError:
        raw = {}
    if isinstance(raw, dict):
        for key, value in raw.items():
            try:
                numeric = float(value)
            except (TypeError, ValueError):
                continue
            code = str(key).strip().upper()[:8]
            if code and numeric > 0:
                result[code] = numeric
    result[base_currency] = 1.0
    return result


async def _fetch_categories(db: aiosqlite.Connection) -> list[dict[str, Any]]:
    try:
        async with db.execute(
            """
            SELECT c.id, COALESCE(NULLIF(c.display_name,''),c.name) name,
                   COALESCE(c.local_parent_id,c.parent_id,0) parent_id,
                   COALESCE(c.local_sort_order,c.sort_order,0) sort_order,
                   COALESCE(m.accent,'#e4313f') accent,
                   COALESCE(m.image_mime,'') image_mime,
                   COALESCE(m.updated_at,'') media_updated
            FROM categories c LEFT JOIN storefront_category_media m ON m.category_id=c.id
            WHERE c.is_active=1 AND COALESCE(c.is_hidden,0)=0
            ORDER BY sort_order,name
            """
        ) as cursor:
            rows = await cursor.fetchall()
    except aiosqlite.Error:
        return []
    items = [{
        "id": int(row["id"]), "name": str(row["name"] or "قسم"),
        "parent_id": int(row["parent_id"] or 0), "sort_order": int(row["sort_order"] or 0),
        "accent": str(row["accent"] or "#e4313f"), "product_count": 0,
        "image_url": f"/v1/storefront/media/category/{row['id']}?v={str(row['media_updated']).replace(' ','')}",
    } for row in rows]
    allowed = {item["id"] for item in items}
    parents = {item["id"]: item["parent_id"] if item["parent_id"] in allowed else 0 for item in items}
    try:
        async with db.execute(
            "SELECT p.category_id,COUNT(*) count FROM products p JOIN categories c ON c.id=p.category_id "
            "WHERE p.is_active=1 AND p.stock>0 AND c.is_active=1 AND COALESCE(c.is_hidden,0)=0 GROUP BY p.category_id"
        ) as cursor:
            counts = await cursor.fetchall()
    except aiosqlite.Error:
        counts = []
    count_map = {item["id"]: 0 for item in items}
    for row in counts:
        current, count, seen = int(row[0] or 0), int(row[1] or 0), set()
        while current in count_map and current not in seen:
            seen.add(current)
            count_map[current] += count
            current = parents.get(current, 0)
    for item in items:
        item["parent_id"] = parents[item["id"]]
        item["product_count"] = count_map[item["id"]]
    return items


def _category_filter(category_id: int | None) -> tuple[str, list[Any]]:
    if category_id is None:
        return "", []
    return (
        """WITH RECURSIVE category_tree(id) AS (
               SELECT ? UNION SELECT c.id FROM categories c JOIN category_tree t
               ON COALESCE(c.local_parent_id,c.parent_id,0)=t.id
               WHERE c.is_active=1 AND COALESCE(c.is_hidden,0)=0)
        """,
        [category_id],
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
    page, limit = max(1, page), max(1, min(100, limit))
    query = str(query or "").strip()[:100]
    prefix, params = _category_filter(category_id)
    filters = ["p.is_active=1", "p.stock>0", "c.is_active=1", "COALESCE(c.is_hidden,0)=0"]
    values: list[Any] = []
    if category_id is not None:
        filters.append("p.category_id IN (SELECT id FROM category_tree)")
    if query:
        filters.append("(LOWER(p.name) LIKE LOWER(?) OR LOWER(COALESCE(p.description,'')) LIKE LOWER(?))")
        values.extend([f"%{query}%", f"%{query}%"])
    where = " AND ".join(filters)
    try:
        async with db.execute(f"{prefix} SELECT COUNT(*) FROM products p JOIN categories c ON c.id=p.category_id WHERE {where}", [*params, *values]) as cursor:
            total = int((await cursor.fetchone())[0] or 0)
        async with db.execute(
            f"""{prefix}
            SELECT p.id,p.category_id,p.name,COALESCE(p.description,'') description,p.price,p.stock,
                   COALESCE(p.product_type,'stock') product_type,COALESCE(p.delivery_time,'') delivery_time,
                   COALESCE(p.has_variants,0) has_variants,COALESCE(p.api_provider,'') provider,
                   COALESCE(NULLIF(c.display_name,''),c.name) category_name,
                   COALESCE(m.accent,'#e4313f') accent
            FROM products p JOIN categories c ON c.id=p.category_id
            LEFT JOIN storefront_category_media m ON m.category_id=p.category_id
            WHERE {where}
            ORDER BY COALESCE(c.local_sort_order,c.sort_order,0),COALESCE(p.sort_order,0),p.name,p.id
            LIMIT ? OFFSET ?""",
            [*params, *values, limit, (page - 1) * limit],
        ) as cursor:
            rows = await cursor.fetchall()
    except aiosqlite.Error:
        return {"page": page, "limit": limit, "total": 0, "pages": 0, "items": []}
    items = [{
        "id": int(row["id"]), "category_id": int(row["category_id"] or 0),
        "category_name": str(row["category_name"] or "منتجات رقمية"), "name": str(row["name"]),
        "description": core.clean_text(row["description"], 1000), "price": round(float(row["price"] or 0), 2),
        "stock": int(row["stock"] or 0), "available": int(row["stock"] or 0) > 0,
        "product_type": str(row["product_type"]), "delivery_time": str(row["delivery_time"]),
        "has_variants": bool(row["has_variants"]), "provider": str(row["provider"]),
        "accent": str(row["accent"] or "#e4313f"),
        "image_url": f"/v1/storefront/media/category/{int(row['category_id'] or 0)}",
    } for row in rows]
    return {"page": page, "limit": limit, "total": total, "pages": (total + limit - 1) // limit if total else 0, "items": items}


async def _public_store() -> dict[str, Any]:
    settings = await core.get_settings()
    currency = (settings.get("currency") or os.getenv("STOREFRONT_CURRENCY_CODE", "USD") or "USD").upper()[:8]
    telegram_url = os.getenv("STOREFRONT_TELEGRAM_URL", "").strip()
    return {
        "name": settings.get("store_name", "Uchiha Store"), "tagline": settings.get("tagline", ""),
        "announcement": settings.get("announcement", ""), "currency": currency,
        "currency_symbol": settings.get("currency_symbol", "$"), "exchange_rates": _exchange_rates(currency),
        "telegram_url": telegram_url,
        "support": {
            "telegram": settings.get("support_telegram", ""), "whatsapp": settings.get("support_whatsapp", ""),
            "email": settings.get("support_email", ""), "hours": settings.get("support_hours", ""),
        },
        "theme": {
            "primary": settings.get("primary_color", "#e4313f"), "secondary": settings.get("secondary_color", "#9f111b"),
            "accent": settings.get("accent_color", "#d7d9de"),
        },
        "hero_interval_ms": int(settings.get("hero_interval_ms", "5200") or 5200),
        "pwa": True,
    }


@router.get("/health")
async def health() -> dict[str, Any]:
    await _ensure_ready()
    path = core.db_path()
    return {"status": "ok" if path.exists() and path.stat().st_size else "starting", "service": "uchiha-storefront", "version": 3}


@router.get("/public-catalog")
async def public_catalog(
    response: Response,
    category_id: int | None = Query(default=None, ge=1),
    q: str = Query(default="", max_length=100),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=48, ge=1, le=100),
) -> dict[str, Any]:
    if not _env_flag("STOREFRONT_PUBLIC_CATALOG_ENABLED", True):
        raise HTTPException(status_code=404)
    async with _readonly_db() as db:
        categories = await _fetch_categories(db)
        products = await _fetch_products(db, categories, category_id=category_id, query=q, page=page, limit=limit)
    response.headers["Cache-Control"] = "public,max-age=20,stale-while-revalidate=60"
    return {"version": 3, "store": await _public_store(), "banners": await core.get_banners(), "categories": categories, "products": products}


@router.get("/product/{product_id}")
async def product(product_id: int) -> dict[str, Any]:
    await _ensure_ready()
    try:
        return await core.product_detail(product_id)
    except core.StorefrontError as exc:
        raise _error(exc) from exc


@router.post("/auth/signup")
async def signup(request: Request, payload: dict[str, Any] = Body(...)) -> JSONResponse:
    await _ensure_ready()
    try:
        account = await core.create_account(payload)
        token, session = await core.issue_session(account_id=int(account["id"]), role="customer")
    except core.StorefrontError as exc:
        raise _error(exc) from exc
    response = JSONResponse({"account": account, "csrf_token": session.csrf_token})
    _set_session_cookie(response, request, token)
    return response


@router.post("/auth/login")
async def login(request: Request, payload: dict[str, Any] = Body(...)) -> JSONResponse:
    await _ensure_ready()
    try:
        account_row = await core.authenticate(str(payload.get("identifier", "")), str(payload.get("password", "")))
        token, session = await core.issue_session(account_id=int(account_row["id"]), role="customer")
        account = await core.get_account(int(account_row["id"]))
    except core.StorefrontError as exc:
        raise _error(exc) from exc
    response = JSONResponse({"account": account, "csrf_token": session.csrf_token})
    _set_session_cookie(response, request, token)
    return response


@router.post("/auth/logout")
async def logout(request: Request, response: Response) -> dict[str, bool]:
    await core.revoke_session(request.cookies.get(core.SESSION_COOKIE))
    response.delete_cookie(core.SESSION_COOKIE, path="/")
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True}


@router.get("/me")
async def me(session: core.Session = Depends(require_customer)) -> dict[str, Any]:
    return {"account": await core.get_account(session.account_id), "csrf_token": session.csrf_token}


@router.get("/wallet")
async def wallet(session: core.Session = Depends(require_customer)) -> dict[str, Any]:
    return await core.wallet_history(session.account_id)


@router.get("/orders")
async def orders(session: core.Session = Depends(require_customer)) -> dict[str, Any]:
    return {"items": await core.account_orders(session.account_id)}


@router.post("/purchase/{product_id}")
async def buy_product(
    product_id: int,
    payload: dict[str, Any] = Body(...),
    session: core.Session = Depends(require_customer),
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    _check_csrf(session, csrf_token)
    try:
        return await core.purchase(session.account_id, product_id, payload, idempotency_key or "")
    except core.StorefrontError as exc:
        raise _error(exc) from exc


@router.post("/bot-link")
async def bot_link(
    session: core.Session = Depends(require_customer),
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> dict[str, Any]:
    _check_csrf(session, csrf_token)
    store = await _public_store()
    return await core.create_link_code(session.account_id, store["telegram_url"])


@router.get("/payment-methods")
async def get_payment_methods(session: core.Session = Depends(require_customer)) -> dict[str, Any]:
    return {"items": await core.payment_methods()}


@router.post("/deposits")
async def create_deposit(
    payload: dict[str, Any] = Body(...),
    session: core.Session = Depends(require_customer),
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> dict[str, Any]:
    _check_csrf(session, csrf_token)
    try:
        proof, proof_mime = _decode_image(payload, "proof")
        return await core.create_deposit(
            session.account_id, int(payload.get("method_id") or 0), float(payload.get("amount") or 0),
            str(payload.get("reference") or ""), proof, proof_mime,
        )
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail={"code": "invalid_deposit", "message": "بيانات طلب الشحن غير صحيحة."})
    except core.StorefrontError as exc:
        raise _error(exc) from exc


@router.post("/deposits/{request_id}/verify")
async def verify_auto_deposit(
    request_id: int,
    payload: dict[str, Any] = Body(...),
    session: core.Session = Depends(require_customer),
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> dict[str, Any]:
    _check_csrf(session, csrf_token)
    try:
        return await core.verify_auto_deposit(
            session.account_id,
            request_id,
            str(payload.get("reference") or ""),
        )
    except core.StorefrontError as exc:
        raise _error(exc) from exc


@router.get("/media/{kind}/{item_id}")
async def media(kind: str, item_id: int, request: Request) -> Response:
    await _ensure_ready()
    if kind == "deposit" and not await core.get_session(
        request.cookies.get(core.SESSION_COOKIE), role="admin"
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    item = await core.read_media(kind, item_id)
    if item:
        data, mime = item
        cache_control = "private,no-store" if kind == "deposit" else "public,max-age=3600"
        return Response(data, media_type=mime, headers={"Cache-Control": cache_control, "X-Content-Type-Options": "nosniff"})
    if kind not in {"banner", "category"}:
        raise HTTPException(status_code=404)
    accent = "#e4313f" if item_id % 3 == 0 else "#9f111b" if item_id % 3 == 1 else "#d7d9de"
    variant = ("ninja", "portal", "energy")[item_id % 3]
    svg = _default_art_svg(accent, variant, compact=kind == "category")
    return Response(svg, media_type="image/svg+xml", headers={"Cache-Control": "public,max-age=86400", "X-Content-Type-Options": "nosniff"})


@site_router.get("/assets/{filename}", include_in_schema=False)
async def generated_asset(filename: str) -> FileResponse:
    allowed = {
        "hero-madara-v2.webp",
        "hero-obito-v2.webp",
        "hero-itachi-sasuke-v2.webp",
        "uchiha-hero-portal.webp",
        "uchiha-hero-market.webp",
        "uchiha-hero-link.webp",
    }
    if filename not in allowed:
        raise HTTPException(status_code=404)
    path = Path(__file__).resolve().with_name("static") / filename
    if not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(
        path,
        media_type="image/webp",
        headers={"Cache-Control": "public,max-age=86400,immutable", "X-Content-Type-Options": "nosniff"},
    )


def _default_art_svg(accent: str, variant: str, compact: bool = False) -> str:
    width, height = (720, 720) if compact else (1500, 640)
    uid = re.sub(r"[^a-z]", "", variant)[:12] or "ninja"
    circles = "".join(
        f'<circle cx="{120 + index * 170}" cy="{95 + (index % 2) * 330}" r="{18 + index * 7}" fill="none" stroke="{accent}" stroke-opacity="{0.08 + index * 0.02}"/>'
        for index in range(7)
    )
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
    <defs><linearGradient id="g{uid}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#08090d"/><stop offset=".55" stop-color="#171217"/><stop offset="1" stop-color="#09090e"/></linearGradient><radialGradient id="r{uid}"><stop stop-color="{accent}" stop-opacity=".62"/><stop offset="1" stop-color="{accent}" stop-opacity="0"/></radialGradient><filter id="b{uid}"><feGaussianBlur stdDeviation="28"/></filter></defs>
    <rect width="100%" height="100%" fill="url(#g{uid})"/><circle cx="{width*.76}" cy="{height*.43}" r="{height*.55}" fill="url(#r{uid})" filter="url(#b{uid})"/>{circles}
    <g transform="translate({width*.69} {height*.12})" fill="#05070b" stroke="{accent}" stroke-width="5" stroke-opacity=".7"><path d="M160 30l54 88-24 39 40 170-67 124-79-121 39-170-26-40z"/><path d="M112 138q52-52 104 0l-24 31-54 1z" fill="#dffcff" fill-opacity=".9"/><path d="M137 151l19-7-11 17zm35-7l20 7-10 10z" fill="{accent}" stroke="none"/><path d="M96 205l-79 92 98-38m99-53l86 89-105-36" fill="none" stroke-linecap="round"/></g>
    <path d="M0 {height*.83}C{width*.25} {height*.68} {width*.52} {height*.98} {width} {height*.72}V{height}H0Z" fill="#04060a" fill-opacity=".82"/>
    </svg>'''


@admin_router.post("/auth/login")
async def admin_login(request: Request, payload: dict[str, Any] = Body(...)) -> JSONResponse:
    await _ensure_ready()
    try:
        await core.authenticate_admin(str(payload.get("username", "")), str(payload.get("password", "")))
        token, session = await core.issue_session(role="admin")
    except core.StorefrontError as exc:
        raise _error(exc) from exc
    await core.audit("admin", "admin_login")
    response = JSONResponse({"ok": True, "csrf_token": session.csrf_token})
    _set_session_cookie(response, request, token)
    return response


@admin_router.get("/me")
async def admin_me(session: core.Session = Depends(require_admin)) -> dict[str, Any]:
    return {"role": "admin", "csrf_token": session.csrf_token}


@admin_router.get("/dashboard")
async def dashboard(session: core.Session = Depends(require_admin)) -> dict[str, Any]:
    return await core.admin_dashboard()


@admin_router.get("/settings")
async def admin_settings(session: core.Session = Depends(require_admin)) -> dict[str, Any]:
    return await core.get_settings()


@admin_router.put("/settings")
async def save_settings(
    payload: dict[str, Any] = Body(...),
    session: core.Session = Depends(require_admin),
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> dict[str, Any]:
    _check_csrf(session, csrf_token)
    try:
        return await core.update_settings(payload)
    except core.StorefrontError as exc:
        raise _error(exc) from exc


@admin_router.get("/banners")
async def admin_banners(session: core.Session = Depends(require_admin)) -> dict[str, Any]:
    return {"items": await core.get_banners(include_disabled=True)}


@admin_router.post("/banners")
async def admin_save_banner(
    payload: dict[str, Any] = Body(...),
    session: core.Session = Depends(require_admin),
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> dict[str, Any]:
    _check_csrf(session, csrf_token)
    try:
        image, mime = _decode_image(payload)
        return await core.save_banner(payload, image, mime)
    except core.StorefrontError as exc:
        raise _error(exc) from exc


@admin_router.delete("/banners/{banner_id}")
async def admin_delete_banner(
    banner_id: int,
    session: core.Session = Depends(require_admin),
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> dict[str, bool]:
    _check_csrf(session, csrf_token)
    try:
        await core.delete_banner(banner_id)
        return {"ok": True}
    except core.StorefrontError as exc:
        raise _error(exc) from exc


@admin_router.get("/categories")
async def admin_categories(session: core.Session = Depends(require_admin)) -> dict[str, Any]:
    async with aiosqlite.connect(core.db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT c.id,c.name,COALESCE(c.display_name,'') display_name,
                   COALESCE(c.local_parent_id,c.parent_id,0) parent_id,
                   COALESCE(c.local_sort_order,c.sort_order,0) sort_order,
                   COALESCE(c.is_hidden,0) is_hidden,COALESCE(c.is_active,0) is_active,
                   (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.is_active=1) product_count,
                   COALESCE(m.accent,'#e4313f') accent,COALESCE(m.image_mime,'') image_mime
            FROM categories c LEFT JOIN storefront_category_media m ON m.category_id=c.id
            ORDER BY parent_id,sort_order,c.name
            """
        ) as cursor:
            rows = await cursor.fetchall()
    return {"items": [{**dict(row), "image_url": f"/v1/storefront/media/category/{row['id']}"} for row in rows]}


@admin_router.put("/categories/{category_id}")
async def admin_update_category(
    category_id: int,
    payload: dict[str, Any] = Body(...),
    session: core.Session = Depends(require_admin),
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> dict[str, bool]:
    _check_csrf(session, csrf_token)
    display_name = core.clean_text(payload.get("display_name"), 100)
    try:
        sort_order = max(-10000, min(10000, int(payload.get("sort_order") or 0)))
    except (TypeError, ValueError):
        sort_order = 0
    hidden = 1 if bool(payload.get("is_hidden")) else 0
    try:
        image, mime = _decode_image(payload)
        async with aiosqlite.connect(core.db_path()) as db:
            changed = await db.execute(
                "UPDATE categories SET display_name=?,local_sort_order=?,is_hidden=? WHERE id=?",
                (display_name, sort_order, hidden, category_id),
            )
            await db.commit()
        if changed.rowcount != 1:
            raise core.StorefrontError("category_not_found", "القسم غير موجود.", 404)
        if image:
            await core.save_category_media(category_id, image, mime, str(payload.get("accent") or "#e4313f"))
        await core.audit("admin", "category_update", str(category_id))
        return {"ok": True}
    except core.StorefrontError as exc:
        raise _error(exc) from exc


@admin_router.get("/accounts")
async def accounts(session: core.Session = Depends(require_admin)) -> dict[str, Any]:
    return {"items": await core.admin_accounts()}


@admin_router.post("/accounts/{account_id}/balance")
async def adjust_balance(
    account_id: int,
    payload: dict[str, Any] = Body(...),
    session: core.Session = Depends(require_admin),
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> dict[str, Any]:
    _check_csrf(session, csrf_token)
    try:
        return await core.admin_adjust_balance(account_id, float(payload.get("amount") or 0), str(payload.get("reason") or ""))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail={"code": "invalid_amount", "message": "المبلغ غير صحيح."})
    except core.StorefrontError as exc:
        raise _error(exc) from exc


@admin_router.get("/deposits")
async def deposits(session: core.Session = Depends(require_admin)) -> dict[str, Any]:
    return {"items": await core.admin_deposits()}


@admin_router.post("/deposits/{request_id}/review")
async def review_deposit(
    request_id: int,
    payload: dict[str, Any] = Body(...),
    session: core.Session = Depends(require_admin),
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> dict[str, Any]:
    _check_csrf(session, csrf_token)
    try:
        return await core.admin_review_deposit(request_id, str(payload.get("decision") or ""), str(payload.get("note") or ""))
    except core.StorefrontError as exc:
        raise _error(exc) from exc


@admin_router.get("/orders")
async def admin_orders(session: core.Session = Depends(require_admin)) -> dict[str, Any]:
    async with aiosqlite.connect(core.db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT o.id,o.user_id,o.quantity,o.total_price,o.status,o.order_date,
                   COALESCE(o.api_status,'') api_status,COALESCE(o.api_order_id,'') api_order_id,
                   COALESCE(o.delivery_info,'') delivery_info,COALESCE(p.name,'منتج') product_name,
                   a.username,a.email
            FROM orders o LEFT JOIN products p ON p.id=o.product_id
            LEFT JOIN web_accounts a ON a.user_id=o.user_id ORDER BY o.id DESC LIMIT 200
            """
        ) as cursor:
            rows = await cursor.fetchall()
    return {"items": [dict(row) for row in rows]}


@admin_router.get("/payment-methods")
async def admin_payment_methods(session: core.Session = Depends(require_admin)) -> dict[str, Any]:
    async with aiosqlite.connect(core.db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM payment_methods ORDER BY sort_order,id") as cursor:
            rows = await cursor.fetchall()
    return {"items": [dict(row) for row in rows]}


@admin_router.put("/payment-methods/{method_id}")
async def admin_update_payment_method(
    method_id: int,
    payload: dict[str, Any] = Body(...),
    session: core.Session = Depends(require_admin),
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> dict[str, bool]:
    _check_csrf(session, csrf_token)
    allowed = ("name", "details", "transfer_label", "transfer_value", "currency")
    values = [core.clean_text(payload.get(key), 1000 if key == "details" else 180) for key in allowed]
    try:
        numbers = [float(payload.get(key) or 0) for key in ("min_amount", "max_amount", "credit_rate", "fixed_fee", "fee_percent")]
        active = 1 if bool(payload.get("is_active")) else 0
        proof_required = 1 if bool(payload.get("proof_required")) else 0
        sort_order = int(payload.get("sort_order") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail={"code": "invalid_method", "message": "بيانات طريقة الدفع غير صحيحة."})
    async with aiosqlite.connect(core.db_path()) as db:
        changed = await db.execute(
            "UPDATE payment_methods SET name=?,details=?,transfer_label=?,transfer_value=?,currency=?,"
            "min_amount=?,max_amount=?,credit_rate=?,fixed_fee=?,fee_percent=?,is_active=?,proof_required=?,"
            "sort_order=?,is_manually_edited=1,status_override=? WHERE id=?",
            (*values, *numbers, active, proof_required, sort_order, active, method_id),
        )
        await db.commit()
    if changed.rowcount != 1:
        raise HTTPException(status_code=404, detail={"code": "method_not_found", "message": "طريقة الدفع غير موجودة."})
    await core.audit("admin", "payment_method_update", str(method_id))
    return {"ok": True}


@admin_router.post("/sync")
async def admin_sync(
    payload: dict[str, Any] = Body(default={}),
    session: core.Session = Depends(require_admin),
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> dict[str, Any]:
    _check_csrf(session, csrf_token)
    mode = str(payload.get("mode") or "quick").casefold()
    if mode not in {"quick", "full"}:
        mode = "quick"
    import bot as store
    result = await store.sync_products_from_api(mode=mode)
    await core.audit("admin", "js4_sync", mode)
    return result


_STOREFRONT_HTML = "<!doctype html><html lang='ar' dir='rtl'><meta charset='utf-8'><title>Uchiha Store</title><body style='background:#08090d;color:white;font-family:sans-serif;padding:30px'>Uchiha Store</body></html>"


def _html_headers() -> dict[str, str]:
    return {
        "Cache-Control": "no-cache",
        "Content-Language": "ar",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Frame-Options": "DENY",
        "Permissions-Policy": "camera=(),microphone=(),geolocation=()",
        "Content-Security-Policy": (
            "default-src 'self';style-src 'self' 'unsafe-inline';script-src 'self' 'unsafe-inline';"
            "connect-src 'self';img-src 'self' data: blob:;font-src 'self';frame-ancestors 'none';"
            "base-uri 'self';form-action 'self';object-src 'none';worker-src 'self';manifest-src 'self'"
        ),
    }


@site_router.get("/", response_class=HTMLResponse, include_in_schema=False)
@site_router.get("/shop", response_class=HTMLResponse, include_in_schema=False)
async def storefront_web() -> HTMLResponse:
    if not _env_flag("STOREFRONT_WEB_ENABLED", True):
        raise HTTPException(status_code=404)
    try:
        from storefront_theme import STOREFRONT_HTML
        document = STOREFRONT_HTML
    except (ImportError, AttributeError):
        document = _STOREFRONT_HTML
    return HTMLResponse(document, headers=_html_headers())


@site_router.get("/admin", response_class=HTMLResponse, include_in_schema=False)
async def admin_web() -> HTMLResponse:
    try:
        from storefront_admin_theme import ADMIN_HTML
        document = ADMIN_HTML
    except (ImportError, AttributeError):
        document = _STOREFRONT_HTML
    return HTMLResponse(document, headers=_html_headers())


@site_router.get("/manifest.webmanifest", include_in_schema=False)
async def manifest() -> JSONResponse:
    settings = await core.get_settings() if _READY else {"store_name": "Uchiha Store", "primary_color": "#e4313f"}
    return JSONResponse(
        {
            "name": settings.get("store_name", "Uchiha Store"), "short_name": "Uchiha",
            "description": "متجر Uchiha للمنتجات والخدمات الرقمية", "lang": "ar", "dir": "rtl",
            "start_url": "/", "scope": "/", "display": "standalone", "orientation": "portrait-primary",
            "background_color": "#08090d", "theme_color": settings.get("primary_color", "#e4313f"),
            "icons": [{"src": "/app-icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable"}],
        },
        media_type="application/manifest+json",
        headers={"Cache-Control": "public,max-age=300"},
    )


@site_router.get("/app-icon.svg", include_in_schema=False)
async def app_icon() -> Response:
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e4313f"/><stop offset=".58" stop-color="#9f111b"/><stop offset="1" stop-color="#d7d9de"/></linearGradient></defs><rect width="512" height="512" rx="120" fill="#09090e"/><path d="M115 118h71v174l70 92-71 20-70-86zm282 0h-71v174l-70 92 71 20 70-86zM205 115h102l-51 92z" fill="url(#g)"/><circle cx="256" cy="266" r="43" fill="none" stroke="#fff5f6" stroke-width="18"/><path d="M211 267h90" stroke="#fff5f6" stroke-width="18" stroke-linecap="round"/></svg>'''
    return Response(svg, media_type="image/svg+xml", headers={"Cache-Control": "public,max-age=86400"})


@site_router.get("/sw.js", include_in_schema=False)
async def service_worker() -> PlainTextResponse:
    script = """const CACHE='uchiha-v4';const SHELL=['/','/manifest.webmanifest','/app-icon.svg','/assets/hero-madara-v2.webp','/assets/hero-obito-v2.webp','/assets/hero-itachi-sasuke-v2.webp'];self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).pathname.startsWith('/v1/'))return;e.respondWith(fetch(e.request).then(r=>{const x=r.clone();caches.open(CACHE).then(c=>c.put(e.request,x));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/'))))});"""
    return PlainTextResponse(script, media_type="application/javascript", headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})


def install_storefront_routes(app: FastAPI) -> None:
    if getattr(app.state, "uchiha_storefront_routes", False):
        return
    app.include_router(router)
    app.include_router(admin_router)
    app.include_router(site_router)
    app.state.uchiha_storefront_routes = True


app = FastAPI(title="Uchiha Store", docs_url=None, redoc_url=None, openapi_url=None)
install_storefront_routes(app)


async def run_storefront_api() -> None:
    await _ensure_ready()
    try:
        port = int(os.getenv("API_PORT", os.getenv("PORT", "8080")) or 8080)
    except ValueError:
        port = 8080
    server = uvicorn.Server(
        uvicorn.Config(
            app, host=os.getenv("STOREFRONT_HOST", "0.0.0.0") or "0.0.0.0", port=port,
            log_level=os.getenv("LOG_LEVEL", "info").casefold(), access_log=False, lifespan="off",
        )
    )
    await server.serve()


__all__ = ["app", "install_storefront_routes", "run_storefront_api", "core"]
