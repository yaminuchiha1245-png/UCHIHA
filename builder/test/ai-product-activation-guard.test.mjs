import assert from "node:assert/strict";
import test from "node:test";
import {
  installAiProductActivationGuard,
  productStateBlockers,
  publicHttps,
  runtimeBlockers
} from "../src/ai-product-activation-guard.mjs";
import { sha256 } from "../src/security.mjs";

function reply() {
  return {
    statusCode: 200,
    payload: null,
    code(value) { this.statusCode = value; return this; },
    send(value) { this.payload = value; return this; }
  };
}

function secureRuntime() {
  return {
    nodeEnv: "production",
    databaseMode: "postgres",
    databaseUrl: "postgres://db/uchiha",
    requirePersistentDatabase: true,
    appBaseUrl: "https://uchiha.example",
    cookieSecure: true,
    telegramMode: "live",
    rateLimitEnabled: true,
    previewMemoryMode: false,
    demoSeed: false,
    allowDemoBilling: false
  };
}

function badRuntime() {
  return {
    ...secureRuntime(),
    nodeEnv: "development",
    appBaseUrl: "https://localhost:4100",
    cookieSecure: false,
    telegramMode: "fake",
    rateLimitEnabled: false
  };
}

function adminDb({
  status = "active",
  priceMinor = 2500,
  currency = "USD",
  identityReady = true,
  promptLeaseReady = true
} = {}) {
  return {
    async query(sql) {
      const source = String(sql);
      if (source.includes("FROM sessions")) {
        return {
          rows: [{ id: "admin-1", is_platform_admin: true, csrf_hash: sha256("csrf-ok") }]
        };
      }
      if (source.includes("FROM platform_services")) {
        return { rows: [{ status, starting_price_minor: priceMinor, currency }] };
      }
      if (source.includes("to_regclass")) {
        return {
          rows: [{
            identity_migration_applied: identityReady,
            prompt_lease_migration_applied: promptLeaseReady,
            unique_index_present: identityReady,
            prompt_lease_table_present: promptLeaseReady
          }]
        };
      }
      throw new Error(`unexpected query: ${source}`);
    }
  };
}

function adminRequest(body) {
  return {
    method: "PATCH",
    raw: { url: "/api/platform/admin/ai-product" },
    cookies: { uchiha_builder_session: "session" },
    headers: { "x-csrf-token": "csrf-ok" },
    body
  };
}

test("AI product activation recognizes only public HTTPS URLs", () => {
  assert.equal(publicHttps("https://uchiha.example"), true);
  assert.equal(publicHttps("http://uchiha.example"), false);
  assert.equal(publicHttps("https://localhost:4100"), false);
  assert.equal(publicHttps("https://127.0.0.1"), false);
  assert.equal(publicHttps("https://10.0.0.5"), false);
  assert.equal(publicHttps("https://172.20.0.5"), false);
  assert.equal(publicHttps("https://192.168.1.5"), false);
});

test("AI product activation blocks incomplete runtime and accepts secure production runtime", () => {
  assert.deepEqual(runtimeBlockers(secureRuntime()), []);
  const bad = runtimeBlockers({ ...badRuntime(), allowDemoBilling: true });
  assert.ok(bad.includes("NODE_ENV"));
  assert.ok(bad.includes("HTTPS"));
  assert.ok(bad.includes("Secure Cookie"));
  assert.ok(bad.includes("Telegram live"));
  assert.ok(bad.includes("Rate Limit"));
  assert.ok(bad.includes("Demo mode"));
});

test("active product state requires positive minor-unit price and valid ISO-style currency code", () => {
  assert.deepEqual(productStateBlockers({ priceMinor: 2500, currency: "USD" }), []);
  assert.ok(productStateBlockers({ priceMinor: 0, currency: "USD" }).includes("Product price"));
  assert.ok(productStateBlockers({ priceMinor: 2500, currency: "US" }).includes("Product currency"));
});

test("price-only patch cannot leave an already-active product sellable on an unsafe runtime", async () => {
  let hook;
  const app = { addHook(name, fn) { if (name === "preHandler") hook = fn; } };
  installAiProductActivationGuard(app, { db: adminDb(), config: badRuntime() });
  const response = reply();
  await hook(adminRequest({ priceMinor: 2500 }), response);
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload?.error, "ai_product_launch_not_ready");
  assert.ok(response.payload.blockers.includes("NODE_ENV"));
});

test("secure runtime still refuses active product when final price is zero", async () => {
  let hook;
  const app = { addHook(name, fn) { if (name === "preHandler") hook = fn; } };
  installAiProductActivationGuard(app, {
    db: adminDb({ status: "hidden", priceMinor: null, currency: "USD" }),
    config: secureRuntime()
  });
  const response = reply();
  await hook(adminRequest({ status: "active", priceMinor: 0, currency: "USD" }), response);
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload?.error, "ai_product_launch_not_ready");
  assert.ok(response.payload.blockers.includes("Product price"));
});

test("secure runtime refuses active sale until prompt-lease migration 033 is present", async () => {
  let hook;
  const app = { addHook(name, fn) { if (name === "preHandler") hook = fn; } };
  installAiProductActivationGuard(app, {
    db: adminDb({ status: "hidden", priceMinor: 2500, promptLeaseReady: false }),
    config: secureRuntime()
  });
  const response = reply();
  await hook(adminRequest({ status: "active" }), response);
  assert.equal(response.statusCode, 409);
  assert.ok(response.payload.blockers.includes("Migration 033"));
  assert.ok(response.payload.blockers.includes("AI prompt lease table"));
});

test("platform owner can hide the product while preparing an unsafe runtime", async () => {
  let hook;
  const app = { addHook(name, fn) { if (name === "preHandler") hook = fn; } };
  installAiProductActivationGuard(app, { db: adminDb(), config: badRuntime() });
  const response = reply();
  const result = await hook(adminRequest({ priceMinor: 2500, status: "hidden" }), response);
  assert.equal(result, undefined);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload, null);
});
