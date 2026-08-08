import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { installAiBotModelAdminRoutes } from "../src/ai-bot-model-admin.mjs";
import { loadAiProductConfig } from "../src/ai-config.mjs";
import { installAiBotProductIntegration } from "../src/ai-bot-product-integration.mjs";
import { installAiBotProductRoutes } from "../src/ai-bot-product.mjs";
import { installAiBotUsageLimitRoutes } from "../src/ai-bot-usage-limits.mjs";

function routeCollector() {
  const routes = [];
  const hooks = [];
  return {
    routes,
    hooks,
    get(path, handler) { routes.push({ method: "GET", path, handler }); },
    post(path, handler) { routes.push({ method: "POST", path, handler }); },
    patch(path, handler) { routes.push({ method: "PATCH", path, handler }); },
    delete(path, handler) { routes.push({ method: "DELETE", path, handler }); },
    addHook(name, handler) { hooks.push({ name, handler }); }
  };
}

test("AI product configuration keeps the OpenAI credential environment-only and clamps the platform safety cap", () => {
  const config = loadAiProductConfig({
    OPENAI_API_KEY: "test-key-not-real",
    OPENAI_FREE_MODEL: "gpt-5.6-luna",
    OPENAI_PRO_MODEL: "gpt-5.6-sol",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    AI_PLATFORM_DAILY_REQUEST_LIMIT: "75000"
  });
  assert.equal(config.openAiApiKey, "test-key-not-real");
  assert.equal(config.openAiBaseUrl, "https://api.openai.com/v1");
  assert.equal(config.openAiFreeModel, "gpt-5.6-luna");
  assert.equal(config.openAiProModel, "gpt-5.6-sol");
  assert.equal(config.openAiImageModel, "gpt-image-2");
  assert.equal(config.aiPlatformDailyRequestLimit, 75000);
});

test("AI product registers purchase, merchant admin, usage limits, model creation, and webhook routes", () => {
  const app = routeCollector();
  const config = {
    openAiApiKey: "",
    openAiBaseUrl: "https://api.openai.com/v1",
    openAiBillingUrl: "https://platform.openai.com/settings/organization/billing/overview",
    openAiFreeModel: "gpt-5.6-luna",
    openAiProModel: "gpt-5.6-sol",
    openAiImageModel: "gpt-image-2",
    aiPlatformDailyRequestLimit: 50000
  };
  installAiBotProductRoutes(app, { db: {}, config });
  installAiBotModelAdminRoutes(app, { db: {} });
  installAiBotUsageLimitRoutes(app, { db: {}, config });
  const contracts = new Set(app.routes.map(({ method, path }) => `${method} ${path}`));
  for (const contract of [
    "GET /products/ai-chatbot",
    "GET /api/public/products/ai-chatbot",
    "GET /api/platform/ai-bots",
    "POST /api/platform/ai-bots/purchase",
    "POST /api/platform/ai-bots/:instanceId/token",
    "PATCH /api/platform/ai-bots/:instanceId",
    "GET /api/platform/ai-bots/:instanceId/limits",
    "PATCH /api/platform/ai-bots/:instanceId/limits",
    "POST /api/platform/ai-bots/:instanceId/models",
    "PATCH /api/platform/ai-bots/:instanceId/models/:slug",
    "DELETE /api/platform/ai-bots/:instanceId/models/:slug",
    "POST /api/platform/ai-bots/:instanceId/users/:telegramUserId/pro",
    "POST /api/platform/ai-bots/:instanceId/users/:telegramUserId/ban",
    "GET /api/platform/admin/ai-product",
    "PATCH /api/platform/admin/ai-product",
    "POST /webhooks/ai-bots/:instanceId"
  ]) {
    assert.ok(contracts.has(contract), `missing route ${contract}`);
  }
  assert.ok(app.hooks.some((hook) => hook.name === "preHandler"));
});

