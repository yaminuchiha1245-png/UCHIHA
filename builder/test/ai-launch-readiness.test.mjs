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

function database({
  priceMinor = 2500,
  status = "active",
  catalog = true,
  migrations = 33,
  identityMigrationApplied = true,
  indexPresent = true,
  promptLeaseMigrationApplied = true,
  promptLeaseTablePresent = true
} = {}) {
  return {
    async status() {
      return { mode: "postgres", migrationCount: migrations };
    },
    async query(sql) {
      const source = String(sql);
      if (source.includes("to_regclass")) {
        return {
          rows: [{
            identity_migration_applied: identityMigrationApplied,
            prompt_lease_migration_applied: promptLeaseMigrationApplied,
            unique_index_present: indexPresent,
            prompt_lease_table_present: promptLeaseTablePresent
          }]
        };
      }
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
  assert.equal(result.database.migrationCount, 33);
  assert.equal(result.database.telegramIdentityIndex, true);
  assert.equal(result.database.promptLeaseTable, true);
  assert.equal(result.architecture.tokenProvisioning, "website");
  assert.equal(result.architecture.administration, "telegram:/admin");
  assert.equal(result.architecture.openAiCredential, "per-purchased-bot-encrypted");
  assert.equal(result.architecture.purchaseGate, "fail-closed");
  assert.equal(result.architecture.usageLimitConcurrency, "durable-per-user-lease");
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
    db: database({
      priceMinor: 0,
      migrations: 30,
      identityMigrationApplied: false,
      indexPresent: false,
      promptLeaseMigrationApplied: false,
      promptLeaseTablePresent: false
    }),
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
    "ai_migration_032_missing",
    "telegram_identity_index_missing",
    "ai_migration_033_missing",
    "prompt_lease_table_missing",
    "price_required"
  ]) assert.ok(codes.has(code), `missing blocker ${code}`);
});
