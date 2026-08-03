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

test("account route receives one unified platform document", async () => {
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
  const legacyBuilderDocument = "<!doctype html><html><head><link rel=\"stylesheet\" href=\"/assets/styles.css\"></head><body data-page=\"builder\"><script src=\"/assets/app.js\"></script></body></html>";
  const output = await hook(
    { method: "GET", raw: { url: "/account" } },
    reply,
    legacyBuilderDocument
  );
  assert.match(output, /id="siteHeader"/);
  assert.match(output, /id="accountApp"/);
  assert.match(output, /marketing\.css\?v=20260803\.3/);
  assert.match(output, /account-unified\.css\?v=20260803\.3/);
  assert.match(output, /marketing\.js\?v=20260803\.3/);
  assert.match(output, /account-unified\.js\?v=20260803\.3/);
  assert.doesNotMatch(output, /\/assets\/app\.js/);
  assert.doesNotMatch(output, /data-page="builder"/);
  assert.equal(headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(headers.get("cache-control"), "no-cache, max-age=0, must-revalidate");
});

test("unified account client does not replace the whole body or lock dialogs", async () => {
  const client = await readFile(new URL("../public/account-unified.js", import.meta.url), "utf8");
  assert.match(client, /document\.getElementById\("accountApp"\)/);
  assert.match(client, /AbortController/);
  assert.match(client, /data-tab-target/);
  assert.doesNotMatch(client, /document\.body\.innerHTML/);
  assert.doesNotMatch(client, /dialog-open/);
  assert.doesNotMatch(client, /scrollIntoView\(\{ behavior: "smooth"/);
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
