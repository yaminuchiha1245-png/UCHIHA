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

test("platform account core registers the first customer account routes", () => {
  const app = routeCollector();
  installPlatformAccountCore(app, { db: {} });
  assert.deepEqual(
    app.routes.map(({ method, path }) => `${method} ${path}`),
    [
      "GET /api/platform/account",
      "PATCH /api/platform/account",
      "GET /api/platform/wallet",
      "GET /api/platform/notifications",
      "POST /api/platform/notifications/read"
    ]
  );
});

test("account page receives its isolated dashboard assets", async () => {
  let hook;
  const app = {
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
  const html = "<!doctype html><html><head></head><body><main></main></body></html>";
  const output = await hook(
    { method: "GET", raw: { url: "/account" } },
    reply,
    html
  );
  assert.match(output, /platform-account-core\.css\?v=2026\.08\.03\.2/);
  assert.match(output, /platform-account-core\.js\?v=2026\.08\.03\.2/);
  assert.equal(headers.get("cache-control"), "no-cache, max-age=0, must-revalidate");
});

test("migration 023 creates persistent wallet preferences notifications and ledger", async () => {
  const migration = await readFile(
    new URL("../migrations/023_platform_account_core.sql", import.meta.url),
    "utf8"
  );
  for (const table of [
    "platform_account_wallets",
    "platform_account_ledger",
    "platform_account_preferences",
    "platform_account_notifications"
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /CREATE TRIGGER platform_users_account_core_trigger/);
  assert.match(migration, /ON CONFLICT \(user_id\) DO NOTHING/);
});
