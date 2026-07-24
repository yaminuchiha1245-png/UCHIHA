"""HTTP routes for nested category administration and category artwork."""
from __future__ import annotations

import uuid
from typing import Any

import aiosqlite
from fastapi import Body, Depends, Header, HTTPException, Response

from storefront_category_hierarchy_data import (
    category_rows,
    clean,
    ensure_schema,
    save_accent,
    save_presentation,
    validate_parent,
)


def install_routes(api_module: Any) -> None:
    app = api_module.app
    if getattr(app.state, "uchiha_category_hierarchy_routes", False):
        return

    async def category_art(category_id: int, kind: str) -> Response:
        await api_module._ensure_ready()
        await ensure_schema(api_module.core)
        column = "icon" if kind == "icon" else "banner" if kind == "banner" else ""
        if not column:
            raise HTTPException(status_code=404)
        async with aiosqlite.connect(api_module.core.db_path()) as db:
            async with db.execute(
                f"SELECT {column}_blob,{column}_mime,updated_at FROM storefront_category_presentation WHERE category_id=?",
                (category_id,),
            ) as cursor:
                row = await cursor.fetchone()
        if not row or not row[0] or not row[1]:
            raise HTTPException(status_code=404)
        return Response(
            bytes(row[0]),
            media_type=str(row[1]),
            headers={
                "Cache-Control": "public,max-age=300",
                "ETag": f'"category-{category_id}-{kind}-{row[2]}"',
                "X-Content-Type-Options": "nosniff",
            },
        )

    async def admin_tree(session: Any = Depends(api_module.require_admin)) -> dict[str, Any]:
        del session
        return {"items": await category_rows(api_module)}

    async def create_category(
        payload: dict[str, Any] = Body(...),
        session: Any = Depends(api_module.require_admin),
        csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
    ) -> dict[str, Any]:
        api_module._check_csrf(session, csrf_token)
        await ensure_schema(api_module.core)
        display_name = clean(payload.get("display_name"), 100)
        if len(display_name) < 2:
            raise HTTPException(status_code=400, detail={"code": "invalid_name", "message": "اكتب اسمًا واضحًا للقسم."})
        try:
            parent_id = max(0, int(payload.get("parent_id") or 0))
            sort_order = max(-10000, min(10000, int(payload.get("sort_order") or 0)))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail={"code": "invalid_category", "message": "بيانات القسم غير صحيحة."})
        await validate_parent(api_module, 0, parent_id)
        async with aiosqlite.connect(api_module.core.db_path()) as db:
            cursor = await db.execute(
                """INSERT INTO categories
                (name,display_name,is_active,sort_order,parent_id,local_parent_id,
                 local_sort_order,is_hidden,is_virtual,api_provider,api_id)
                VALUES (?, ?, 1, ?, ?, ?, ?, ?, 1, 'local_group', 0)""",
                (
                    f"__web_group_{uuid.uuid4().hex}",
                    display_name,
                    sort_order,
                    parent_id,
                    parent_id,
                    sort_order,
                    1 if payload.get("is_hidden") else 0,
                ),
            )
            category_id = int(cursor.lastrowid)
            await db.commit()
        image, mime = api_module._decode_image(payload)
        if image:
            await api_module.core.save_category_media(category_id, image, mime, str(payload.get("accent") or "#e4313f"))
        else:
            await save_accent(api_module, category_id, str(payload.get("accent") or "#e4313f"))
        await save_presentation(api_module, category_id, payload)
        await api_module.core.audit("admin", "category_create", str(category_id))
        return {"ok": True, "id": category_id}

    async def update_category(
        category_id: int,
        payload: dict[str, Any] = Body(...),
        session: Any = Depends(api_module.require_admin),
        csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
    ) -> dict[str, Any]:
        api_module._check_csrf(session, csrf_token)
        await ensure_schema(api_module.core)
        display_name = clean(payload.get("display_name"), 100)
        if len(display_name) < 2:
            raise HTTPException(status_code=400, detail={"code": "invalid_name", "message": "اكتب اسمًا واضحًا للقسم."})
        try:
            parent_id = max(0, int(payload.get("parent_id") or 0))
            sort_order = max(-10000, min(10000, int(payload.get("sort_order") or 0)))
            await validate_parent(api_module, category_id, parent_id)
            async with aiosqlite.connect(api_module.core.db_path()) as db:
                changed = await db.execute(
                    "UPDATE categories SET display_name=?,local_parent_id=?,local_sort_order=?,is_hidden=? WHERE id=?",
                    (display_name, parent_id, sort_order, 1 if payload.get("is_hidden") else 0, category_id),
                )
                await db.commit()
            if changed.rowcount != 1:
                raise api_module.core.StorefrontError("category_not_found", "القسم غير موجود.", 404)
            image, mime = api_module._decode_image(payload)
            if image:
                await api_module.core.save_category_media(category_id, image, mime, str(payload.get("accent") or "#e4313f"))
            else:
                await save_accent(api_module, category_id, str(payload.get("accent") or "#e4313f"))
            await save_presentation(api_module, category_id, payload)
            await api_module.core.audit("admin", "category_tree_update", str(category_id))
            return {"ok": True}
        except api_module.core.StorefrontError as exc:
            raise api_module._error(exc) from exc
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail={"code": "invalid_category", "message": "بيانات القسم غير صحيحة."})

    async def delete_category(
        category_id: int,
        session: Any = Depends(api_module.require_admin),
        csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
    ) -> dict[str, Any]:
        api_module._check_csrf(session, csrf_token)
        await ensure_schema(api_module.core)
        async with aiosqlite.connect(api_module.core.db_path()) as db:
            async with db.execute(
                "SELECT COALESCE(is_virtual,0),COALESCE(api_provider,'') FROM categories WHERE id=?",
                (category_id,),
            ) as cursor:
                row = await cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail={"code": "category_not_found", "message": "القسم غير موجود."})
            if not int(row[0] or 0) or str(row[1] or "") not in {"local_group", ""}:
                raise HTTPException(status_code=409, detail={"code": "provider_category", "message": "هذا القسم مرتبط بالمزوّد؛ يمكنك إخفاؤه بدل حذفه."})
            async with db.execute(
                "SELECT (SELECT COUNT(*) FROM products WHERE category_id=?),"
                "(SELECT COUNT(*) FROM categories WHERE COALESCE(local_parent_id,parent_id,0)=?)",
                (category_id, category_id),
            ) as cursor:
                counts = await cursor.fetchone()
            if int(counts[0] or 0) or int(counts[1] or 0):
                raise HTTPException(status_code=409, detail={"code": "category_not_empty", "message": "انقل المنتجات والأقسام الداخلية أولًا ثم احذف القسم."})
            await db.execute("DELETE FROM storefront_category_presentation WHERE category_id=?", (category_id,))
            await db.execute("DELETE FROM storefront_category_media WHERE category_id=?", (category_id,))
            await db.execute("DELETE FROM categories WHERE id=?", (category_id,))
            await db.commit()
        await api_module.core.audit("admin", "category_delete", str(category_id))
        return {"ok": True}

    app.add_api_route("/v1/storefront/category-art/{category_id}/{kind}", category_art, methods=["GET"])
    app.add_api_route("/v1/storefront/admin/category-tree", admin_tree, methods=["GET"])
    app.add_api_route("/v1/storefront/admin/category-tree", create_category, methods=["POST"])
    app.add_api_route("/v1/storefront/admin/category-tree/{category_id}", update_category, methods=["PUT"])
    app.add_api_route("/v1/storefront/admin/category-tree/{category_id}", delete_category, methods=["DELETE"])
    app.state.uchiha_category_hierarchy_routes = True
