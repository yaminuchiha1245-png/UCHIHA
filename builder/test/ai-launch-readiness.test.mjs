import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAiLaunchReadiness } from "../src/ai-launch-readiness.mjs";

function config(overrides = {}) {
  return {
    nodeEnv: "production",
    databaseMode: "postgres",
    databaseUrl: "postgres://test.invalid/uchiha",
    requirePersistentDatabase: true,
    appBaseUrl: "https://uchiha.example",
    telegramMode: "live",
    rateLimitEnabled: true,
    cookieSecure: true,
    previewMemoryMode: false,
    demoSeed: false,
    allowDemoBilling: false,
    ...overrides
  };
}

function database({ priceMinor = 2500, status = "active", catalog = true, migrations = 31 } = {}) {
  return {
    async status() {
      return { mode: "postgres", migrationCount: migrations };
    },
    async query() {
      return {
        rows: [{
          service_key: "ai-chatbot",
          starting_price_minor: priceMinor,
          currency: "USD",
          status,
          is_catalog_product: catalog
        }]
      };
    }
  };
}

test("AI launch readiness passes for the final secure production architecture", async () => {
  const result = await evaluateAiLaunchReadiness({
    config: config(),
    db: database(),
    env: { APP_ENCRYPTION_KEY: "production-encryption-key-present" }
  });
  assert.equal(result.ready, true, JSON.stringify(result));
  assert.deepEqual(result.blockers, []);
  assert.equal(result.architecture.tokenProvisioning, "website");
  assert.equal(result.architecture.administration, "telegram:/admin");
  assert.equal(result.architecture.openAiCredential, "per-purchased-bot-encrypted");
});

test("AI launch readiness blocks insecure, local or incomplete sale configuration", async () => {
  const result = await evaluateAiLaunchReadiness({
    config: config({
      nodeEnv: "development",
      appBaseUrl: "https://localhost:4100",
      telegramMode: "fake",
      cookieSecure: false,
      requirePersistentDatabase: false,
      allowDemoBilling: true
    }),
    db: database({ priceMinor: 0, migrations: 30 }),
    env: { APP_ENCRYPTION_KEY: "" }
  });
  assert.equal(result.ready, false);
  const codes = new Set(result.blockers.map((item) => item.code));
  for (const code of [
    "production_env_required",
    "persistent_database_required",
    "public_https_required",
    "secure_cookie_required",
    "encryption_key_required",
    "telegram_live_required",
    "demo_mode_disabled",
    "ai_migrations_pending",
    "price_required"
  ]) assert.ok(codes.has(code), `missing blocker ${code}`);
});
