"""HTTP routes for storefront branding, policies, and product overrides."""
from __future__ import annotations
import html as html_lib
from typing import Any
import aiosqlite
from fastapi import Body, Depends, Header, HTTPException, Query, Response
from fastapi.responses import HTMLResponse, JSONResponse
from storefront_management_data import _clean_text

_POLICY_LABELS = {
    "privacy": ("سياسة الخصوصية", "privacy_policy"),
    "terms": ("الشروط والأحكام", "terms_policy"),
    "refund": ("سياسة الاسترجاع", "refund_policy"),
}

def _branding_svg(kind: str) -> bytes:
    if kind == "logo":
        svg = """<svg xmlns='http://www.w3.org/2000/svg' width='900' height='260' viewBox='0 0 900 260'>
        <rect width='900' height='260' rx='52' fill='#09090e'/>
        <g transform='translate(38 28)'><circle cx='102' cy='102' r='94' fill='#15151c' stroke='#e4313f' stroke-width='8'/>
        <path d='M48 43h39v94l38 50-39 11-38-47zm108 0h-39v94l-38 50 39 11 38-47zM96 42h56l-28 51z' fill='#e4313f'/>
        <circle cx='102' cy='124' r='24' fill='none' stroke='#fff' stroke-width='10'/></g>
        <text x='265' y='122' fill='#fff' font-family='Tahoma,Arial' font-size='68' font-weight='700'>Uchiha Store</text>
        <text x='268' y='177' fill='#c8c3c5' font-family='Tahoma,Arial' font-size='28'>Digital Store Platform</text></svg>"""
    else:
        svg = """<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'>
        <rect width='512' height='512' rx='120' fill='#09090e'/>
        <path d='M115 118h71v174l70 92-71 20-70-86zm282 0h-71v174l-70 92 71 20 70-86zM205 115h102l-51 92z' fill='#e4313f'/>
        <circle cx='256' cy='266' r='43' fill='none' stroke='#fff5f6' stroke-width='18'/></svg>"""
    return svg.encode("utf-8")

async def _read_branding(core: Any, kind: str) -> tuple[bytes, str, str]:
    async with aiosqlite.connect(core.db_path()) as db:
        async with db.execute(
            "SELECT image_blob,image_mime,updated_at FROM storefront_branding WHERE kind=?",
            (kind,),
        ) as cursor:
            row = await cursor.fetchone()
    if row and row[0] and row[1]:
        return bytes(row[0]), str(row[1]), str(row[2] or "")
    return _branding_svg(kind), "image/svg+xml", "default"

def _policy_document(title: str, content: str, store_name: str) -> str:
    safe_title = html_lib.escape(title)
    safe_store = html_lib.escape(store_name or "Uchiha Store")
    safe_content = html_lib.escape(content or "لا يوجد نص منشور حاليًا.").replace("\n", "<br>")
    return f"""<!doctype html><html lang='ar' dir='rtl'><head><meta charset='utf-8'>
    <meta name='viewport' content='width=device-width,initial-scale=1'><title>{safe_title} - {safe_store}</title>
    <style>body{{margin:0;background:#08090d;color:#f7f4f5;font-family:Tahoma,Arial,sans-serif}}
    main{{width:min(880px,calc(100% - 28px));margin:45px auto;padding:28px;border:1px solid rgba(228,49,63,.2);border-radius:24px;background:#121218}}
    h1{{margin-top:0;color:#ff6875}}p{{line-height:2;color:#ded9db;white-space:normal}}a{{color:#fff;text-decoration:none;display:inline-block;margin-top:20px;padding:12px 18px;border-radius:12px;background:#e4313f}}</style></head>
    <body><main><h1>{safe_title}</h1><p>{safe_content}</p><a href='/'>العودة إلى المتجر</a></main></body></html>"""

