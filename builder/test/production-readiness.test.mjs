import assert from "node:assert/strict";
import test from "node:test";

import { evaluateProductionReadiness } from "../src/production-readiness.mjs";

function productionConfig(overrides = {}) {
  return {
    nodeEnv: "production",
    databaseMode: "postgres",
    databaseUrl: "postgresql://example.invalid/uchiha",
    databaseSource: "DATABASE_URL",
    previewMemoryMode: false,
    requirePersistentDatabase: true,
    databasePoolMax: 10,
    appBaseUrl: "https://builder.example.com",
    appBaseUrlSource: "APP_BASE_URL",
    storeBaseDomain: "stores.example.com",
    cookieSecure: true,
    rateLimitEnabled: true,
    demoSeed: false,
    allowDemoBilling: false,
    telegramMode: "live",
    providerMode: "live",
    deployment: {},
    ...overrides
  };
}

test("production readiness passes only for a persistent hardened environment", () => {
  const result = evaluateProductionReadiness(productionConfig(), {
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64")
  });

  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.warnings, []);
});

test("demo and memory deployment is rejected as production", () => {
  const result = evaluateProductionReadiness(
    productionConfig({
      databaseMode: "memory",
      databaseUrl: "",
      databaseSource: "none",
      previewMemoryMode: true,
      requirePersistentDatabase: false,
      appBaseUrl: "",
      cookieSecure: false,
      rateLimitEnabled: false,
      demoSeed: true,
      allowDemoBilling: true,
      telegramMode: "fake",
      providerMode: "test"
    }),
    {}
  );

  assert.equal(result.ready, false);
  const blockerCodes = new Set(result.blockers.map((item) => item.code));
  assert.equal(blockerCodes.has("preview_memory_mode"), true);
  assert.equal(blockerCodes.has("persistent_database_requirement"), true);
  assert.equal(blockerCodes.has("persistent_database"), true);
  assert.equal(blockerCodes.has("https_base_url"), true);
  assert.equal(blockerCodes.has("secure_cookies"), true);
  assert.equal(blockerCodes.has("rate_limit"), true);
  assert.equal(blockerCodes.has("demo_seed"), true);
  assert.equal(blockerCodes.has("demo_billing"), true);
  assert.equal(blockerCodes.has("encryption_key"), true);
  assert.deepEqual(
    result.warnings.map((item) => item.code),
    ["telegram_mode", "provider_mode"]
  );
});

test("provider and Telegram test modes are visible warnings without exposing secrets", () => {
  const result = evaluateProductionReadiness(
    productionConfig({ telegramMode: "fake", providerMode: "test" }),
    { APP_ENCRYPTION_KEY: "configured-secret" }
  );

  assert.equal(result.ready, true);
  assert.deepEqual(
    result.warnings.map((item) => item.code),
    ["telegram_mode", "provider_mode"]
  );
  assert.equal(JSON.stringify(result).includes("configured-secret"), false);
});
