import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.mjs";

test("explicit Railway preview memory mode runs safely without PostgreSQL", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    PREVIEW_MEMORY_MODE: "true",
    REQUIRE_PERSISTENT_DATABASE: "false",
    DEMO_SEED: "true",
    DATABASE_MODE: "postgres",
    DATABASE_URL: "",
    HOST: "0.0.0.0",
    COOKIE_SECURE: "true"
  });

  assert.equal(config.previewMemoryMode, true);
  assert.equal(config.requirePersistentDatabase, false);
  assert.equal(config.demoSeed, true);
  assert.equal(config.databaseMode, "memory");
  assert.equal(config.databaseUrl, "");
  assert.equal(config.databaseSource, "none");
  assert.equal(config.databaseFallbackReason, "preview_memory_mode");
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.telegramMode, "fake");
  assert.equal(config.providerMode, "test");
  assert.equal(config.allowDemoBilling, true);
  assert.equal(config.encryptionKey.length, 32);
});

test("an unresolved Railway reference is ignored in explicit preview memory mode", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    PREVIEW_MEMORY_MODE: "true",
    REQUIRE_PERSISTENT_DATABASE: "false",
    DATABASE_URL: "${{Postgres.DATABASE_URL}}"
  });

  assert.equal(config.databaseMode, "memory");
  assert.equal(config.databaseSource, "none");
});

test("Railway private PostgreSQL URL is accepted when DATABASE_URL is unavailable", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    PREVIEW_MEMORY_MODE: "false",
    REQUIRE_PERSISTENT_DATABASE: "true",
    DEMO_SEED: "false",
    DATABASE_MODE: "postgres",
    DATABASE_PRIVATE_URL: "postgresql://user:password@postgres.railway.internal:5432/railway",
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64")
  });

  assert.equal(config.databaseMode, "postgres");
  assert.equal(config.databaseSource, "DATABASE_PRIVATE_URL");
  assert.match(config.databaseUrl, /^postgresql:\/\//);
});

test("persistent preview data never derives an encryption key from database credentials", () => {
  assert.throws(
    () => loadConfig({
      NODE_ENV: "production",
      DATABASE_MODE: "postgres",
      DATABASE_URL: "postgresql://example.invalid/platform",
      DEMO_SEED: "true"
    }),
    /APP_ENCRYPTION_KEY is required/
  );
});

test("standard PG variables are assembled into a safe PostgreSQL URL", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_MODE: "postgres",
    REQUIRE_PERSISTENT_DATABASE: "true",
    PGHOST: "postgres.railway.internal",
    PGPORT: "5432",
    PGUSER: "uchiha user",
    PGPASSWORD: "secret:/?#[]@!",
    PGDATABASE: "uchiha builder"
  });
  const parsed = new URL(config.databaseUrl);

  assert.equal(config.databaseSource, "PG*");
  assert.equal(parsed.hostname, "postgres.railway.internal");
  assert.equal(parsed.port, "5432");
  assert.equal(decodeURIComponent(parsed.username), "uchiha user");
  assert.equal(decodeURIComponent(parsed.password), "secret:/?#[]@!");
  assert.equal(decodeURIComponent(parsed.pathname), "/uchiha builder");
});

test("Railway public domain becomes the application base URL automatically", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    PREVIEW_MEMORY_MODE: "true",
    REQUIRE_PERSISTENT_DATABASE: "false",
    RAILWAY_PUBLIC_DOMAIN: "uchiha-production.up.railway.app/"
  });

  assert.equal(config.appBaseUrl, "https://uchiha-production.up.railway.app");
  assert.equal(config.appBaseUrlSource, "RAILWAY_PUBLIC_DOMAIN");
});

test("explicit APP_BASE_URL takes precedence over the Railway domain", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    PREVIEW_MEMORY_MODE: "true",
    REQUIRE_PERSISTENT_DATABASE: "false",
    APP_BASE_URL: "https://preview.uchiha.example/",
    RAILWAY_PUBLIC_DOMAIN: "ignored.up.railway.app"
  });

  assert.equal(config.appBaseUrl, "https://preview.uchiha.example");
  assert.equal(config.appBaseUrlSource, "APP_BASE_URL");
});

test("persistent production still requires a PostgreSQL connection", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        PREVIEW_MEMORY_MODE: "false",
        REQUIRE_PERSISTENT_DATABASE: "true",
        DEMO_SEED: "false",
        DATABASE_MODE: "postgres",
        DATABASE_URL: ""
      }),
    /DATABASE_URL is required/
  );
});

test("production cannot use memory unless explicit preview mode is enabled", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        PREVIEW_MEMORY_MODE: "false",
        REQUIRE_PERSISTENT_DATABASE: "false",
        DEMO_SEED: "true",
        DATABASE_MODE: "memory"
      }),
    /Production cannot run with the in-memory database/
  );
});

test("preview and persistent requirements cannot be enabled together", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        PREVIEW_MEMORY_MODE: "true",
        REQUIRE_PERSISTENT_DATABASE: "true"
      }),
    /cannot both be enabled/
  );
});

test("database pool configuration is bounded", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "test",
        DATABASE_MODE: "memory",
        DATABASE_POOL_MAX: "0"
      }),
    /Invalid integer configuration/
  );
});

test("live provider configuration fails closed without a clean HTTPS contract", () => {
  assert.throws(
    () => loadConfig({
      NODE_ENV: "test",
      DATABASE_MODE: "memory",
      UCHIHA_API_1_MODE: "live",
      UCHIHA_API_1_ADAPTER: "http-json-v1",
      UCHIHA_API_1_BASE_URL: "http://provider.example/api",
      UCHIHA_API_1_TOKEN: "test-only-token"
    }),
    /clean HTTPS URL/
  );
  assert.throws(
    () => loadConfig({
      NODE_ENV: "test",
      DATABASE_MODE: "memory",
      UCHIHA_API_1_ADAPTER: "unknown-provider"
    }),
    /ADAPTER is not supported/
  );
});
