from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin

import aiohttp
import aiosqlite

from client_api_sync import _auth_request_parts, _decrypt_token
from client_services_store import ensure_schema


@dataclass(slots=True)
class PurchaseResult:
    ok: bool
    external_order_id: str = ""
    provider_status: str = ""
    completed: bool = False
    error: str = ""
    raw_response: str = ""


def _csv_set(value: Any) -> set[str]:
    return {
        part.strip().lower()
        for part in str(value or "").split(",")
        if part.strip()
    }


def _read_path(payload: Any, path: str) -> Any:
    current = payload
    for part in [item for item in str(path or "").split(".") if item]:
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list) and part.isdigit():
            index = int(part)
            current = current[index] if 0 <= index < len(current) else None
        else:
            return None
        if current is None:
            return None
    return current


def _first_path(payload: Any, paths: tuple[str, ...]) -> Any:
    for path in paths:
        value = _read_path(payload, path)
        if value not in (None, ""):
            return value
    return None


def _build_payload(
    *,
    external_product_id: str,
    customer_input: str,
    quantity: int,
    product_key: str,
    input_key: str,
    quantity_key: str,
) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if product_key:
        payload[product_key] = external_product_id
    if input_key and customer_input:
        payload[input_key] = customer_input
    if quantity_key:
        payload[quantity_key] = int(quantity)
    return payload


