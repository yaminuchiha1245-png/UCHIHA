import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";
import { createDatabase } from "../src/db.mjs";
import { HttpJsonV1Adapter } from "../src/providers.mjs";
import { readinessSnapshot } from "../src/readiness.mjs";
import { seedEnvironment } from "../src/seed.mjs";

const PREVIEW_PAGES = [
  "/",
  "/store/demo",
  "/store/demo/account",
  "/store/demo/wallet",
  "/store/demo/payments",
  "/store/demo/orders",
  "/store/demo/support",
  "/store/demo/telegram",
  "/store/demo/security",
  "/store/demo/identity",
  "/store/demo/developer"
];

function previewConfig() {
  const config = loadConfig({
    NODE_ENV: "production",
    PREVIEW_MEMORY_MODE: "true",
    REQUIRE_PERSISTENT_DATABASE: "false",
    DEMO_SEED: "true",
    ALLOW_DEMO_BILLING: "true",
    TELEGRAM_MODE: "live",
    UCHIHA_API_1_MODE: "live",
    APP_BASE_URL: "https://preview.example.test",
    STORE_BASE_DOMAIN: "preview.example.test",
    COOKIE_SECURE: "true",
    RATE_LIMIT_ENABLED: "false"
  });
  config.offerSeed = {
    name: "UCHIHA Full Preview",
    priceMinor: 0,
    renewalPriceMinor: 0,
    currency: "USD",
    durationUnit: "month",
    durationCount: 1,
    trialDays: 7
  };
  return config;
}

async function setupPreview() {
  const config = previewConfig();
  const db = await createDatabase(config);
  await seedEnvironment(db, config);
  const app = await buildApp({ db, config, logger: false, startWorkers: false });
  await app.ready();
  return { app, db, config };
}

test("preview memory readiness is HTTP 200 and explicitly non-persistent", async (context) => {
  const { app, db } = await setupPreview();
  context.after(async () => {
    await app.close();
    await db.close();
  });

  const ready = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(ready.statusCode, 200, ready.body);
  const payload = ready.json();
  assert.equal(payload.status, "demo-ready");
  assert.equal(payload.database, "memory-demo");
  assert.equal(payload.persistent, false);
  assert.equal(payload.preview, true);
  assert.equal(payload.ephemeral, true);

  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200, health.body);
  assert.equal(health.json().preview, true);
  assert.equal(health.json().persistent, false);
});

test("production readiness fails closed when PostgreSQL is absent", () => {
  const snapshot = readinessSnapshot(
    {
      previewMemoryMode: false,
      requirePersistentDatabase: true,
      databaseFallbackReason: "missing_database_url",
      deployment: {}
    },
    { mode: "memory", migrationCount: 0, latencyMs: 0 },
    "2026-07-31T00:00:00.000Z"
  );

  assert.equal(snapshot.statusCode, 503);
  assert.equal(snapshot.payload.status, "degraded");
  assert.equal(snapshot.payload.persistent, false);
  assert.equal(snapshot.payload.preview, false);
});

test("memory mode applies only the isolated memory schema and skips PostgreSQL-only migrations", async () => {
  const config = previewConfig();
  const db = await createDatabase(config);
  try {
    const rows = await db.query("SELECT version FROM schema_migrations ORDER BY version");
    const versions = new Set(rows.rows.map((row) => row.version));
    for (const postgresOnly of [
      "002_tenant_rls",
      "004_wallet_rls",
      "006_wallet_hardening_rls",
      "008_store_financial_admin_rls",
      "010_product_intelligence_rls",
      "011_catalog_scale_indexes",
      "013_worker_claim_indexes",
      "014_tenant_scope_integrity",
      "016_unified_platform_rls",
      "017_unified_scope_integrity",
      "019_storefront_account_rls",
      "021_platform_portal_rls"
    ]) {
      assert.equal(versions.has(postgresOnly), false, `${postgresOnly} must not run in memory preview mode`);
    }
    assert.equal(versions.has("018_storefront_account"), true);
    assert.equal(versions.has("020_platform_portal"), true);
  } finally {
    await db.close();
  }
});

test("all preview storefront pages load and identify preview-only surfaces", async (context) => {
  const { app, db } = await setupPreview();
  context.after(async () => {
    await app.close();
    await db.close();
  });

  for (const path of PREVIEW_PAGES) {
    const response = await app.inject({ method: "GET", url: path });
    assert.equal(response.statusCode, 200, `${path}: ${response.body}`);
    assert.match(response.headers["content-type"] || "", /text\/html/);
    if (path === "/") {
      assert.match(response.body, /<title>UCHIHA Builder<\/title>/, "the preview homepage must retain the restored Builder identity");
      assert.match(response.body, /data-v5-static-fallback/, "the preview homepage must retain the stable V5 fallback shell");
    } else {
      assert.match(response.body, /preview-banner\.js/, `${path} must load the preview indicator`);
    }
  }
});

