import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { installLaunchAssetInjection } from "../src/launch-assets.mjs";
import { installPlatformAccountCore } from "../src/platform-account-core.mjs";

function routeCollector() {
  const routes = [];
  return {
    routes,
    get(path, handler) {
      routes.push({ method: "GET", path, handler });
    },
    patch(path, handler) {
      routes.push({ method: "PATCH", path, handler });
    },
    post(path, handler) {
      routes.push({ method: "POST", path, handler });
    }
  };
}

test("platform account core registers wallet, order and deposit routes", () => {
  const app = routeCollector();
  installPlatformAccountCore(app, { db: {} });
  assert.deepEqual(
    app.routes.map(({ method, path }) => `${method} ${path}`),
    [
      "GET /api/platform/account",
      "PATCH /api/platform/account",
      "GET /api/platform/wallet",
      "GET /api/platform/orders",
      "POST /api/platform/deposit-requests",
      "GET /api/platform/admin/deposit-requests",
      "GET /api/platform/admin/deposit-requests/:requestId/proof",
      "POST /api/platform/admin/deposit-requests/:requestId/review",
      "GET /api/platform/notifications",
      "POST /api/platform/notifications/read"
    ]
  );
});

test("account route receives the same v5 shell without legacy assets", async () => {
  let hook;
  const app = {
    get() {},
    addHook(name, handler) {
      assert.equal(name, "onSend");
      hook = handler;
    }
  };
  installLaunchAssetInjection(app);
  const headers = new Map();
  const reply = {
    removeHeader(name) {
      headers.delete(name);
    },
    header(name, value) {
      headers.set(name, value);
    }
  };
  const legacyBuilderDocument = "<!doctype html><html><head><link rel=\"stylesheet\" href=\"/assets/styles.css\"></head><body data-page=\"builder\"><script src=\"/assets/app.js\"></script></body></html>";
  const output = await hook(
    { method: "GET", raw: { url: "/account" } },
    reply,
    legacyBuilderDocument
  );
  assert.match(output, /id="siteHeader"/);
  assert.match(output, /id="appDrawerRoot"/);
  assert.match(output, /id="accountApp"/);
  assert.match(output, /id="bottomNav"/);
  assert.match(output, /platform-v5\.css\?v=20260805\.1/);
  assert.match(output, /account-unified\.css\?v=20260805\.1/);
  assert.match(output, /platform-v5\.js\?v=20260805\.1/);
  assert.match(output, /account-unified\.js\?v=20260805\.1/);
  assert.doesNotMatch(output, /platform-unified\.(?:css|js)/);
  assert.doesNotMatch(output, /marketing\.css/);
  assert.doesNotMatch(output, /marketing\.js/);
  assert.doesNotMatch(output, /\/assets\/app\.js/);
  assert.equal(headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(headers.get("pragma"), "no-cache");
  assert.equal(headers.get("expires"), "0");
});

test("account client remains non-destructive", async () => {
  const client = await readFile(new URL("../public/account-unified.js", import.meta.url), "utf8");
  assert.match(client, /document\.getElementById\("accountApp"\)/);
  assert.match(client, /AbortController/);
  assert.match(client, /data-tab-target/);
  assert.doesNotMatch(client, /document\.body\.innerHTML/);
  assert.doesNotMatch(client, /dialog-open/);
  assert.doesNotMatch(client, /scrollIntoView\(\{ behavior: "smooth"/);
});

test("migrations register account core, catalog publishing and deposit requests", async () => {
  const [databaseSource, accountMigration, depositMigration] = await Promise.all([
    readFile(new URL("../src/db.mjs", import.meta.url), "utf8"),
    readFile(new URL("../migrations/023_platform_account_core.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/024_platform_catalog_deposits.sql", import.meta.url), "utf8")
  ]);

  assert.match(databaseSource, /version: "023_platform_account_core"/);
  assert.match(databaseSource, /version: "024_platform_catalog_deposits"/);
  assert.match(databaseSource, /\.\.\/migrations\/024_platform_catalog_deposits\.sql/);

  for (const table of [
    "platform_account_wallets",
    "platform_account_ledger",
    "platform_account_preferences",
    "platform_account_notifications"
  ]) {
    assert.match(accountMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(accountMigration, /CREATE TRIGGER platform_users_account_core_trigger/);
  assert.match(depositMigration, /ADD COLUMN IF NOT EXISTS is_catalog_product/);
  assert.match(depositMigration, /CREATE TABLE IF NOT EXISTS platform_deposit_requests/);
  assert.match(depositMigration, /proof_bytes BYTEA NOT NULL/);
  assert.match(depositMigration, /UNIQUE \(user_id, idempotency_key\)/);
});
