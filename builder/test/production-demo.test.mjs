import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildApp } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";
import { createDatabase } from "../src/db.mjs";
import { ensureProductionShowcase, DEMO_STORE_ID } from "../src/showcase.mjs";
import { createPostgresHarness, postgresAvailable } from "./postgres-helpers.mjs";

function memoryConfig() {
  return loadConfig({
    NODE_ENV: "test",
    PREVIEW_MEMORY_MODE: "true",
    REQUIRE_PERSISTENT_DATABASE: "false",
    DATABASE_MODE: "memory",
    DEMO_SEED: "false",
    ALLOW_DEMO_BILLING: "true",
    TELEGRAM_MODE: "fake",
    UCHIHA_API_1_MODE: "test",
    APP_BASE_URL: "https://uchiha-builder.example.test",
    STORE_BASE_DOMAIN: "uchiha-builder.example.test",
    COOKIE_SECURE: "true",
    RATE_LIMIT_ENABLED: "false"
  });
}

const PUBLIC_ROUTES = [
  "/", "/create-store", "/login", "/account", "/services", "/payment-methods",
  "/contact", "/uchiha-api", "/platform-admin", "/showcase", "/store/demo"
];

test("permanent demo is idempotent, visible, and financially disabled", async (context) => {
  const config = memoryConfig();
  const db = await createDatabase(config);
  const app = await buildApp({ db, config, logger: false, startWorkers: false });
  context.after(async () => {
    await app.close();
    await db.close();
  });

  await ensureProductionShowcase(db, config);
  await ensureProductionShowcase(db, config);
  await app.ready();

  const stores = await db.query("SELECT * FROM stores WHERE slug='demo'");
  assert.equal(stores.rowCount, 1);
  assert.equal(stores.rows[0].id, DEMO_STORE_ID);
  const methods = await db.query("SELECT status FROM payment_methods WHERE store_id=$1", [DEMO_STORE_ID]);
  assert.ok(methods.rowCount >= 3);
  assert.ok(methods.rows.every((row) => row.status === "disabled"));
  const portfolio = await db.query("SELECT target_url, status FROM portfolio_items WHERE target_url='/store/demo'");
  assert.equal(portfolio.rowCount, 1);
  assert.equal(portfolio.rows[0].status, "active");
  const domain = await db.query("SELECT hostname, status FROM domains WHERE store_id=$1", [DEMO_STORE_ID]);
  assert.equal(domain.rows[0].hostname, "demo.uchiha-builder.example.test");
  assert.equal(domain.rows[0].status, "active");

  for (const path of PUBLIC_ROUTES) {
    const response = await app.inject({ method: "GET", url: path });
    assert.notEqual(response.statusCode, 404, `${path} must not return 404`);
    assert.ok(response.statusCode >= 200 && response.statusCode < 400, `${path}: ${response.statusCode}`);
  }
});

test("demo button, service worker, and Caddy routing carry an explicit release contract", async () => {
  const [demoScript, serviceWorker, pwaScript, runtimeScript] = await Promise.all([
    readFile(new URL("../public/preview-banner.js", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../public/pwa.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/render-vps-runtime.sh", import.meta.url), "utf8")
  ]);
  assert.match(demoScript, /href = "\/store\/demo"/);
  assert.match(demoScript, /شاهد متجرًا تجريبيًا/);
  assert.match(serviceWorker, /2026\.08\.02\.1/);
  assert.match(serviceWorker, /cache: "no-store"/);
  assert.match(serviceWorker, /key\.startsWith\("uchiha-"\)/);
  assert.match(pwaScript, /updateViaCache: "none"/);
  assert.match(runtimeScript, /rewrite @storeRoot \/store\/\{re\.storefront\.slug\}/);
});

test("PostgreSQL migration blocks real orders in the permanent demo", { skip: !postgresAvailable() }, async (context) => {
  const harness = await createPostgresHarness(context, { demoSeed: false });
  await ensureProductionShowcase(harness.db, harness.config);
  await ensureProductionShowcase(harness.db, harness.config);
  const migrations = await harness.db.query("SELECT version FROM schema_migrations WHERE version='022_demo_store_safety'");
  assert.equal(migrations.rowCount, 1);

  await assert.rejects(
    harness.db.query(
      `INSERT INTO orders (
         id, tenant_id, store_id, order_number, customer_name, channel,
         status, payment_status, total_minor, currency, idempotency_key
       ) VALUES (
         '00000000-0000-4000-8000-000000009999',
         '00000000-0000-4000-8000-000000000101',
         $1,'REAL-DEMO-ORDER','Blocked customer','web','new','unpaid',100,'USD','blocked-demo-order'
       )`,
      [DEMO_STORE_ID]
    ),
    /demo_store_read_only/
  );
});
