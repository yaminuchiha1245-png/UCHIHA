import assert from "node:assert/strict";
import test from "node:test";
import {
  installAiProductActivationGuard,
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

function badRuntime() {
  return {
    nodeEnv: "development",
    databaseMode: "postgres",
    databaseUrl: "postgres://db/uchiha",
    requirePersistentDatabase: true,
    appBaseUrl: "https://localhost:4100",
    cookieSecure: false,
    telegramMode: "fake",
    rateLimitEnabled: false,
    previewMemoryMode: false,
    demoSeed: false,
    allowDemoBilling: false
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
  const secure = {
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
  assert.deepEqual(runtimeBlockers(secure), []);
  const bad = runtimeBlockers({
    ...secure,
    nodeEnv: "development",
    appBaseUrl: "https://localhost:4100",
    cookieSecure: false,
    telegramMode: "fake",
    rateLimitEnabled: false,
    allowDemoBilling: true
  });
  assert.ok(bad.includes("NODE_ENV"));
  assert.ok(bad.includes("HTTPS"));
  assert.ok(bad.includes("Secure Cookie"));
  assert.ok(bad.includes("Telegram live"));
  assert.ok(bad.includes("Rate Limit"));
  assert.ok(bad.includes("Demo mode"));
});

test("price-only patch cannot make an already-active product sellable on an unsafe runtime", async () => {
  let hook;
  const app = { addHook(name, fn) { if (name === "preHandler") hook = fn; } };
  const db = {
    async query(sql) {
      const source = String(sql);
      if (source.includes("FROM sessions")) {
        return {
          rows: [{ id: "admin-1", is_platform_admin: true, csrf_hash: sha256("csrf-ok") }]
        };
      }
      if (source.includes("SELECT status FROM platform_services")) return { rows: [{ status: "active" }] };
      if (source.includes("to_regclass")) {
        return { rows: [{ migration_applied: true, unique_index_present: true }] };
      }
      throw new Error(`unexpected query: ${source}`);
    }
  };
  installAiProductActivationGuard(app, { db, config: badRuntime() });
  const response = reply();
  await hook({
    method: "PATCH",
    raw: { url: "/api/platform/admin/ai-product" },
    cookies: { uchiha_builder_session: "session" },
    headers: { "x-csrf-token": "csrf-ok" },
    body: { priceMinor: 2500 }
  }, response);
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload?.error, "ai_product_launch_not_ready");
  assert.ok(response.payload.blockers.includes("NODE_ENV"));
});

test("platform owner can hide the product while preparing an unsafe runtime", async () => {
  let hook;
  const app = { addHook(name, fn) { if (name === "preHandler") hook = fn; } };
  const db = {
    async query(sql) {
      const source = String(sql);
      if (source.includes("FROM sessions")) {
        return {
          rows: [{ id: "admin-1", is_platform_admin: true, csrf_hash: sha256("csrf-ok") }]
        };
      }
      throw new Error(`unexpected query: ${source}`);
    }
  };
  installAiProductActivationGuard(app, { db, config: badRuntime() });
  const response = reply();
  const result = await hook({
    method: "PATCH",
    raw: { url: "/api/platform/admin/ai-product" },
    cookies: { uchiha_builder_session: "session" },
    headers: { "x-csrf-token": "csrf-ok" },
    body: { priceMinor: 2500, status: "hidden" }
  }, response);
  assert.equal(result, undefined);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload, null);
});