def _install_routes(api_module: Any) -> None:
    app = api_module.app
    core = api_module.core
    if getattr(app.state, "uchiha_storefront_management_routes", False):
        return

    async def branding(kind: str) -> Response:
        normalized = str(kind or "").casefold()
        if normalized not in {"logo", "icon"}:
            raise HTTPException(status_code=404)
        await api_module._ensure_ready()
        data, mime, stamp = await _read_branding(core, normalized)
        return Response(
            data,
            media_type=mime,
            headers={
                "Cache-Control": "public,max-age=300",
                "ETag": f'"{normalized}-{stamp}"',
                "X-Content-Type-Options": "nosniff",
            },
        )

    async def admin_branding(
        session: Any = Depends(api_module.require_admin),
    ) -> dict[str, Any]:
        del session
        async with aiosqlite.connect(core.db_path()) as db:
            async with db.execute("SELECT kind,image_mime,updated_at FROM storefront_branding") as cursor:
                rows = await cursor.fetchall()
        found = {str(row[0]): row for row in rows}
        return {
            "logo": {
                "has_image": bool(found.get("logo") and found["logo"][1]),
                "url": "/v1/storefront/branding/logo",
            },
            "icon": {
                "has_image": bool(found.get("icon") and found["icon"][1]),
                "url": "/v1/storefront/branding/icon",
            },
        }

    async def save_branding_route(
        kind: str,
        payload: dict[str, Any] = Body(...),
        session: Any = Depends(api_module.require_admin),
        csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
    ) -> dict[str, Any]:
        api_module._check_csrf(session, csrf_token)
        normalized = str(kind or "").casefold()
        if normalized not in {"logo", "icon"}:
            raise HTTPException(status_code=404)
        if bool(payload.get("delete")):
            async with aiosqlite.connect(core.db_path()) as db:
                await db.execute("DELETE FROM storefront_branding WHERE kind=?", (normalized,))
                await db.commit()
            await core.audit("admin", "branding_delete", normalized)
            return {"ok": True, "url": f"/v1/storefront/branding/{normalized}"}
        try:
            image, mime = api_module._decode_image(payload)
        except core.StorefrontError as exc:
            raise api_module._error(exc) from exc
        if not image:
            raise HTTPException(
                status_code=400,
                detail={"code": "image_required", "message": "اختر صورة أولاً."},
            )
        async with aiosqlite.connect(core.db_path()) as db:
            await db.execute(
                "INSERT INTO storefront_branding(kind,image_blob,image_mime,updated_at) VALUES (?,?,?,?) "
                "ON CONFLICT(kind) DO UPDATE SET image_blob=excluded.image_blob,image_mime=excluded.image_mime,updated_at=excluded.updated_at",
                (normalized, image, mime, core.now_text()),
            )
            await db.commit()
        await core.audit("admin", "branding_update", normalized)
        return {"ok": True, "url": f"/v1/storefront/branding/{normalized}?v={core.now_text().replace(' ', '')}"}

    async def admin_products(
        q: str = Query(default="", max_length=100),
        visibility: str = Query(default="all", max_length=20),
        limit: int = Query(default=200, ge=1, le=500),
        session: Any = Depends(api_module.require_admin),
    ) -> dict[str, Any]:
        del session
        await api_module._ensure_ready()
        filters = ["1=1"]
        values: list[Any] = []
        clean_q = str(q or "").strip()
        if clean_q:
            filters.append("(LOWER(p.name) LIKE LOWER(?) OR LOWER(COALESCE(o.display_name,'')) LIKE LOWER(?))")
            values.extend([f"%{clean_q}%", f"%{clean_q}%"])
        normalized_visibility = str(visibility or "all").casefold()
        if normalized_visibility == "visible":
            filters.append("COALESCE(o.is_hidden,0)=0")
        elif normalized_visibility == "hidden":
            filters.append("COALESCE(o.is_hidden,0)=1")
        where = " AND ".join(filters)
        async with aiosqlite.connect(core.db_path()) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                f"""SELECT p.id,p.name original_name,COALESCE(o.display_name,'') display_name,
                           p.price,p.stock,COALESCE(p.api_provider,'') provider,
                           COALESCE(NULLIF(c.display_name,''),c.name,'') category_name,
                           COALESCE(o.is_hidden,0) is_hidden,
                           COALESCE(o.sort_order,p.sort_order,0) sort_order,
                           CASE WHEN o.product_id IS NULL THEN 0 ELSE 1 END has_override
                    FROM products p LEFT JOIN categories c ON c.id=p.category_id
                    LEFT JOIN storefront_product_overrides o ON o.product_id=p.id
                    WHERE {where}
                    ORDER BY COALESCE(o.is_hidden,0),COALESCE(o.sort_order,p.sort_order,0),p.name,p.id
                    LIMIT ?""",
                [*values, limit],
            ) as cursor:
                rows = await cursor.fetchall()
        return {"items": [dict(row) for row in rows]}

    async def update_product(
        product_id: int,
        payload: dict[str, Any] = Body(...),
        session: Any = Depends(api_module.require_admin),
        csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
    ) -> dict[str, Any]:
        api_module._check_csrf(session, csrf_token)
        await api_module._ensure_ready()
        if bool(payload.get("reset")):
            async with aiosqlite.connect(core.db_path()) as db:
                await db.execute("DELETE FROM storefront_product_overrides WHERE product_id=?", (product_id,))
                await db.commit()
            await core.audit("admin", "product_override_reset", str(product_id))
            return {"ok": True, "reset": True}
        display_name = _clean_text(core, payload.get("display_name"), 180)
        try:
            sort_order = max(-100_000, min(100_000, int(payload.get("sort_order") or 0)))
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail={"code": "invalid_sort", "message": "ترتيب المنتج غير صحيح."},
            )
        hidden = 1 if bool(payload.get("is_hidden")) else 0
        async with aiosqlite.connect(core.db_path()) as db:
            async with db.execute("SELECT 1 FROM products WHERE id=?", (product_id,)) as cursor:
                exists = await cursor.fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail={"code": "product_not_found", "message": "المنتج غير موجود."})
            await db.execute(
                "INSERT INTO storefront_product_overrides(product_id,display_name,is_hidden,sort_order,updated_at) VALUES (?,?,?,?,?) "
                "ON CONFLICT(product_id) DO UPDATE SET display_name=excluded.display_name,is_hidden=excluded.is_hidden,sort_order=excluded.sort_order,updated_at=excluded.updated_at",
                (product_id, display_name, hidden, sort_order, core.now_text()),
            )
            await db.commit()
        await core.audit("admin", "product_override_update", f"{product_id}:{hidden}:{sort_order}")
        return {"ok": True}

    async def policy_page(kind: str) -> HTMLResponse:
        normalized = str(kind or "").casefold()
        data = _POLICY_LABELS.get(normalized)
        if not data:
            raise HTTPException(status_code=404)
        await api_module._ensure_ready()
        settings = await core.get_settings()
        title, key = data
        return HTMLResponse(
            _policy_document(title, settings.get(key, ""), settings.get("store_name", "Uchiha Store")),
            headers=api_module._html_headers(),
        )

    async def dynamic_manifest() -> JSONResponse:
        await api_module._ensure_ready()
        settings = await core.get_settings()
        return JSONResponse(
            {
                "name": settings.get("store_name", "Uchiha Store"),
                "short_name": "Uchiha",
                "description": settings.get("tagline", "متجر للمنتجات والخدمات الرقمية"),
                "lang": "ar",
                "dir": "rtl",
                "start_url": "/",
                "scope": "/",
                "display": "standalone",
                "orientation": "portrait-primary",
                "background_color": "#08090d",
                "theme_color": settings.get("primary_color", "#e4313f"),
                "icons": [
                    {
                        "src": "/v1/storefront/branding/icon",
                        "sizes": "any",
                        "purpose": "any maskable",
                    }
                ],
            },
            media_type="application/manifest+json",
            headers={"Cache-Control": "public,max-age=300"},
        )

    app.add_api_route("/v1/storefront/branding/{kind}", branding, methods=["GET"], include_in_schema=False)
    app.add_api_route("/v1/storefront/admin/branding", admin_branding, methods=["GET"], include_in_schema=False)
    app.add_api_route("/v1/storefront/admin/branding/{kind}", save_branding_route, methods=["PUT"], include_in_schema=False)
    app.add_api_route("/v1/storefront/admin/products", admin_products, methods=["GET"], include_in_schema=False)
    app.add_api_route("/v1/storefront/admin/products/{product_id}", update_product, methods=["PUT"], include_in_schema=False)
    app.add_api_route("/policies/{kind}", policy_page, methods=["GET"], include_in_schema=False)
    app.add_api_route("/manifest-dynamic.webmanifest", dynamic_manifest, methods=["GET"], include_in_schema=False)
    app.state.uchiha_storefront_management_routes = True
