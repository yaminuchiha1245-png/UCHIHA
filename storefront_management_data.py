"""Data layer for storefront owner management."""
from __future__ import annotations
import json
from typing import Any
import aiosqlite

_EXTRA_SETTINGS = {"privacy_policy", "terms_policy", "refund_policy", "exchange_rates_json"}

_POLICY_LABELS = {
    "privacy": ("سياسة الخصوصية", "privacy_policy"),
    "terms": ("الشروط والأحكام", "terms_policy"),
    "refund": ("سياسة الاسترجاع", "refund_policy"),
}

def _clean_text(core: Any, value: Any, limit: int) -> str:
    return core.clean_text(value, limit)

def parse_exchange_rates(raw: Any, base_currency: str = "USD") -> dict[str, float]:
    """Parse owner-configured rates while always preserving the base currency."""
    base = str(base_currency or "USD").strip().upper()[:8] or "USD"
    try:
        payload = json.loads(str(raw or "{}"))
    except (TypeError, json.JSONDecodeError):
        payload = {}
    result: dict[str, float] = {base: 1.0}
    if isinstance(payload, dict):
        for key, value in payload.items():
            code = str(key or "").strip().upper()[:8]
            try:
                numeric = float(value)
            except (TypeError, ValueError):
                continue
            if code and numeric > 0:
                result[code] = numeric
    result[base] = 1.0
    return result

async def ensure_management_schema(core: Any) -> None:
    """Create storefront-owned tables and defaults without touching provider data."""
    async with aiosqlite.connect(core.db_path()) as db:
        await db.execute("PRAGMA busy_timeout = 10000")
        await db.executescript(
            """
            CREATE TABLE IF NOT EXISTS storefront_product_overrides (
                product_id INTEGER PRIMARY KEY,
                display_name TEXT NOT NULL DEFAULT '',
                is_hidden INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS storefront_branding (
                kind TEXT PRIMARY KEY,
                image_blob BLOB,
                image_mime TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_storefront_product_visibility
                ON storefront_product_overrides(is_hidden, sort_order, product_id);
            """
        )
        defaults = {
            "privacy_policy": (
                "نحفظ بيانات الحساب اللازمة لتشغيل المتجر والطلبات والدعم فقط، "
                "ولا نعرض بياناتك أو معلومات الدفع لأي طرف غير لازم لتنفيذ الخدمة."
            ),
            "terms_policy": (
                "باستخدام المتجر فإنك توافق على إدخال بيانات صحيحة، وعدم إساءة "
                "استخدام الخدمات، والالتزام بشروط المنتج الموضحة قبل الشراء."
            ),
            "refund_policy": (
                "تُراجع طلبات الاسترجاع حسب حالة المنتج الرقمي وإمكانية إلغاء الطلب "
                "لدى المزود. لا يمكن استرجاع منتج تم تسليمه أو استخدامه إلا عند وجود خلل مثبت."
            ),
            "exchange_rates_json": "{}",
        }
        await db.executemany(
            "INSERT OR IGNORE INTO storefront_settings(key,value,updated_at) VALUES (?,?,?)",
            [(key, value, core.now_text()) for key, value in defaults.items()],
        )
        await db.commit()

async def _save_extra_settings(core: Any, values: dict[str, Any]) -> None:
    rows: list[tuple[str, str, str]] = []
    for key in _EXTRA_SETTINGS:
        if key not in values:
            continue
        limit = 12_000 if key.endswith("_policy") else 4_000
        clean = _clean_text(core, values.get(key), limit)
        if key == "exchange_rates_json":
            try:
                payload = json.loads(clean or "{}")
            except json.JSONDecodeError as exc:
                raise core.StorefrontError(
                    "invalid_exchange_rates",
                    "صيغة أسعار العملات يجب أن تكون JSON صحيحة.",
                ) from exc
            if not isinstance(payload, dict):
                raise core.StorefrontError(
                    "invalid_exchange_rates",
                    "أسعار العملات يجب أن تكون على شكل عملة وقيمة.",
                )
            normalized: dict[str, float] = {}
            for raw_code, raw_value in payload.items():
                code = str(raw_code or "").strip().upper()[:8]
                try:
                    numeric = float(raw_value)
                except (TypeError, ValueError) as exc:
                    raise core.StorefrontError(
                        "invalid_exchange_rates",
                        f"سعر العملة {code or raw_code} غير صحيح.",
                    ) from exc
                if not code or numeric <= 0:
                    raise core.StorefrontError(
                        "invalid_exchange_rates",
                        "رموز العملات والأسعار يجب أن تكون صحيحة وموجبة.",
                    )
                normalized[code] = numeric
            clean = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))
        rows.append((key, clean, core.now_text()))
    if not rows:
        return
    async with aiosqlite.connect(core.db_path()) as db:
        await db.executemany(
            "INSERT INTO storefront_settings(key,value,updated_at) VALUES (?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
            rows,
        )
        await db.commit()
    await core.audit("admin", "management_settings_update", ",".join(row[0] for row in rows))