async def ensure_purchase_schema(store: Any) -> None:
    await ensure_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        for sql in (
            "ALTER TABLE client_api_providers ADD COLUMN purchase_enabled INTEGER DEFAULT 0",
            "ALTER TABLE client_api_providers ADD COLUMN purchase_path TEXT DEFAULT ''",
            "ALTER TABLE client_api_providers ADD COLUMN purchase_method TEXT DEFAULT 'POST'",
            "ALTER TABLE client_api_providers ADD COLUMN purchase_payload_mode TEXT DEFAULT 'json'",
            "ALTER TABLE client_api_providers ADD COLUMN purchase_product_key TEXT DEFAULT 'product_id'",
            "ALTER TABLE client_api_providers ADD COLUMN purchase_input_key TEXT DEFAULT 'customer_id'",
            "ALTER TABLE client_api_providers ADD COLUMN purchase_quantity_key TEXT DEFAULT 'quantity'",
            "ALTER TABLE client_api_providers ADD COLUMN response_order_key TEXT DEFAULT 'order_id'",
            "ALTER TABLE client_api_providers ADD COLUMN response_status_key TEXT DEFAULT ''",
            "ALTER TABLE client_api_providers ADD COLUMN accepted_status_values TEXT DEFAULT 'success,ok,pending,processing,completed,complete,done'",
            "ALTER TABLE client_api_providers ADD COLUMN completed_status_values TEXT DEFAULT 'completed,complete,success,done'",
        ):
            try:
                await db.execute(sql)
            except Exception:
                pass
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS client_api_order_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                local_order_id INTEGER NOT NULL,
                catalog_item_id INTEGER NOT NULL,
                provider_id INTEGER NOT NULL,
                external_order_id TEXT DEFAULT '',
                provider_status TEXT DEFAULT '',
                request_token TEXT DEFAULT '',
                raw_response TEXT DEFAULT '',
                last_error TEXT DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(local_order_id),
                UNIQUE(request_token)
            )
            """
        )
        await db.commit()


async def _purchase_config(store: Any, provider_id: int) -> tuple[Any, ...] | None:
    await ensure_purchase_schema(store)
    async with aiosqlite.connect(store.DB_PATH) as db:
        async with db.execute(
            """
            SELECT id,name,base_url,token_cipher,is_active,
                   COALESCE(auth_mode,'auto'),COALESCE(token_query_key,'api_key'),
                   COALESCE(purchase_enabled,0),COALESCE(purchase_path,''),
                   COALESCE(purchase_method,'POST'),COALESCE(purchase_payload_mode,'json'),
                   COALESCE(purchase_product_key,'product_id'),
                   COALESCE(purchase_input_key,'customer_id'),
                   COALESCE(purchase_quantity_key,'quantity'),
                   COALESCE(response_order_key,'order_id'),
                   COALESCE(response_status_key,''),
                   COALESCE(accepted_status_values,'success,ok,pending,processing,completed,complete,done'),
                   COALESCE(completed_status_values,'completed,complete,success,done')
            FROM client_api_providers WHERE id=?
            """,
            (provider_id,),
        ) as cursor:
            return await cursor.fetchone()


async def execute_generic_purchase(
    store: Any,
    *,
    provider_id: int,
    external_product_id: str,
    customer_input: str,
    quantity: int = 1,
    idempotency_key: str,
) -> PurchaseResult:
    row = await _purchase_config(store, provider_id)
    if not row:
        return PurchaseResult(False, error="المزوّد غير موجود.")
    if not int(row[4] or 0):
        return PurchaseResult(False, error="المزوّد متوقف.")
    if not int(row[7] or 0):
        return PurchaseResult(False, error="الشراء التلقائي غير مفعّل لهذا المزوّد.")

    base_url = str(row[2] or "").strip().rstrip("/") + "/"
    purchase_path = str(row[8] or "").strip()
    if not base_url.strip("/") or not purchase_path:
        return PurchaseResult(False, error="إعداد مسار الشراء غير مكتمل.")
    endpoint = purchase_path if purchase_path.startswith("http") else urljoin(base_url, purchase_path.lstrip("/"))
    allow_insecure = os.getenv("CLIENT_STORE_ALLOW_INSECURE_API", "0").strip().lower() in {"1", "true", "yes", "on"}
    if not endpoint.startswith("https://") and not allow_insecure:
        return PurchaseResult(False, error="تم رفض طلب الشراء لأن رابط API ليس HTTPS.")

    auth_mode = str(row[5] or "auto")
    query_key = str(row[6] or "api_key").strip() or "api_key"
    token = _decrypt_token(store, str(row[3] or ""))
    if auth_mode != "none" and not token:
        return PurchaseResult(False, error="تعذر قراءة توكن المزوّد.")
    headers, params = _auth_request_parts(auth_mode, token, query_key)
    headers["Idempotency-Key"] = idempotency_key
    headers["Accept"] = "application/json"

    method = str(row[9] or "POST").upper()
    if method not in {"POST", "PUT", "PATCH", "GET"}:
        return PurchaseResult(False, error="طريقة HTTP للشراء غير مدعومة.")
    payload_mode = str(row[10] or "json").lower()
    if payload_mode not in {"json", "form", "query"}:
        return PurchaseResult(False, error="طريقة إرسال بيانات الشراء غير مدعومة.")

    payload = _build_payload(
        external_product_id=str(external_product_id),
        customer_input=str(customer_input or ""),
        quantity=max(int(quantity or 1), 1),
        product_key=str(row[11] or "product_id").strip(),
        input_key=str(row[12] or "customer_id").strip(),
        quantity_key=str(row[13] or "quantity").strip(),
    )

    request_kwargs: dict[str, Any] = {"headers": headers, "params": dict(params)}
    if method == "GET" or payload_mode == "query":
        request_kwargs["params"].update(payload)
    elif payload_mode == "form":
        request_kwargs["data"] = payload
    else:
        request_kwargs["json"] = payload

    timeout = aiohttp.ClientTimeout(total=35)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.request(method, endpoint, **request_kwargs) as response:
                text = await response.text()
                raw = text[:12000]
                try:
                    body: Any = json.loads(text) if text else {}
                except json.JSONDecodeError:
                    body = {"raw": text}
                if response.status < 200 or response.status >= 300:
                    return PurchaseResult(
                        False,
                        error=f"HTTP {response.status}",
                        raw_response=raw,
                    )
    except Exception as exc:
        return PurchaseResult(False, error=str(exc)[:500])

    order_path = str(row[14] or "order_id").strip()
    status_path = str(row[15] or "").strip()
    external_order = _read_path(body, order_path) if order_path else None
    if external_order in (None, ""):
        external_order = _first_path(
            body,
            (
                "order_id",
                "orderId",
                "id",
                "data.order_id",
                "data.orderId",
                "data.id",
                "result.order_id",
                "result.id",
            ),
        )
    provider_status = _read_path(body, status_path) if status_path else "accepted"
    status_token = str(provider_status or "accepted").strip().lower()
    accepted = _csv_set(row[16])
    completed_values = _csv_set(row[17])

    if status_path and status_token not in accepted and status_token not in completed_values:
        return PurchaseResult(
            False,
            external_order_id=str(external_order or ""),
            provider_status=status_token,
            error=f"حالة المزوّد غير مقبولة: {status_token or 'empty'}",
            raw_response=raw,
        )

    return PurchaseResult(
        True,
        external_order_id=str(external_order or ""),
        provider_status=status_token or "accepted",
        completed=status_token in completed_values,
        raw_response=raw,
    )
