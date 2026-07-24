"""Data helpers for nested storefront categories."""
from __future__ import annotations

import asyncio
import re
from typing import Any

import aiosqlite

_SCHEMA_LOCK = asyncio.Lock()
_SCHEMA_READY: set[str] = set()


def clean(value: Any, limit: int) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", str(value or "")).strip()[:limit]


async def ensure_schema(core: Any) -> None:
    key = str(core.db_path())
    if key in _SCHEMA_READY:
        return
    async with _SCHEMA_LOCK:
        if key in _SCHEMA_READY:
            return
        async with aiosqlite.connect(core.db_path()) as db:
            await db.executescript(
                """
                CREATE TABLE IF NOT EXISTS storefront_category_presentation (
                    category_id INTEGER PRIMARY KEY,
                    description TEXT NOT NULL DEFAULT '',
                    badge TEXT NOT NULL DEFAULT '',
                    icon_blob BLOB,
                    icon_mime TEXT NOT NULL DEFAULT '',
                    banner_blob BLOB,
                    banner_mime TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_storefront_category_parent
                ON categories(local_parent_id, parent_id, is_hidden, local_sort_order, sort_order);
                """
            )
            await db.commit()
        _SCHEMA_READY.add(key)


def parents(items: list[dict[str, Any]]) -> dict[int, int]:
    ids = {int(item.get("id") or 0) for item in items}
    return {
        int(item.get("id") or 0): (
            int(item.get("parent_id") or 0)
            if int(item.get("parent_id") or 0) in ids
            else 0
        )
        for item in items
    }


def depth(category_id: int, parent_map: dict[int, int], limit: int = 24) -> int:
    value = 0
    current = int(category_id or 0)
    seen: set[int] = set()
    while current and current not in seen and value < limit:
        seen.add(current)
        current = parent_map.get(current, 0)
        value += 1
    return value


def descendants(category_id: int, parent_map: dict[int, int]) -> set[int]:
    found: set[int] = set()
    frontier = [int(category_id)]
    while frontier:
        current = frontier.pop()
        for child_id, parent_id in parent_map.items():
            if parent_id == current and child_id not in found:
                found.add(child_id)
                frontier.append(child_id)
    return found


