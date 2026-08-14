import test from "node:test";
import assert from "node:assert/strict";
import { installLaunchReadinessHttp } from "../src/launch-readiness-http.mjs";

function fakeApp() {
  let hook;
  return {
    addHook(name, handler) {
      assert.equal(name, "preSerialization");
      hook = handler;
    },
    get hook() {
      return hook;
    }
  };
}

function fakeReply() {
  return {
    statusCode: 200,
    code(value) {
      this.statusCode = value;
      return this;
    }
  };
}

test("production readiness fails closed when latest migration is missing", async () => {
  const app = fakeApp();
  const db = {
    async status() {
      return {
        mode: "postgres",
        migrationCount: 45,
        latestMigrationVersion: "046_active_bot_provisioning_guard",
        latestMigrationApplied: false,
        latencyMs: 3
      };
    }
  };
  installLaunchReadinessHttp(app, {
    db,
    config: { nodeEnv: "production", databaseMode: "postgres", previewMemoryMode: false }
  });
  const reply = fakeReply();
  const payload = await app.hook(
    { method: "GET", raw: { url: "/ready" } },
    reply,
    { status: "ok" }
  );
  assert.equal(reply.statusCode, 503);
  assert.equal(payload.status, "degraded");
  assert.equal(payload.error, "database_schema_outdated");
  assert.equal(payload.latestMigrationApplied, false);
});

test("production readiness exposes the applied latest migration", async () => {
  const app = fakeApp();
  const db = {
    async status() {
      return {
        mode: "postgres",
        migrationCount: 46,
        latestMigrationVersion: "046_active_bot_provisioning_guard",
        latestMigrationApplied: true,
        latencyMs: 4
      };
    }
  };
  installLaunchReadinessHttp(app, {
    db,
    config: { nodeEnv: "production", databaseMode: "postgres", previewMemoryMode: false }
  });
  const reply = fakeReply();
  const payload = await app.hook(
    { method: "GET", raw: { url: "/ready?probe=1" } },
    reply,
    { status: "ok", deployment: "production" }
  );
  assert.equal(reply.statusCode, 200);
  assert.equal(payload.status, "ok");
  assert.equal(payload.persistent, true);
  assert.equal(payload.migrationCount, 46);
  assert.equal(payload.latestMigrationVersion, "046_active_bot_provisioning_guard");
  assert.equal(payload.latestMigrationApplied, true);
});

test("readiness hook leaves unrelated routes untouched", async () => {
  const app = fakeApp();
  let queried = false;
  installLaunchReadinessHttp(app, {
    db: { async status() { queried = true; return {}; } },
    config: { nodeEnv: "production", databaseMode: "postgres", previewMemoryMode: false }
  });
  const original = { hello: "world" };
  const result = await app.hook({ method: "GET", raw: { url: "/api/public/portal" } }, fakeReply(), original);
  assert.equal(result, original);
  assert.equal(queried, false);
});
