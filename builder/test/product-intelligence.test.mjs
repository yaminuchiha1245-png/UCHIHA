import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../src/config.mjs";
import { createDatabase } from "../src/db.mjs";
import { buildApp } from "../src/app.mjs";
import { seedEnvironment } from "../src/seed.mjs";
import { analyzeProductInputSchema } from "../src/product-intelligence.mjs";

function cookieHeader(response) {
  const raw = response.headers["set-cookie"];
  assert.ok(raw);
  return raw.split(";")[0];
}

async function harness(context) {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_MODE: "memory",
    ALLOW_DEMO_BILLING: "true",
    TELEGRAM_MODE: "fake",
    APP_BASE_URL: "http://builder.test",
    STORE_BASE_DOMAIN: "uchiha.store",
    COOKIE_SECURE: "false"
  });
  config.offerSeed = {
    name: "UCHIHA Full Test",
    priceMinor: 1000,
    renewalPriceMinor: 1000,
    currency: "USD",
    durationUnit: "month",
    durationCount: 1,
    trialDays: 0
  };
  const db = await createDatabase(config);
  await seedEnvironment(db, config);
  const app = await buildApp({ db, config, logger: false, startWorkers: false });
  await app.ready();
  context.after(async () => {
    await app.close();
    await db.close();
  });
  return { app, db };
}

async function ownerAndStore(app, db) {
  const register = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { displayName: "مالك التحليل", email: "intelligence-owner@example.com", password: "intelligence-password" }
  });
  assert.equal(register.statusCode, 201, register.body);
  const owner = register.json();
  const tenantId = randomUUID();
  const storeId = randomUUID();
  await db.query("INSERT INTO tenants (id,slug,name,status) VALUES ($1,$2,$3,'active')", [tenantId, "intelligence-tenant", "Intelligence Tenant"]);
  await db.query(
    `INSERT INTO stores (id,tenant_id,name,slug,activity_type,country,language,currency,template_key,status)
     VALUES ($1,$2,'متجر التحليل','intelligence-store','digital','Türkiye','ar','USD','modern-dark','active')`,
    [storeId, tenantId]
  );
  await db.query(
    "INSERT INTO tenant_memberships (tenant_id,user_id,role_key,status) VALUES ($1,$2,'owner','active')",
    [tenantId, owner.user.id]
  );
  return { tenantId, storeId, ownerId: owner.user.id, csrf: owner.csrfToken, cookie: cookieHeader(register) };
}

test("deterministic analyzer infers known product requirements without live AI", () => {
  const game = analyzeProductInputSchema({
    productType: "game_topup",
    name: "شحن PUBG حسب Player ID والسيرفر",
    description: "أدخل معرف اللاعب والسيرفر"
  });
  assert.equal(game.status, "auto_applied");
  assert.ok(game.confidence >= 0.72);
  assert.deepEqual(game.fields.map((field) => field.key), ["player_id", "server"]);

  const social = analyzeProductInputSchema({ productType: "service", name: "مشاهدات تيك توك عبر رابط الفيديو" });
  assert.equal(social.detectedKind, "social_service");
  assert.equal(social.fields[0].type, "url");

  const ambiguous = analyzeProductInputSchema({ productType: "service", name: "خدمة خاصة" });
  assert.equal(ambiguous.status, "review_required");

  const providerSchema = analyzeProductInputSchema({
    productType: "digital",
    name: "منتج مزود",
    fields: [{ key: "custom_id", label: "المعرف", required: true, type: "text" }]
  });
  assert.equal(providerSchema.confidence, 0.98);
  assert.equal(providerSchema.fields[0].key, "custom_id");
});