async def augment_categories(
    api_module: Any,
    db: aiosqlite.Connection,
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    await ensure_schema(api_module.core)
    if not items:
        return items
    ids = [int(item["id"]) for item in items]
    placeholders = ",".join("?" for _ in ids)
    presentation: dict[int, aiosqlite.Row] = {}
    direct_counts = {category_id: 0 for category_id in ids}
    try:
        async with db.execute(
            f"SELECT category_id,description,badge,icon_mime,banner_mime,updated_at "
            f"FROM storefront_category_presentation WHERE category_id IN ({placeholders})",
            ids,
        ) as cursor:
            presentation = {int(row[0]): row for row in await cursor.fetchall()}
        async with db.execute(
            f"SELECT category_id,COUNT(*) FROM products WHERE is_active=1 AND stock>0 "
            f"AND category_id IN ({placeholders}) GROUP BY category_id",
            ids,
        ) as cursor:
            for row in await cursor.fetchall():
                direct_counts[int(row[0])] = int(row[1] or 0)
    except aiosqlite.Error:
        presentation = {}

    parent_map = parents(items)
    child_counts = {category_id: 0 for category_id in ids}
    for parent_id in parent_map.values():
        if parent_id in child_counts:
            child_counts[parent_id] += 1
    for item in items:
        category_id = int(item["id"])
        row = presentation.get(category_id)
        stamp = str(row[5] if row else "").replace(" ", "")
        item.update(
            description=str(row[1] if row else ""),
            badge=str(row[2] if row else ""),
            direct_product_count=direct_counts.get(category_id, 0),
            child_count=child_counts.get(category_id, 0),
            has_children=child_counts.get(category_id, 0) > 0,
            depth=depth(category_id, parent_map),
            icon_url=(
                f"/v1/storefront/category-art/{category_id}/icon?v={stamp}"
                if row and row[3]
                else item.get("image_url", "")
            ),
            banner_url=(
                f"/v1/storefront/category-art/{category_id}/banner?v={stamp}"
                if row and row[4]
                else item.get("image_url", "")
            ),
        )
    return items


def install_catalog(api_module: Any) -> None:
    original_fetch = api_module._fetch_categories

    async def nested_fetch(db: aiosqlite.Connection) -> list[dict[str, Any]]:
        return await augment_categories(api_module, db, await original_fetch(db))

    api_module._fetch_categories = nested_fetch


async def category_rows(api_module: Any) -> list[dict[str, Any]]:
    await ensure_schema(api_module.core)
    async with aiosqlite.connect(api_module.core.db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT c.id,c.name,COALESCE(NULLIF(c.display_name,''),c.name) display_name,
                   COALESCE(c.local_parent_id,c.parent_id,0) parent_id,
                   COALESCE(c.local_sort_order,c.sort_order,0) sort_order,
                   COALESCE(c.is_hidden,0) is_hidden,COALESCE(c.is_active,0) is_active,
                   COALESCE(c.is_virtual,0) is_virtual,COALESCE(c.api_provider,'') api_provider,
                   (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.is_active=1) product_count,
                   (SELECT COUNT(*) FROM categories child WHERE COALESCE(child.local_parent_id,child.parent_id,0)=c.id) child_count,
                   COALESCE(m.accent,'#e4313f') accent,COALESCE(m.image_mime,'') image_mime,
                   COALESCE(x.description,'') description,COALESCE(x.badge,'') badge,
                   COALESCE(x.icon_mime,'') icon_mime,COALESCE(x.banner_mime,'') banner_mime,
                   COALESCE(x.updated_at,'') presentation_updated
            FROM categories c
            LEFT JOIN storefront_category_media m ON m.category_id=c.id
            LEFT JOIN storefront_category_presentation x ON x.category_id=c.id
            ORDER BY parent_id,sort_order,display_name,c.id
            """
        ) as cursor:
            items = [dict(row) for row in await cursor.fetchall()]
    parent_map = {int(item["id"]): int(item["parent_id"] or 0) for item in items}
    for item in items:
        category_id = int(item["id"])
        stamp = str(item.get("presentation_updated") or "").replace(" ", "")
        item["depth"] = depth(category_id, parent_map)
        item["image_url"] = f"/v1/storefront/media/category/{category_id}"
        item["icon_url"] = (
            f"/v1/storefront/category-art/{category_id}/icon?v={stamp}"
            if item.get("icon_mime")
            else item["image_url"]
        )
        item["banner_url"] = (
            f"/v1/storefront/category-art/{category_id}/banner?v={stamp}"
            if item.get("banner_mime")
            else item["image_url"]
        )
    return items


async def validate_parent(api_module: Any, category_id: int, parent_id: int) -> None:
    if parent_id == category_id:
        raise api_module.core.StorefrontError("invalid_parent", "لا يمكن وضع القسم داخل نفسه.")
    rows = await category_rows(api_module)
    ids = {int(item["id"]) for item in rows}
    if parent_id and parent_id not in ids:
        raise api_module.core.StorefrontError("parent_not_found", "القسم الأب غير موجود.", 404)
    parent_map = {int(item["id"]): int(item["parent_id"] or 0) for item in rows}
    if category_id and parent_id in descendants(category_id, parent_map):
        raise api_module.core.StorefrontError("category_cycle", "لا يمكن نقل القسم إلى أحد أقسامه الداخلية.")
    if parent_id and depth(parent_id, parent_map) >= 11:
        raise api_module.core.StorefrontError("category_depth", "وصلت شجرة الأقسام إلى الحد الأقصى الآمن.")


async def save_accent(api_module: Any, category_id: int, accent: str) -> None:
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", str(accent or "")):
        accent = "#e4313f"
    async with aiosqlite.connect(api_module.core.db_path()) as db:
        await db.execute(
            """INSERT INTO storefront_category_media(category_id,image_blob,image_mime,accent,updated_at)
            VALUES (?,NULL,'',?,?) ON CONFLICT(category_id) DO UPDATE SET
            accent=excluded.accent,updated_at=excluded.updated_at""",
            (category_id, accent, api_module.core.now_text()),
        )
        await db.commit()


async def save_presentation(api_module: Any, category_id: int, payload: dict[str, Any]) -> None:
    icon, icon_mime = api_module._decode_image(payload, "icon")
    banner, banner_mime = api_module._decode_image(payload, "banner")
    async with aiosqlite.connect(api_module.core.db_path()) as db:
        await db.execute(
            """
            INSERT INTO storefront_category_presentation
            (category_id,description,badge,icon_blob,icon_mime,banner_blob,banner_mime,updated_at)
            VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(category_id) DO UPDATE SET
              description=excluded.description,badge=excluded.badge,
              icon_blob=CASE WHEN excluded.icon_blob IS NULL THEN storefront_category_presentation.icon_blob ELSE excluded.icon_blob END,
              icon_mime=CASE WHEN excluded.icon_blob IS NULL THEN storefront_category_presentation.icon_mime ELSE excluded.icon_mime END,
              banner_blob=CASE WHEN excluded.banner_blob IS NULL THEN storefront_category_presentation.banner_blob ELSE excluded.banner_blob END,
              banner_mime=CASE WHEN excluded.banner_blob IS NULL THEN storefront_category_presentation.banner_mime ELSE excluded.banner_mime END,
              updated_at=excluded.updated_at
            """,
            (
                category_id,
                clean(payload.get("description"), 500),
                clean(payload.get("badge"), 30),
                icon,
                icon_mime,
                banner,
                banner_mime,
                api_module.core.now_text(),
            ),
        )
        if payload.get("delete_icon"):
            await db.execute(
                "UPDATE storefront_category_presentation SET icon_blob=NULL,icon_mime='',updated_at=? WHERE category_id=?",
                (api_module.core.now_text(), category_id),
            )
        if payload.get("delete_banner"):
            await db.execute(
                "UPDATE storefront_category_presentation SET banner_blob=NULL,banner_mime='',updated_at=? WHERE category_id=?",
                (api_module.core.now_text(), category_id),
            )
        await db.commit()
