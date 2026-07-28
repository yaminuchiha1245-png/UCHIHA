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
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.encryptionKey.length, 32);
});

test("non-demo PostgreSQL mode still requires DATABASE_URL", () => {
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