test("preview seed provides fake customer wallet, payments and orders", async (context) => {
  const { app, db, config } = await setupPreview();
  context.after(async () => {
    await app.close();
    await db.close();
  });

  const adminLogin = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      email: config.platformAdminEmail,
      password: config.platformAdminPassword
    }
  });
  assert.equal(adminLogin.statusCode, 200, adminLogin.body);
  assert.equal(adminLogin.json().user.isPlatformAdmin, true);

  const login = await app.inject({
    method: "POST",
    url: "/api/public/stores/demo/customers/login",
    payload: {
      email: config.previewCustomerEmail,
      password: config.previewCustomerPassword
    }
  });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = String(login.headers["set-cookie"] || "").split(";")[0];
  assert.ok(cookie);

  const wallet = await app.inject({
    method: "GET",
    url: "/api/public/stores/demo/wallet",
    headers: { cookie }
  });
  assert.equal(wallet.statusCode, 200, wallet.body);
  assert.equal(wallet.json().wallet.balanceMinor, 47311);
  assert.ok(wallet.json().ledger.length >= 3);
  assert.ok(wallet.json().deposits.length >= 3);

  const orders = await app.inject({
    method: "GET",
    url: "/api/public/stores/demo/customer/orders",
    headers: { cookie }
  });
  assert.equal(orders.statusCode, 200, orders.body);
  assert.ok(orders.json().orders.length >= 2);
  assert.ok(orders.json().orders.every((order) => order.paymentSource === "demo"));

  const developer = await app.inject({
    method: "GET",
    url: "/api/public/stores/demo/developer-key",
    headers: { cookie }
  });
  assert.equal(developer.statusCode, 200, developer.body);
  assert.equal(developer.json().baseUrl, "https://preview.example.test/api/v1/stores/demo/");
});

test("provider test mode cannot make an external network request", async () => {
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network access is forbidden in preview tests");
  };
  try {
    const adapter = new HttpJsonV1Adapter({
      provider: {
        base_url: "https://api.example.invalid",
        currency: "USD",
        test_mode: true
      },
      credential: "preview-test-mode"
    });
    assert.equal((await adapter.testConnection()).mode, "test");
    assert.ok((await adapter.listCategories()).length > 0);
    assert.ok((await adapter.listServices()).length > 0);
    assert.equal(
      (await adapter.createOrder({
        externalServiceId: "demo",
        quantity: 1,
        inputs: { account: "preview" },
        idempotencyKey: "preview-order-0001"
      })).payload.simulated,
      true
    );
    assert.equal((await adapter.checkOrder("preview-order")).payload.simulated, true);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("showcase identity remains isolated from a customer-created store", async (context) => {
  const { app, db } = await setupPreview();
  context.after(async () => {
    await app.close();
    await db.close();
  });

  const tenantId = "00000000-0000-4000-8000-000000000701";
  const storeId = "00000000-0000-4000-8000-000000000702";
  await db.query(
    `INSERT INTO tenants (id, slug, name, status)
     VALUES ($1,'client-preview','Client Preview','active')`,
    [tenantId]
  );
  await db.query(
    `INSERT INTO stores (
       id, tenant_id, name, slug, activity_type, description, country,
       language, currency, template_key, status, contact_data, welcome_message
     ) VALUES ($1,$2,'Client Store','client-store','digital-products',
       'Independent customer store','TR','ar','USD','modern-light','active','{}','Welcome')`,
    [storeId, tenantId]
  );
  await db.query(
    `INSERT INTO store_design_tokens (
       tenant_id, store_id, primary_color, secondary_color, background_color,
       surface_color, text_color, muted_text_color, border_color, success_color,
       warning_color, danger_color, font_family, border_radius, button_style, card_style
     ) VALUES ($1,$2,'#2563eb','#1e3a8a','#f8fafc','#ffffff','#0f172a','#64748b',
       '#e2e8f0','#16a34a','#d97706','#dc2626','Cairo','14px','solid','bordered')`,
    [tenantId, storeId]
  );

  const response = await app.inject({ method: "GET", url: "/api/storefront/client-store?catalogOnly=1" });
  assert.equal(response.statusCode, 200, response.body);
  const payload = response.json();
  assert.equal(payload.store.name, "Client Store");
  assert.equal(payload.store.design.primaryColor, "#2563eb");
  assert.equal(JSON.stringify(payload.store).includes("/assets/brand/uchiha-mark.svg"), false);
  assert.equal(JSON.stringify(payload.store).includes("UCHIHA Store"), false);
});
