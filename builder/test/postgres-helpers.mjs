import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadConfig } from "../src/config.mjs";
import { createDatabase } from "../src/db.mjs";
import { buildApp } from "../src/app.mjs";
import { seedEnvironment } from "../src/seed.mjs";

const { Client } = pg;

export const proofImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0iwAAAAASUVORK5CYII=";

export function cookieHeader(response) {
  const raw = response.headers["set-cookie"];
  assert.ok(raw, "authentication must set a cookie");
  return raw.split(";")[0];
}

function requiredPostgresUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url && process.env.REQUIRE_POSTGRES_TESTS === "true") {
    throw new Error("TEST_DATABASE_URL is required when REQUIRE_POSTGRES_TESTS=true");
  }
  return url || "";
}

export function postgresAvailable() {
  return Boolean(requiredPostgresUrl());
}

function databaseUrl(base, name) {
  const parsed = new URL(base);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

export async function createPostgresHarness(context, { demoSeed = false, configureApp = null } = {}) {
  const base = requiredPostgresUrl();
  if (!base) return null;
  const databaseName = `uchiha_test_${randomUUID().replaceAll("-", "")}`;
  const adminUrl = databaseUrl(base, "postgres");
  const admin = new Client({ connectionString: adminUrl, ssl: false });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${databaseName}`);
  await admin.end();

  const url = databaseUrl(base, databaseName);
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_MODE: "postgres",
    DATABASE_URL: url,
    DATABASE_SSL: "false",
    ALLOW_DEMO_BILLING: "true",
    DEMO_SEED: demoSeed ? "true" : "false",
    TELEGRAM_MODE: "fake",
    UCHIHA_API_1_MODE: "test",
    APP_BASE_URL: "http://builder.test",
    STORE_BASE_DOMAIN: "uchiha.store",
    COOKIE_SECURE: "false",
    ENCRYPTION_KEY: "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYQ"
  });
  config.offerSeed = {
    name: "UCHIHA Full PostgreSQL Test",
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
  if (typeof configureApp === "function") await configureApp(app, { db, config });
  await app.ready();

  context.after(async () => {
    await app.close().catch(() => undefined);
    await db.close().catch(() => undefined);
    const cleanup = new Client({ connectionString: adminUrl, ssl: false });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await cleanup.end();
  });
  return { app, db, config, url, databaseName };
}

export async function createOwner(app, email = `owner-${randomUUID()}@example.com`) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { displayName: "مالك اختبار PostgreSQL", email, password: "owner-postgres-password" }
  });
  assert.equal(response.statusCode, 201, response.body);
  const body = response.json();
  return { id: body.user.id, csrf: body.csrfToken, cookie: cookieHeader(response), email };
}

export async function createStore(db, ownerId, {
  slug = `store-${randomUUID().slice(0, 8)}`,
  name = "متجر اختبار",
  currency = "USD",
  colors = ["#126b45", "#0d3526"]
} = {}) {
  const tenantId = randomUUID();
  const storeId = randomUUID();
  await db.query("INSERT INTO tenants (id,slug,name,status) VALUES ($1,$2,$3,'active')", [tenantId, `${slug}-tenant`, `${name} Tenant`]);
  await db.query(
    `INSERT INTO stores (id,tenant_id,name,slug,activity_type,description,country,language,currency,template_key,status,contact_data)
     VALUES ($1,$2,$3,$4,'digital-products','متجر اختبار','Türkiye','ar',$5,'professional-dark','active',$6)`,
    [storeId, tenantId, name, slug, currency, JSON.stringify({ whatsapp: "+905550000000", telegram: "@support" })]
  );
  await db.query(
    `INSERT INTO store_design_tokens (
       tenant_id,store_id,primary_color,secondary_color,background_color,surface_color,text_color,
       muted_text_color,border_color,success_color,warning_color,danger_color,font_family,border_radius,
       button_style,card_style,logo_url,favicon_url,cover_url
     ) VALUES ($1,$2,$3,$4,'#f6f7fb','#ffffff','#111827','#6b7280','#d1d5db','#168a55','#ca8a04','#dc2626','Tajawal','14px','solid','soft',NULL,NULL,NULL)`,
    [tenantId, storeId, colors[0], colors[1]]
  );
  await db.query(
    `INSERT INTO store_experience_settings (
       store_id,tenant_id,identity_verification_enabled,floating_support_enabled,light_mode_enabled,storefront_api_enabled
     ) VALUES ($1,$2,TRUE,TRUE,TRUE,TRUE)`,
    [storeId, tenantId]
  );
  await db.query(
    "INSERT INTO tenant_memberships (tenant_id,user_id,role_key,status) VALUES ($1,$2,'owner','active')",
    [tenantId, ownerId]
  );
  return { tenantId, storeId, slug, currency, name };
}

export async function registerCustomer(app, slug, email = `buyer-${randomUUID()}@example.com`) {
  const response = await app.inject({
    method: "POST",
    url: `/api/public/stores/${slug}/customers/register`,
    payload: { displayName: "عميل PostgreSQL", email, password: "buyer-postgres-password", phone: "+905550000000" }
  });
  assert.equal(response.statusCode, 201, response.body);
  return { ...response.json(), cookie: cookieHeader(response), email };
}

export async function addProduct(db, store, {
  name = "منتج PostgreSQL",
  priceMinor = 2500,
  stockQuantity = 10,
  fields = []
} = {}) {
  const productId = randomUUID();
  const slug = `product-${productId.slice(0, 8)}`;
  await db.query(
    `INSERT INTO products (
       id,tenant_id,store_id,product_type,name,slug,description,price_minor,currency,stock_quantity,
       min_quantity,max_quantity,delivery_mode,fields,options,status
     ) VALUES ($1,$2,$3,'digital',$4,$5,'منتج اختباري',$6,$7,$8,1,10,'manual',$9,'[]','active')`,
    [productId, store.tenantId, store.storeId, name, slug, priceMinor, store.currency, stockQuantity, JSON.stringify(fields)]
  );
  return { id: productId, slug, name, priceMinor };
}