test("product analysis is stored, auto-applied, reviewed and batched per tenant", async (context) => {
  const { app, db } = await harness(context);
  const store = await ownerAndStore(app, db);

  const gameProduct = await app.inject({
    method: "POST",
    url: `/api/stores/${store.storeId}/products`,
    headers: { cookie: store.cookie, "x-csrf-token": store.csrf },
    payload: {
      name: "شحن فري فاير Player ID مع Server",
      description: "شحن آمن حسب معرف اللاعب والسيرفر",
      productType: "game_topup",
      priceMinor: 500,
      deliveryMode: "manual"
    }
  });
  assert.equal(gameProduct.statusCode, 200, gameProduct.body);
  assert.equal(gameProduct.json().analysis.status, "auto_applied");
  assert.deepEqual(gameProduct.json().product.fields.map((field) => field.key), ["player_id", "server"]);

  const ambiguousProduct = await app.inject({
    method: "POST",
    url: `/api/stores/${store.storeId}/products`,
    headers: { cookie: store.cookie, "x-csrf-token": store.csrf },
    payload: {
      name: "خدمة مخصصة غير واضحة",
      description: "يتم تحديد التفاصيل بعد الطلب",
      productType: "service",
      priceMinor: 900,
      deliveryMode: "manual"
    }
  });
  assert.equal(ambiguousProduct.statusCode, 200, ambiguousProduct.body);
  assert.equal(ambiguousProduct.json().analysis.status, "review_required");
  assert.deepEqual(ambiguousProduct.json().product.fields, []);

  const queue = await app.inject({
    method: "GET",
    url: `/api/stores/${store.storeId}/product-analysis?status=review_required`,
    headers: { cookie: store.cookie }
  });
  assert.equal(queue.statusCode, 200, queue.body);
  assert.equal(queue.json().analyses.length, 1);
  assert.equal(queue.json().analyses[0].productId, ambiguousProduct.json().product.id);

  const approved = await app.inject({
    method: "PUT",
    url: `/api/stores/${store.storeId}/product-analysis/${queue.json().analyses[0].id}/review`,
    headers: { cookie: store.cookie, "x-csrf-token": store.csrf },
    payload: {
      decision: "approve",
      note: "مراجعة بشرية",
      fields: [
        { key: "request_details", label: "تفاصيل الطلب", type: "textarea", required: true },
        { key: "contact_email", label: "البريد", type: "email", required: true }
      ],
      options: []
    }
  });
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(approved.json().analysis.status, "approved");
  const approvedProduct = (await db.query("SELECT fields FROM products WHERE id=$1", [ambiguousProduct.json().product.id])).rows[0];
  const approvedFields = typeof approvedProduct.fields === "string" ? JSON.parse(approvedProduct.fields) : approvedProduct.fields;
  assert.deepEqual(approvedFields.map((field) => field.key), ["request_details", "contact_email"]);

  const rawProductId = randomUUID();
  await db.query(
    `INSERT INTO products (
       id,tenant_id,store_id,product_type,name,slug,description,price_minor,currency,
       delivery_mode,source_kind,fields,options,metadata,status
     ) VALUES ($1,$2,$3,'digital','شحن رصيد MTN','mtn-raw','رقم الهاتف وشركة الاتصالات',1000,'USD','manual','local','[]','[]','{}','active')`,
    [rawProductId, store.tenantId, store.storeId]
  );
  const batch = await app.inject({
    method: "POST",
    url: `/api/stores/${store.storeId}/product-analysis/analyze-missing`,
    headers: { cookie: store.cookie, "x-csrf-token": store.csrf },
    payload: { limit: 100, offset: 0 }
  });
  assert.equal(batch.statusCode, 200, batch.body);
  assert.ok(batch.json().processed >= 1);
  const rawProduct = (await db.query("SELECT fields FROM products WHERE id=$1", [rawProductId])).rows[0];
  const rawFields = typeof rawProduct.fields === "string" ? JSON.parse(rawProduct.fields) : rawProduct.fields;
  assert.equal(rawFields[0].key, "phone");

  const crossTenantId = randomUUID();
  const crossStoreId = randomUUID();
  await db.query("INSERT INTO tenants (id,slug,name,status) VALUES ($1,'other-intelligence','Other','active')", [crossTenantId]);
  await db.query(
    `INSERT INTO stores (id,tenant_id,name,slug,activity_type,country,language,currency,template_key,status)
     VALUES ($1,$2,'Other','other-intelligence-store','digital','Türkiye','ar','USD','modern-dark','active')`,
    [crossStoreId, crossTenantId]
  );
  const forbidden = await app.inject({
    method: "GET",
    url: `/api/stores/${crossStoreId}/product-analysis?status=all`,
    headers: { cookie: store.cookie }
  });
  assert.equal(forbidden.statusCode, 404, forbidden.body);

  const page = await app.inject({ method: "GET", url: `/admin/${store.storeId}/product-intelligence` });
  assert.equal(page.statusCode, 200, page.body);
  assert.match(page.body, /Product Intelligence/);
});

test("product intelligence migrations and responsive review surface are present", async () => {
  const migration = await readFile(new URL("../migrations/009_product_intelligence.sql", import.meta.url), "utf8");
  const rls = await readFile(new URL("../migrations/010_product_intelligence_rls.sql", import.meta.url), "utf8");
  const admin = await readFile(new URL("../public/admin.html", import.meta.url), "utf8");
  const review = await readFile(new URL("../public/product-intelligence.html", import.meta.url), "utf8");
  assert.match(migration, /product_input_analyses/);
  assert.match(rls, /ENABLE ROW LEVEL SECURITY/);
  assert.match(admin, /data-intelligence-link/);
  assert.match(review, /viewport/);
  assert.match(review, /analysisQueue/);
});