def _install_schema_and_settings(api_module: Any) -> None:
    core = api_module.core
    if getattr(core, "_storefront_management_schema_installed", False):
        return
    original_ensure = core.ensure_schema
    original_update = core.update_settings

    async def ensure_schema() -> None:
        await original_ensure()
        await ensure_management_schema(core)

    async def update_settings(values: dict[str, Any]) -> dict[str, str]:
        standard = {key: value for key, value in values.items() if key not in _EXTRA_SETTINGS}
        if standard:
            await original_update(standard)
        await _save_extra_settings(core, values)
        return await core.get_settings()

    core.ensure_schema = ensure_schema
    core.update_settings = update_settings
    core._storefront_management_schema_installed = True

def _managed_fetch_factory(api_module: Any):
    async def managed_fetch(
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
        prefix, params = api_module._category_filter(category_id)
        filters = [
            "p.is_active=1",
            "p.stock>0",
            "c.is_active=1",
            "COALESCE(c.is_hidden,0)=0",
            "COALESCE(o.is_hidden,0)=0",
        ]
        values: list[Any] = []
        if category_id is not None:
            filters.append("p.category_id IN (SELECT id FROM category_tree)")
        if query:
            filters.append(
                "(LOWER(COALESCE(NULLIF(o.display_name,''),p.name)) LIKE LOWER(?) "
                "OR LOWER(COALESCE(p.description,'')) LIKE LOWER(?))"
            )
            values.extend([f"%{query}%", f"%{query}%"])
        where = " AND ".join(filters)
        try:
            async with db.execute(
                f"{prefix} SELECT COUNT(*) FROM products p "
                "JOIN categories c ON c.id=p.category_id "
                "LEFT JOIN storefront_product_overrides o ON o.product_id=p.id "
                f"WHERE {where}",
                [*params, *values],
            ) as cursor:
                total = int((await cursor.fetchone())[0] or 0)
            async with db.execute(
                f"""{prefix}
                SELECT p.id,p.category_id,
                       COALESCE(NULLIF(o.display_name,''),p.name) name,
                       COALESCE(p.description,'') description,p.price,p.stock,
                       COALESCE(p.product_type,'stock') product_type,
                       COALESCE(p.delivery_time,'') delivery_time,
                       COALESCE(p.has_variants,0) has_variants,
                       COALESCE(p.api_provider,'') provider,
                       COALESCE(NULLIF(c.display_name,''),c.name) category_name,
                       COALESCE(m.accent,'#e4313f') accent,
                       COALESCE(o.sort_order,p.sort_order,0) managed_sort_order
                FROM products p JOIN categories c ON c.id=p.category_id
                LEFT JOIN storefront_category_media m ON m.category_id=p.category_id
                LEFT JOIN storefront_product_overrides o ON o.product_id=p.id
                WHERE {where}
                ORDER BY COALESCE(c.local_sort_order,c.sort_order,0),
                         managed_sort_order,name,p.id
                LIMIT ? OFFSET ?""",
                [*params, *values, limit, (page - 1) * limit],
            ) as cursor:
                rows = await cursor.fetchall()
        except aiosqlite.Error:
            return {"page": page, "limit": limit, "total": 0, "pages": 0, "items": []}
        items = [
            {
                "id": int(row["id"]),
                "category_id": int(row["category_id"] or 0),
                "category_name": str(row["category_name"] or "منتجات رقمية"),
                "name": str(row["name"] or "منتج"),
                "description": api_module.core.clean_text(row["description"], 1000),
                "price": round(float(row["price"] or 0), 2),
                "stock": int(row["stock"] or 0),
                "available": int(row["stock"] or 0) > 0,
                "product_type": str(row["product_type"]),
                "delivery_time": str(row["delivery_time"]),
                "has_variants": bool(row["has_variants"]),
                "provider": str(row["provider"]),
                "accent": str(row["accent"] or "#e4313f"),
                "sort_order": int(row["managed_sort_order"] or 0),
                "image_url": f"/v1/storefront/media/category/{int(row['category_id'] or 0)}",
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

    return managed_fetch

def _install_catalog(api_module: Any) -> None:
    api_module._fetch_products = _managed_fetch_factory(api_module)
    original_public_store = api_module._public_store

    async def public_store() -> dict[str, Any]:
        result = await original_public_store()
        settings = await api_module.core.get_settings()
        currency = str(result.get("currency") or "USD").upper()[:8]
        result["exchange_rates"] = parse_exchange_rates(
            settings.get("exchange_rates_json", "{}"), currency
        )
        result["policies"] = {
            key: settings.get(setting_key, "")
            for key, (_, setting_key) in _POLICY_LABELS.items()
        }
        result["branding"] = {
            "logo_url": "/v1/storefront/branding/logo",
            "icon_url": "/v1/storefront/branding/icon",
        }
        return result

    api_module._public_store = public_store
