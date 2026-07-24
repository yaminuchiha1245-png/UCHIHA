"""Non-invasive production hardening for the Uchiha Store web application.

The module intentionally wraps the FastAPI application instead of changing the
legacy bot or payment flows. It adds bounded request bodies, lightweight rate
limits for sensitive routes, consistent security headers, exact catalog prices,
and safer retry behavior for customer purchases.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Deque

from starlette.responses import JSONResponse

LOGGER = logging.getLogger(__name__)

Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]


@dataclass(frozen=True, slots=True)
class RateRule:
    name: str
    limit: int
    window_seconds: int


class SlidingWindowLimiter:
    """Small bounded in-memory limiter suitable for one Railway web process."""

    def __init__(self, *, max_keys: int = 10_000) -> None:
        self._events: dict[tuple[str, str], Deque[float]] = defaultdict(deque)
        self._max_keys = max(100, int(max_keys))
        self._last_cleanup = 0.0

    def check(
        self,
        client: str,
        rule: RateRule,
        now: float | None = None,
    ) -> tuple[bool, int]:
        current = time.monotonic() if now is None else float(now)
        key = (client, rule.name)
        events = self._events[key]
        cutoff = current - rule.window_seconds
        while events and events[0] <= cutoff:
            events.popleft()
        if len(events) >= rule.limit:
            retry_after = max(
                1,
                int(rule.window_seconds - (current - events[0])) + 1,
            )
            return False, retry_after
        events.append(current)
        if (
            current - self._last_cleanup > 60
            or len(self._events) > self._max_keys
        ):
            self._cleanup(current)
        return True, 0

    def _cleanup(self, now: float) -> None:
        self._last_cleanup = now
        oldest_useful = now - 600
        stale = [
            key
            for key, events in self._events.items()
            if not events or events[-1] < oldest_useful
        ]
        for key in stale:
            self._events.pop(key, None)
        if len(self._events) <= self._max_keys:
            return
        ordered = sorted(
            self._events.items(),
            key=lambda item: item[1][-1] if item[1] else 0,
        )
        for key, _ in ordered[: len(self._events) - self._max_keys]:
            self._events.pop(key, None)


AUTH_RULE = RateRule("auth", 10, 300)
ADMIN_AUTH_RULE = RateRule("admin-auth", 8, 300)
PURCHASE_RULE = RateRule("purchase", 12, 60)
DEPOSIT_RULE = RateRule("deposit", 20, 60)
LINK_RULE = RateRule("bot-link", 10, 60)
ADMIN_SYNC_RULE = RateRule("admin-sync", 4, 300)
ADMIN_WRITE_RULE = RateRule("admin-write", 40, 60)


def _int_env(
    name: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    try:
        value = int(os.getenv(name, str(default)) or default)
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().casefold() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _header(scope: dict[str, Any], name: bytes) -> str:
    for key, value in scope.get("headers") or []:
        if key.lower() == name:
            return value.decode("latin-1", "ignore").strip()
    return ""


def _client_key(scope: dict[str, Any]) -> str:
    trust_proxy = _truthy(os.getenv("STOREFRONT_TRUST_PROXY")) or bool(
        os.getenv("RAILWAY_ENVIRONMENT")
        or os.getenv("RAILWAY_PROJECT_ID")
    )
    if trust_proxy:
        forwarded = _header(scope, b"x-forwarded-for")
        if forwarded:
            candidate = forwarded.split(",", 1)[0].strip()
            if candidate:
                return candidate[:80]
    client = scope.get("client")
    if isinstance(client, (tuple, list)) and client:
        return str(client[0])[:80]
    return "unknown"


def _rate_rule(method: str, path: str) -> RateRule | None:
    if method != "POST" and not (
        path.startswith("/v1/storefront/admin/")
        and method in {"PUT", "DELETE"}
    ):
        return None
    if path in {
        "/v1/storefront/auth/login",
        "/v1/storefront/auth/signup",
    }:
        return AUTH_RULE
    if path == "/v1/storefront/admin/auth/login":
        return ADMIN_AUTH_RULE
    if path.startswith("/v1/storefront/purchase/"):
        return PURCHASE_RULE
    if path == "/v1/storefront/bot-link":
        return LINK_RULE
    if path == "/v1/storefront/deposits" or path.startswith(
        "/v1/storefront/deposits/"
    ):
        return DEPOSIT_RULE
    if path == "/v1/storefront/admin/sync":
        return ADMIN_SYNC_RULE
    if path.startswith("/v1/storefront/admin/"):
        return ADMIN_WRITE_RULE
    return None


def _private_response(path: str) -> bool:
    if not path.startswith("/v1/storefront/"):
        return False
    public = (
        "/v1/storefront/health",
        "/v1/storefront/public-catalog",
        "/v1/storefront/product/",
        "/v1/storefront/media/banner/",
        "/v1/storefront/media/category/",
    )
    return not any(
        path == item or path.startswith(item)
        for item in public
    )


def _append_header(
    headers: list[tuple[bytes, bytes]],
    name: str,
    value: str,
    *,
    replace: bool = False,
) -> None:
    encoded_name = name.lower().encode("latin-1")
    if replace:
        headers[:] = [
            (key, val)
            for key, val in headers
            if key.lower() != encoded_name
        ]
    elif any(key.lower() == encoded_name for key, _ in headers):
        return
    headers.append((encoded_name, value.encode("latin-1")))


def _positive_int(value: Any, default: int = 1) -> int:
    try:
        number = int(float(str(value)))
    except (TypeError, ValueError):
        return default
    return number if number > 0 else default


def patch_storefront_html(html: str) -> str:
    """Apply customer-side fixes after the existing JS4Card HTML patches."""
    if "function exactMoney(value)" in html:
        old_price = '<div class="price">${money(p.price)}</div>'
        new_price = (
            '<div class="price">'
            '${p.precise_price?exactMoney(p.price):money(p.price)}'
            "</div>"
        )
        if old_price in html:
            html = html.replace(old_price, new_price, 1)

    marker = "async function confirmPurchase(){"
    if "function purchaseIntentKey(" not in html and marker in html:
        helper = (
            "function purchaseIntentKey(productId,payload){"
            "const storageKey=`uchiha_purchase_intent:${productId}`;"
            "const signature=JSON.stringify(payload);try{"
            "const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');"
            "if(saved&&saved.signature===signature&&saved.key&&"
            "Date.now()-Number(saved.created||0)<1800000)return saved.key;"
            "const key=uid();sessionStorage.setItem(storageKey,"
            "JSON.stringify({key,signature,created:Date.now()}));return key}"
            "catch{return uid()}}\n  "
            "function clearPurchaseIntent(productId){try{"
            "sessionStorage.removeItem(`uchiha_purchase_intent:${productId}`)"
            "}catch{}}\n  "
        )
        html = html.replace(marker, helper + marker, 1)

    old_header = "headers:{'Idempotency-Key':uid()},body:"
    new_header = (
        "headers:{'Idempotency-Key':"
        "purchaseIntentKey(p.id,{quantity,variant_id,fields})},body:"
    )
    if old_header in html:
        html = html.replace(old_header, new_header, 1)

    old_success = "closeLayers();toast(data.status==='processing'?"
    new_success = (
        "clearPurchaseIntent(p.id);closeLayers();"
        "toast(data.status==='processing'?"
    )
    if old_success in html:
        html = html.replace(old_success, new_success, 1)
    return html


def _install_catalog_precision(api_module: Any) -> None:
    """Keep exact JS4Card unit prices in public catalog responses."""
    if getattr(
        api_module,
        "_storefront_catalog_precision_installed",
        False,
    ):
        return
    original_fetch = api_module._fetch_products

    async def precise_fetch(
        *args: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        result = await original_fetch(*args, **kwargs)
        items = result.get("items") if isinstance(result, dict) else None
        if not isinstance(items, list):
            return result
        ids = [
            int(item.get("id") or 0)
            for item in items
            if isinstance(item, dict)
            and item.get("provider") == "js4card"
            and int(item.get("id") or 0) > 0
        ]
        if not ids:
            return result
        placeholders = ",".join("?" for _ in ids)
        try:
            async with api_module.aiosqlite.connect(
                api_module.core.db_path()
            ) as db:
                async with db.execute(
                    "SELECT id, price, COALESCE(api_params, '{}') "
                    f"FROM products WHERE id IN ({placeholders})",
                    ids,
                ) as cursor:
                    rows = await cursor.fetchall()
        except Exception:
            LOGGER.exception(
                "Could not restore exact storefront catalog prices"
            )
            return result

        exact: dict[int, tuple[float, bool]] = {}
        for row in rows:
            price = float(row[1] or 0)
            try:
                payload = json.loads(row[2] or "{}")
            except (TypeError, json.JSONDecodeError):
                payload = {}
            if not isinstance(payload, dict):
                payload = {}
            quantity = payload.get("qty_values") or {}
            amount_product = (
                str(payload.get("product_type") or "").casefold()
                == "amount"
            )
            if isinstance(quantity, dict):
                minimum = _positive_int(quantity.get("min"), 1)
                maximum = _positive_int(quantity.get("max"), minimum)
                amount_product = amount_product or maximum > minimum
            precise = (
                amount_product
                or abs(price - round(price, 2)) > 0.000000001
            )
            exact[int(row[0])] = (price, precise)

        for item in items:
            if not isinstance(item, dict):
                continue
            data = exact.get(int(item.get("id") or 0))
            if data:
                item["price"], item["precise_price"] = data
        return result

    api_module._fetch_products = precise_fetch
    api_module._storefront_catalog_precision_installed = True


class StorefrontHardeningMiddleware:
    def __init__(self, app: Any) -> None:
        self.app = app
        self.body_limit = _int_env(
            "STOREFRONT_MAX_BODY_BYTES",
            5 * 1024 * 1024,
            64 * 1024,
            12 * 1024 * 1024,
        )
        self.limiter = SlidingWindowLimiter(
            max_keys=_int_env(
                "STOREFRONT_RATE_LIMIT_KEYS",
                10_000,
                500,
                50_000,
            )
        )

    async def __call__(
        self,
        scope: dict[str, Any],
        receive: Receive,
        send: Send,
    ) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        method = str(scope.get("method") or "GET").upper()
        path = str(scope.get("path") or "/")
        request_id = secrets.token_hex(8)
        rule = _rate_rule(method, path)
        if rule is not None:
            allowed, retry_after = self.limiter.check(
                _client_key(scope),
                rule,
            )
            if not allowed:
                response = JSONResponse(
                    {
                        "detail": {
                            "code": "rate_limited",
                            "message": (
                                "تم إرسال محاولات كثيرة. "
                                "انتظر قليلًا ثم أعد المحاولة."
                            ),
                        }
                    },
                    status_code=429,
                    headers={
                        "Retry-After": str(retry_after),
                        "Cache-Control": "no-store",
                        "X-Request-ID": request_id,
                    },
                )
                await response(scope, receive, send)
                return

        if method in {
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
        } and path.startswith("/v1/storefront/"):
            content_length = _header(scope, b"content-length")
            if content_length:
                try:
                    if int(content_length) > self.body_limit:
                        await self._too_large(
                            scope,
                            receive,
                            send,
                            request_id,
                        )
                        return
                except ValueError:
                    pass
            buffered: list[bytes] = []
            total = 0
            while True:
                message = await receive()
                if message.get("type") == "http.disconnect":
                    return
                chunk = bytes(message.get("body") or b"")
                total += len(chunk)
                if total > self.body_limit:
                    await self._too_large(
                        scope,
                        receive,
                        send,
                        request_id,
                    )
                    return
                buffered.append(chunk)
                if not message.get("more_body", False):
                    break
            body = b"".join(buffered)
            replayed = False

            async def replay_receive() -> dict[str, Any]:
                nonlocal replayed
                if replayed:
                    return {
                        "type": "http.request",
                        "body": b"",
                        "more_body": False,
                    }
                replayed = True
                return {
                    "type": "http.request",
                    "body": body,
                    "more_body": False,
                }

            receive = replay_receive

        response_started = False

        async def hardened_send(
            message: dict[str, Any],
        ) -> None:
            nonlocal response_started
            if message.get("type") == "http.response.start":
                response_started = True
                headers = list(message.get("headers") or [])
                _append_header(
                    headers,
                    "X-Content-Type-Options",
                    "nosniff",
                )
                _append_header(
                    headers,
                    "Referrer-Policy",
                    "strict-origin-when-cross-origin",
                )
                _append_header(
                    headers,
                    "X-Frame-Options",
                    "DENY",
                )
                _append_header(
                    headers,
                    "Permissions-Policy",
                    "camera=(),microphone=(),geolocation=()",
                )
                _append_header(
                    headers,
                    "Cross-Origin-Opener-Policy",
                    "same-origin",
                )
                _append_header(
                    headers,
                    "Cross-Origin-Resource-Policy",
                    "same-site",
                )
                _append_header(
                    headers,
                    "X-Request-ID",
                    request_id,
                )
                if _private_response(path):
                    _append_header(
                        headers,
                        "Cache-Control",
                        "no-store",
                        replace=True,
                    )
                scheme = str(scope.get("scheme") or "").casefold()
                forwarded_proto = _header(
                    scope,
                    b"x-forwarded-proto",
                ).casefold()
                if scheme == "https" or forwarded_proto == "https":
                    _append_header(
                        headers,
                        "Strict-Transport-Security",
                        "max-age=31536000; includeSubDomains",
                    )
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, hardened_send)
        except Exception:
            LOGGER.exception(
                "Unhandled storefront request failure "
                "request_id=%s method=%s path=%s",
                request_id,
                method,
                path,
            )
            if response_started:
                raise
            response = JSONResponse(
                {
                    "detail": {
                        "code": "internal_error",
                        "message": (
                            "تعذر إكمال الطلب الآن. "
                            "حاول مرة أخرى لاحقًا."
                        ),
                        "request_id": request_id,
                    }
                },
                status_code=500,
                headers={
                    "Cache-Control": "no-store",
                    "X-Request-ID": request_id,
                },
            )
            await response(scope, receive, send)

    async def _too_large(
        self,
        scope: dict[str, Any],
        receive: Receive,
        send: Send,
        request_id: str,
    ) -> None:
        response = JSONResponse(
            {
                "detail": {
                    "code": "request_too_large",
                    "message": (
                        "حجم البيانات المرسلة أكبر من الحد المسموح."
                    ),
                }
            },
            status_code=413,
            headers={
                "Cache-Control": "no-store",
                "X-Request-ID": request_id,
            },
        )
        await response(scope, receive, send)


def install(api_module: Any) -> None:
    """Install once on the standalone FastAPI app before Uvicorn starts."""
    app = api_module.app
    if getattr(
        app.state,
        "uchiha_storefront_hardening",
        False,
    ):
        return
    _install_catalog_precision(api_module)
    api_module._STOREFRONT_HTML = patch_storefront_html(
        api_module._STOREFRONT_HTML
    )
    try:
        import storefront_theme

        # storefront_web imports this module variable for every request.
        storefront_theme.STOREFRONT_HTML = api_module._STOREFRONT_HTML
    except (ImportError, AttributeError):
        LOGGER.warning(
            "Could not publish patched storefront HTML to storefront_theme"
        )
    app.add_middleware(StorefrontHardeningMiddleware)
    app.state.uchiha_storefront_hardening = True
    LOGGER.info("Uchiha storefront hardening middleware installed")


__all__ = [
    "RateRule",
    "SlidingWindowLimiter",
    "StorefrontHardeningMiddleware",
    "patch_storefront_html",
    "install",
]
