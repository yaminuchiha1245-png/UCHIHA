import test from "node:test";
import assert from "node:assert/strict";
import {
  installStorefrontSubscriptionGuard,
  isProtectedStorefrontPath
} from "../src/storefront-subscription-guard.mjs";

const protectedPaths = [
  "/api/public/stores/demo/customers/register",
  "/api/public/stores/shop/customer/me",
  "/api/public/stores/shop/wallet",
  "/api/public/stores/shop/payment-methods",
  "/api/public/stores/shop/deposits",
  "/api/public/stores/shop/orders",
  "/api/public/stores/shop/support/thread-1/messages",
  "/api/public/stores/shop/developer-key",
  "/api/public/stores/shop/security/sessions"
];

for (const path of protectedPaths) {
  test(`storefront interaction is subscription protected: ${path}`, () => {
    assert.equal(isProtectedStorefrontPath(path), true);
  });
}

test("catalog browsing and unrelated APIs are not blocked by the interaction guard", () => {
  for (const path of [
    "/api/public/stores/shop",
    "/api/public/stores/shop/categories",
    "/api/public/stores/shop/products",
    "/api/public/stores/shop/products/item-1",
    "/api/public/portal",
    "/api/stores/123/orders"
  ]) {
    assert.equal(isProtectedStorefrontPath(path), false, path);
  }
});

test("protected interactions fail closed when no live tenant subscription exists", async () => {
  let hook;
  const app = {
    addHook(name, handler) {
      assert.equal(name, "preHandler");
      hook = handler;
    }
  };
  const db = {
    async query(sql, values) {
      assert.match(sql, /sub\.ends_at>NOW\(\)/);
      assert.deepEqual(values, ["shop", "00000000-0000-4000-8000-000000000101"]);
      return { rows: [] };
    }
  };
  installStorefrontSubscriptionGuard(app, { db });
  await assert.rejects(
    () => hook({ raw: { url: "/api/public/stores/shop/orders" } }),
    (error) => error?.statusCode === 403 && error?.code === "store_subscription_inactive"
  );
});

test("protected interactions continue when the live-subscription query succeeds", async () => {
  let hook;
  const app = { addHook(_name, handler) { hook = handler; } };
  const db = { async query() { return { rows: [{ ok: 1 }] }; } };
  installStorefrontSubscriptionGuard(app, { db });
  await hook({ raw: { url: "/api/public/stores/shop/wallet?fresh=1" } });
});
