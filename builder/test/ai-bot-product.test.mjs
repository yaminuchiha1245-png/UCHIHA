import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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

test("AI product configuration uses current launch model defaults without requiring a platform OpenAI key", () => {
  const config = loadAiProductConfig({});
  assert.equal(config.openAiApiKey, "");
  assert.equal(config.openAiBaseUrl, "https://api.openai.com/v1");
  assert.equal(config.openAiFreeModel, "gpt-5.6-luna");
  assert.equal(config.openAiProModel, "gpt-5.6-sol");
  assert.equal(config.openAiImageModel, "gpt-image-2");
});

test("AI product registers purchase, website token provisioning, usage controls and webhook routes", () => {
  const app = routeCollector();
  const config = {
    openAiApiKey: "purchase-does-not-require-openai",
    openAiBaseUrl: "https://api.openai.com/v1",
    openAiBillingUrl: "https://platform.openai.com/settings/organization/billing/overview",
    openAiFreeModel: "gpt-5.6-luna",
    openAiProModel: "gpt-5.6-sol",
    openAiImageModel: "gpt-image-2"
  };
  installAiBotProductRoutes(app, { db: {}, config });
  installAiBotUsageLimitRoutes(app, { db: {}, config });
  const contracts = new Set(app.routes.map(({ method, path }) => `${method} ${path}`));
  for (const contract of [
    "GET /products/ai-chatbot",
    "GET /api/public/products/ai-chatbot",
    "GET /api/platform/ai-bots",
    "POST /api/platform/ai-bots/purchase",
    "POST /api/platform/ai-bots/:instanceId/token",
    "GET /api/platform/ai-bots/:instanceId/limits",
    "PATCH /api/platform/ai-bots/:instanceId/limits",
    "GET /api/platform/admin/ai-product",
    "PATCH /api/platform/admin/ai-product",
    "POST /webhooks/ai-bots/:instanceId"
  ]) assert.ok(contracts.has(contract), `missing route ${contract}`);
});

test("AI product is surfaced through Telegram bot catalog and protects webhook update idempotency", async () => {
  const app = routeCollector();
  installAiBotProductIntegration(app, { db: {} });
  assert.ok(app.routes.some((route) => route.method === "GET" && route.path === "/product/ai-chatbot"));
  assert.ok(app.hooks.some((hook) => hook.name === "preHandler"));
  assert.ok(app.hooks.some((hook) => hook.name === "onResponse"));
  assert.ok(app.hooks.some((hook) => hook.name === "preSerialization"));

  const [migration, webhookMigration, limitsMigration] = await Promise.all([
    readFile(new URL("../migrations/025_ai_bot_product.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/026_ai_bot_webhook_idempotency.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/027_ai_bot_usage_limits.sql", import.meta.url), "utf8")
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_bot_instances/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_bot_model_profiles/);
  assert.match(migration, /token_ciphertext TEXT/);
  assert.match(webhookMigration, /PRIMARY KEY \(instance_id, update_id\)/);
  assert.match(limitsMigration, /free_daily_request_limit INTEGER NOT NULL DEFAULT 30/);
  assert.match(limitsMigration, /pro_daily_request_limit INTEGER NOT NULL DEFAULT 300/);
});

test("web compatibility reports per-bot OpenAI state and never exposes a central provider account", async () => {
  const app = routeCollector();
  installAiBotProductIntegration(app, {
    db: { query: async () => ({ rows: [{ openai_api_key_ciphertext: "encrypted" }] }) }
  });
  const hook = app.hooks.find((item) => item.name === "preSerialization").handler;
  const merchant = await hook(
    { method: "GET", raw: { url: "/api/platform/ai-bots/11111111-1111-4111-8111-111111111111" } },
    {},
    { openAi: { configured: false, billingUrl: "https://must-not-leak.invalid" } }
  );
  assert.deepEqual(merchant.openAi, { configured: true });

  const platformAdmin = await hook(
    { method: "GET", raw: { url: "/api/platform/admin/ai-product" } },
    {},
    { openAi: { configured: true, billingUrl: "https://must-not-leak.invalid" } }
  );
  assert.deepEqual(platformAdmin.openAi, { mode: "per_bot", centrallyManaged: false });
});

test("database migration registry includes the complete AI launch chain", async () => {
  const source = await readFile(new URL("../src/db.mjs", import.meta.url), "utf8");
  for (const version of [
    "025_ai_bot_product",
    "026_ai_bot_webhook_idempotency",
    "027_ai_bot_usage_limits",
    "028_ai_bot_telegram_admin",
    "029_ai_bot_end_user_audit",
    "030_ai_bot_openai_key_reuse",
    "031_ai_bot_catalog_launch_copy"
  ]) assert.match(source, new RegExp(`version: "${version}"`));
});

test("launch customer UI stays purchase-only while Telegram V1 uses supported primary button style", async () => {
  const [document, client, telegram] = await Promise.all([
    readFile(new URL("../public/ai-bot-purchase.html", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-bot-purchase.js", import.meta.url), "utf8"),
    readFile(new URL("../src/telegram.mjs", import.meta.url), "utf8")
  ]);
  assert.match(document, /id="purchaseForm"/);
  assert.match(document, /Telegram Bot Token/);
  assert.doesNotMatch(document, /id="modelsGrid"/);
  assert.doesNotMatch(document, /OpenAI API Key/);
  assert.match(client, /ownerTelegramId/);
  assert.match(client, /PURCHASE_INTENT_KEY/);
  assert.match(telegram, /button\.style = "primary"/);
  assert.match(telegram, /label\.startsWith\("🔵"\)/);
});