test("AI product is surfaced through the existing Telegram bots catalog branch and installs webhook lifecycle guards", async () => {
  const app = routeCollector();
  installAiBotProductIntegration(app, { db: {} });
  assert.ok(app.routes.some((route) => route.method === "GET" && route.path === "/product/ai-chatbot"));
  assert.ok(app.hooks.some((hook) => hook.name === "preHandler"));
  assert.ok(app.hooks.some((hook) => hook.name === "onResponse"));
  assert.ok(app.hooks.some((hook) => hook.name === "preSerialization"));

  const migration = await readFile(new URL("../migrations/025_ai_bot_product.sql", import.meta.url), "utf8");
  const webhookMigration = await readFile(new URL("../migrations/026_ai_bot_webhook_idempotency.sql", import.meta.url), "utf8");
  const limitsMigration = await readFile(new URL("../migrations/027_ai_bot_usage_limits.sql", import.meta.url), "utf8");
  assert.match(migration, /'ai_chatbot'/);
  assert.match(migration, /'ai-chatbot'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS platform_catalog_orders/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_bot_instances/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_bot_model_profiles/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_bot_end_users/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_bot_usage/);
  assert.match(migration, /token_ciphertext TEXT/);
  assert.match(migration, /token_fingerprint TEXT UNIQUE/);
  assert.match(webhookMigration, /CREATE TABLE IF NOT EXISTS ai_bot_telegram_updates/);
  assert.match(webhookMigration, /PRIMARY KEY \(instance_id, update_id\)/);
  assert.match(limitsMigration, /free_daily_request_limit INTEGER NOT NULL DEFAULT 30/);
  assert.match(limitsMigration, /pro_daily_request_limit INTEGER NOT NULL DEFAULT 300/);
  assert.match(limitsMigration, /free_daily_image_limit INTEGER NOT NULL DEFAULT 2/);
  assert.match(limitsMigration, /pro_daily_image_limit INTEGER NOT NULL DEFAULT 30/);
});

test("OpenAI billing URL is hidden from merchants and retained for platform admins", async () => {
  const app = routeCollector();
  installAiBotProductIntegration(app, {
    db: { query: async () => ({ rows: [] }) },
    config: { platformOpenAiBillingUrl: "https://platform.openai.com/settings/organization/billing/overview" }
  });
  const hook = app.hooks.find((item) => item.name === "preSerialization").handler;
  const merchant = await hook(
    { method: "GET", raw: { url: "/api/platform/ai-bots/11111111-1111-4111-8111-111111111111" } },
    {},
    { openAi: { configured: true, billingUrl: "https://should-not-leak.invalid" } }
  );
  assert.deepEqual(merchant.openAi, { configured: true });

  const platformAdmin = await hook(
    { method: "GET", raw: { url: "/api/platform/admin/ai-product" } },
    {},
    { openAi: { configured: true, billingUrl: "/products/ai-chatbot" } }
  );
  assert.equal(
    platformAdmin.openAi.billingUrl,
    "https://platform.openai.com/settings/organization/billing/overview"
  );
});

test("database migration registry includes AI product, webhook guard, and usage limit migrations", async () => {
  const source = await readFile(new URL("../src/db.mjs", import.meta.url), "utf8");
  assert.match(source, /version: "025_ai_bot_product"/);
  assert.match(source, /\.\.\/migrations\/025_ai_bot_product\.sql/);
  assert.match(source, /version: "026_ai_bot_webhook_idempotency"/);
  assert.match(source, /\.\.\/migrations\/026_ai_bot_webhook_idempotency\.sql/);
  assert.match(source, /version: "027_ai_bot_usage_limits"/);
  assert.match(source, /\.\.\/migrations\/027_ai_bot_usage_limits\.sql/);
});

test("AI product client contains purchase, Telegram setup, PRO, dynamic models, and usage limit administration", async () => {
  const [document, client, modelAdmin, limitsAdmin, styles, telegram] = await Promise.all([
    readFile(new URL("../public/ai-bot-product.html", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-bot-product.js", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-bot-model-admin.js", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-bot-usage-limits.js", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-bot-product.css", import.meta.url), "utf8"),
    readFile(new URL("../src/telegram.mjs", import.meta.url), "utf8")
  ]);
  assert.match(document, /id="purchaseForm"/);
  assert.match(document, /id="tokenForm"/);
  assert.match(document, /id="addModelForm"/);
  assert.match(document, /id="limitsForm"/);
  assert.match(document, /id="modelsGrid"/);
  assert.match(document, /id="usersList"/);
  assert.match(document, /تجديد رصيد OpenAI/);
  assert.match(client, /\/api\/platform\/ai-bots\/purchase/);
  assert.match(client, /\/users\/\$\{telegramId\}\/pro/);
  assert.match(client, /\/models\/\$\{encodeURIComponent\(form\.dataset\.model\)\}/);
  assert.match(modelAdmin, /method: "POST"/);
  assert.match(modelAdmin, /method: "DELETE"/);
  assert.match(limitsAdmin, /freeDailyRequests/);
  assert.match(limitsAdmin, /proDailyRequests/);
  assert.match(limitsAdmin, /freeDailyImages/);
  assert.match(limitsAdmin, /proDailyImages/);
  assert.match(styles, /\.ai-model-card\.pro/);
  assert.match(telegram, /button\.style = "primary"/);
  assert.match(telegram, /label\.startsWith\("🔵"\)/);
});