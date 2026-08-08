import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildApp } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";
import { createDatabase } from "../src/db.mjs";
import {
  UCHIHA_DEMO_SERVICES_CATEGORY_ID,
  UCHIHA_DEMO_SERVICE_PRODUCT_ID
} from "../src/demo-uchiha-branding.mjs";
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

test("permanent demo is idempotent, UCHIHA branded, visible, and financially disabled", async (context) => {
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
  assert.equal(stores.rows[0].name, "UCHIHA STORE");

  const design = await db.query(
    "SELECT primary_color, secondary_color, background_color, surface_color, cover_url FROM store_design_tokens WHERE store_id=$1",
    [DEMO_STORE_ID]
  );
  assert.equal(design.rows[0].primary_color, "#ffffff");
  assert.equal(design.rows[0].secondary_color, "#bdbdbd");
  assert.equal(design.rows[0].background_color, "#080808");
  assert.equal(design.rows[0].surface_color, "#111111");
  assert.equal(design.rows[0].cover_url, "/assets/demo-assets/uchiha-banner-madara.webp");

  const banner = await db.query(
    "SELECT media_url FROM store_banners WHERE store_id=$1 ORDER BY sort_order LIMIT 1",
    [DEMO_STORE_ID]
  );
  assert.equal(banner.rows[0].media_url, "/assets/demo-assets/uchiha-banner-madara.webp");

  const rootCategories = await db.query(
    "SELECT id FROM categories WHERE store_id=$1 AND parent_id IS NULL AND status='active' ORDER BY sort_order",
    [DEMO_STORE_ID]
  );
  assert.equal(rootCategories.rowCount, 4);
  assert.ok(rootCategories.rows.some((row) => row.id === UCHIHA_DEMO_SERVICES_CATEGORY_ID));

  const serviceProduct = await db.query(
    "SELECT category_id, product_type, status FROM products WHERE id=$1 AND store_id=$2",
    [UCHIHA_DEMO_SERVICE_PRODUCT_ID, DEMO_STORE_ID]
  );
  assert.equal(serviceProduct.rowCount, 1);
  assert.equal(serviceProduct.rows[0].category_id, UCHIHA_DEMO_SERVICES_CATEGORY_ID);
  assert.equal(serviceProduct.rows[0].product_type, "programming_service");
  assert.equal(serviceProduct.rows[0].status, "active");

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
  assert.match(serviceWorker, /2026\.08\.08\.18/);
  assert.match(serviceWorker, /monochrome-v1\.css/);
  assert.match(serviceWorker, /store-reference\.css/);
  assert.match(serviceWorker, /store-reference-runtime\.css/);
  assert.match(serviceWorker, /store-reference-welcome\.css/);
  assert.match(serviceWorker, /store-catalog-v5\.css/);
  assert.match(serviceWorker, /admin-reference\.css/);
  assert.match(serviceWorker, /admin-subpages-reference\.css/);
  assert.match(serviceWorker, /uchiha-category-services\.svg/);
  assert.match(serviceWorker, /cache: "no-store"/);
  assert.match(serviceWorker, /key\.startsWith\("uchiha-"\)/);
  assert.match(pwaScript, /2026\.08\.08\.18/);
  assert.match(pwaScript, /updateViaCache: "none"/);
  assert.match(runtimeScript, /header_regexp storefront Host/);
  assert.doesNotMatch(runtimeScript, /\bhost_regexp\b/);
  assert.match(runtimeScript, /redir @storeRoot \/store\/\{re\.storefront\.slug\} 302/);
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
