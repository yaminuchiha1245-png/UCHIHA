import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.mjs";

test("Railway demo preview falls back to memory when PostgreSQL URL is unavailable", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    DEMO_SEED: "true",
    DATABASE_MODE: "postgres",
    DATABASE_URL: "",
    HOST: "0.0.0.0",
    COOKIE_SECURE: "true"
  });

  assert.equal(config.demoSeed, true);
  assert.equal(config.databaseMode, "memory");
  assert.equal(config.databaseUrl, "");
  assert.equal(config.databaseFallbackReason, "missing_database_url");
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.encryptionKey.length, 32);
});

test("an unresolved Railway reference is treated as missing rather than as a password", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    DEMO_SEED: "true",
    DATABASE_MODE: "postgres",
    DATABASE_URL: "${{Postgres.DATABASE_URL}}"
  });

  assert.equal(config.databaseMode, "memory");
  assert.equal(config.databaseSource, "none");
});

test("Railway private PostgreSQL URL is accepted when DATABASE_URL is unavailable", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    DEMO_SEED: "true",
    DATABASE_MODE: "postgres",
    DATABASE_PRIVATE_URL: "postgresql://user:password@postgres.railway.internal:5432/railway"
  });

  assert.equal(config.databaseMode, "postgres");
  assert.equal(config.databaseSource, "DATABASE_PRIVATE_URL");
  assert.match(config.databaseUrl, /^postgresql:\/\//);
});

test("standard PG variables are assembled into a safe PostgreSQL URL", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_MODE: "postgres",
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
    DEMO_SEED: "true",
    DATABASE_MODE: "memory",
    RAILWAY_PUBLIC_DOMAIN: "uchiha-production.up.railway.app/"
  });

  assert.equal(config.appBaseUrl, "https://uchiha-production.up.railway.app");
  assert.equal(config.appBaseUrlSource, "RAILWAY_PUBLIC_DOMAIN");
});

test("explicit APP_BASE_URL takes precedence over the Railway domain", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    DEMO_SEED: "true",
    DATABASE_MODE: "memory",
    APP_BASE_URL: "https://preview.uchiha.example/",
    RAILWAY_PUBLIC_DOMAIN: "ignored.up.railway.app"
  });

  assert.equal(config.appBaseUrl, "https://preview.uchiha.example");
  assert.equal(config.appBaseUrlSource, "APP_BASE_URL");
});

test("non-demo PostgreSQL mode still requires a PostgreSQL connection", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        DEMO_SEED: "false",
        DATABASE_MODE: "postgres",
        DATABASE_URL: ""
      }),
    /DATABASE_URL is required/
  );
});

test("non-demo production cannot use the in-memory database", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        DEMO_SEED: "false",
        DATABASE_MODE: "memory"
      }),
    /Production cannot run with the in-memory database/
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
