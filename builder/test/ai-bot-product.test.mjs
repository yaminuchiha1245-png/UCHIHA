import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadAiProductConfig } from "../src/ai-config.mjs";
import { installAiBotProductIntegration } from "../src/ai-bot-product-integration.mjs";
import { installAiBotProductRoutes } from "../src/ai-bot-product.mjs";

function routeCollector() {
  const routes = [];
  const hooks = [];
  return {
    routes,
    hooks,
    get(path, handler) { routes.push({ method: "GET", path, handler }); },
    post(path, handler) { routes.push({ method: "POST", path, handler }); },
    patch(path, handler) { routes.push({ method: "PATCH", path, handler }); },
    addHook(name, handler) { hooks.push({ name, handler }); }
  };
}

test("AI product configuration keeps the OpenAI credential environment-only", () => {
  const config = loadAiProductConfig({
    OPENAI_API_KEY: "test-key-not-real",
    OPENAI_FREE_MODEL: "gpt-5.6-luna",
    OPENAI_PRO_MODEL: "gpt-5.6-sol",
    OPENAI_IMAGE_MODEL: "gpt-image-2"
  });
  assert.equal(config.openAiApiKey, "test-key-not-real");
  assert.equal(config.openAiBaseUrl, "https://api.openai.com/v1");
  assert.equal(config.openAiFreeModel, "gpt-5.6-luna");
  assert.equal(config.openAiProModel, "gpt-5.6-sol");
  assert.equal(config.openAiImageModel, "gpt-image-2");
});

test("AI product registers purchase, merchant admin, platform admin, and webhook routes", () => {
  const app = routeCollector();
  installAiBotProductRoutes(app, {
    db: {},
    config: {
      openAiApiKey: "",
      openAiBaseUrl: "https://api.openai.com/v1",
      openAiBillingUrl: "https://platform.openai.com/settings/organization/billing/overview",
      openAiFreeModel: "gpt-5.6-luna",
      openAiProModel: "gpt-5.6-sol",
      openAiImageModel: "gpt-image-2"
    }
  });
  const contracts = new Set(app.routes.map(({ method, path }) => `${method} ${path}`));
  for (const contract of [
    "GET /products/ai-chatbot",
    "GET /api/public/products/ai-chatbot",
    "GET /api/platform/ai-bots",
    "POST /api/platform/ai-bots/purchase",
    "POST /api/platform/ai-bots/:instanceId/token",
    "PATCH /api/platform/ai-bots/:instanceId",
    "PATCH /api/platform/ai-bots/:instanceId/models/:slug",
    "POST /api/platform/ai-bots/:instanceId/users/:telegramUserId/pro",
    "POST /api/platform/ai-bots/:instanceId/users/:telegramUserId/ban",
    "GET /api/platform/admin/ai-product",
    "PATCH /api/platform/admin/ai-product",
    "POST /webhooks/ai-bots/:instanceId"
  ]) {
    assert.ok(contracts.has(contract), `missing route ${contract}`);
  }
});

test("AI product is surfaced through the existing Telegram bots catalog branch", async () => {
  const app = routeCollector();
  installAiBotProductIntegration(app, { db: {} });
  assert.ok(app.routes.some((route) => route.method === "GET" && route.path === "/product/ai-chatbot"));
  assert.ok(app.hooks.some((hook) => hook.name === "preSerialization"));

  const migration = await readFile(new URL("../migrations/025_ai_bot_product.sql", import.meta.url), "utf8");
  assert.match(migration, /service_key[^;]*ai-chatbot/s);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS platform_catalog_orders/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_bot_instances/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_bot_model_profiles/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_bot_end_users/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_bot_usage/);
  assert.match(migration, /token_ciphertext TEXT/);
  assert.match(migration, /token_fingerprint TEXT UNIQUE/);
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

test("database migration registry includes AI product migration", async () => {
  const source = await readFile(new URL("../src/db.mjs", import.meta.url), "utf8");
  assert.match(source, /version: "025_ai_bot_product"/);
  assert.match(source, /\.\.\/migrations\/025_ai_bot_product\.sql/);
});

test("AI product client contains purchase, Telegram setup, PRO and model administration surfaces", async () => {
  const [document, client, styles] = await Promise.all([
    readFile(new URL("../public/ai-bot-product.html", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-bot-product.js", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-bot-product.css", import.meta.url), "utf8")
  ]);
  assert.match(document, /id="purchaseForm"/);
  assert.match(document, /id="tokenForm"/);
  assert.match(document, /id="modelsGrid"/);
  assert.match(document, /id="usersList"/);
  assert.match(document, /تجديد رصيد OpenAI/);
  assert.match(client, /\/api\/platform\/ai-bots\/purchase/);
  assert.match(client, /\/users\/\$\{telegramId\}\/pro/);
  assert.match(client, /\/models\/\$\{encodeURIComponent\(form\.dataset\.model\)\}/);
  assert.match(styles, /\.ai-model-card\.pro/);
});