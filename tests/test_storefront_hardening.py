import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import storefront_hardening as hardening


async def call_asgi(
    app,
    *,
    method="GET",
    path="/",
    body=b"",
    headers=None,
    client=("127.0.0.1", 5000),
    scheme="https",
):
    messages = []
    request_sent = False

    async def receive():
        nonlocal request_sent
        if request_sent:
            return {
                "type": "http.request",
                "body": b"",
                "more_body": False,
            }
        request_sent = True
        return {
            "type": "http.request",
            "body": body,
            "more_body": False,
        }

    async def send(message):
        messages.append(message)

    raw_headers = [
        (
            str(key).lower().encode("latin-1"),
            str(value).encode("latin-1"),
        )
        for key, value in (headers or {}).items()
    ]
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": method,
        "scheme": scheme,
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": raw_headers,
        "client": client,
        "server": ("testserver", 443),
    }
    await app(scope, receive, send)
    return messages


def response_start(messages):
    return next(
        message
        for message in messages
        if message["type"] == "http.response.start"
    )


def header_map(message):
    return {
        key.decode().lower(): value.decode()
        for key, value in message.get("headers", [])
    }


class DummyApp:
    def __init__(self, *, cache="public,max-age=60"):
        self.calls = 0
        self.cache = cache

    async def __call__(self, scope, receive, send):
        self.calls += 1
        await receive()
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"cache-control", self.cache.encode()),
                ],
            }
        )
        await send(
            {
                "type": "http.response.body",
                "body": b"{}",
                "more_body": False,
            }
        )


class HardeningTests(unittest.TestCase):
    def test_sliding_window_limiter(self):
        limiter = hardening.SlidingWindowLimiter(max_keys=100)
        rule = hardening.RateRule("test", 2, 10)
        self.assertEqual(
            limiter.check("client", rule, 0),
            (True, 0),
        )
        self.assertEqual(
            limiter.check("client", rule, 1),
            (True, 0),
        )
        allowed, retry_after = limiter.check("client", rule, 2)
        self.assertFalse(allowed)
        self.assertGreaterEqual(retry_after, 8)
        self.assertEqual(
            limiter.check("client", rule, 11),
            (True, 0),
        )

    def test_html_patch_preserves_purchase_intent(self):
        fixture = (
            "function exactMoney(value){} function uid(){} "
            '<div class="price">${money(p.price)}</div> '
            "async function confirmPurchase(){"
            "const quantity=1,variant_id=0,fields={};"
            "api('/x',{headers:{'Idempotency-Key':uid()},body:'{}'});"
            "closeLayers();toast(data.status==='processing'?'a':'b')}"
        )
        patched = hardening.patch_storefront_html(fixture)
        self.assertIn(
            "${p.precise_price?exactMoney(p.price):money(p.price)}",
            patched,
        )
        self.assertIn("function purchaseIntentKey(", patched)
        self.assertIn(
            "purchaseIntentKey(p.id,{quantity,variant_id,fields})",
            patched,
        )
        self.assertIn(
            "clearPurchaseIntent(p.id);closeLayers()",
            patched,
        )

    def test_catalog_precision_restores_database_price(self):
        class Cursor:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def fetchall(self):
                return [
                    (
                        7,
                        0.00125,
                        '{"product_type":"amount",'
                        '"qty_values":{"min":100,"max":1000}}',
                    )
                ]

        class Database:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            def execute(self, *args):
                return Cursor()

        class AioSqlite:
            @staticmethod
            def connect(path):
                return Database()

        class Core:
            @staticmethod
            def db_path():
                return "store.db"

        class ApiModule:
            aiosqlite = AioSqlite()
            core = Core()

            @staticmethod
            async def _fetch_products(*args, **kwargs):
                return {
                    "items": [
                        {
                            "id": 7,
                            "provider": "js4card",
                            "price": 0.0,
                        }
                    ]
                }

        async def run():
            api_module = ApiModule()
            hardening._install_catalog_precision(api_module)
            result = await api_module._fetch_products()
            item = result["items"][0]
            self.assertEqual(item["price"], 0.00125)
            self.assertTrue(item["precise_price"])

        asyncio.run(run())

    def test_sensitive_route_rules(self):
        self.assertEqual(
            hardening._rate_rule(
                "POST",
                "/v1/storefront/auth/login",
            ).name,
            "auth",
        )
        self.assertEqual(
            hardening._rate_rule(
                "POST",
                "/v1/storefront/purchase/42",
            ).name,
            "purchase",
        )
        self.assertEqual(
            hardening._rate_rule(
                "POST",
                "/v1/storefront/admin/sync",
            ).name,
            "admin-sync",
        )
        self.assertIsNone(
            hardening._rate_rule(
                "GET",
                "/v1/storefront/public-catalog",
            )
        )

    def test_private_api_is_no_store_and_hardened(self):
        async def run():
            inner = DummyApp()
            app = hardening.StorefrontHardeningMiddleware(inner)
            messages = await call_asgi(
                app,
                path="/v1/storefront/wallet",
            )
            start = response_start(messages)
            headers = header_map(start)
            self.assertEqual(start["status"], 200)
            self.assertEqual(headers["cache-control"], "no-store")
            self.assertEqual(
                headers["x-content-type-options"],
                "nosniff",
            )
            self.assertEqual(headers["x-frame-options"], "DENY")
            self.assertIn("x-request-id", headers)
            self.assertIn("strict-transport-security", headers)

        asyncio.run(run())

    def test_public_catalog_keeps_public_cache(self):
        async def run():
            inner = DummyApp(cache="public,max-age=20")
            app = hardening.StorefrontHardeningMiddleware(inner)
            messages = await call_asgi(
                app,
                path="/v1/storefront/public-catalog",
            )
            headers = header_map(response_start(messages))
            self.assertEqual(
                headers["cache-control"],
                "public,max-age=20",
            )

        asyncio.run(run())

    def test_oversized_body_is_rejected_before_application(self):
        async def run():
            inner = DummyApp()
            app = hardening.StorefrontHardeningMiddleware(inner)
            app.body_limit = 4
            messages = await call_asgi(
                app,
                method="POST",
                path="/v1/storefront/deposits",
                body=b"12345",
                headers={"content-length": "5"},
            )
            self.assertEqual(
                response_start(messages)["status"],
                413,
            )
            self.assertEqual(inner.calls, 0)

        asyncio.run(run())

    def test_purchase_rate_limit_blocks_excess_calls(self):
        async def run():
            inner = DummyApp()
            app = hardening.StorefrontHardeningMiddleware(inner)
            statuses = []
            for _ in range(hardening.PURCHASE_RULE.limit + 1):
                messages = await call_asgi(
                    app,
                    method="POST",
                    path="/v1/storefront/purchase/9",
                    body=b"{}",
                    headers={"content-length": "2"},
                )
                statuses.append(
                    response_start(messages)["status"]
                )
            self.assertTrue(
                all(status == 200 for status in statuses[:-1])
            )
            self.assertEqual(statuses[-1], 429)
            self.assertEqual(
                inner.calls,
                hardening.PURCHASE_RULE.limit,
            )

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
