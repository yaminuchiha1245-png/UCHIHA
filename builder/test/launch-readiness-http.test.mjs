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
        migrationCount: 49,
        latestMigrationVersion: "049_subscription_tenant_binding_guard",
        latestMigrationApplied: false,
        latencyMs: 3
      };
    }
  };
  installLaunchReadinessHttp(app, {
    db,
    config: {
      nodeEnv: "production",
      databaseMode: "postgres",
      previewMemoryMode: false,
      deployment: { commitSha: "1111111111111111111111111111111111111111" }
    }
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
  assert.equal(payload.releaseSha, "1111111111111111111111111111111111111111");
});

test("production readiness exposes the applied latest migration and exact release SHA", async () => {
  const app = fakeApp();
  const db = {
    async status() {
      return {
        mode: "postgres",
        migrationCount: 50,
        latestMigrationVersion: "050_subscription_review_revalidation_guard",
        latestMigrationApplied: true,
        latencyMs: 4
      };
    }
  };
  installLaunchReadinessHttp(app, {
    db,
    config: {
      nodeEnv: "production",
      databaseMode: "postgres",
      previewMemoryMode: false,
      deployment: { commitSha: "2222222222222222222222222222222222222222" }
    }
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
  assert.equal(payload.migrationCount, 50);
  assert.equal(payload.latestMigrationVersion, "050_subscription_review_revalidation_guard");
  assert.equal(payload.latestMigrationApplied, true);
  assert.equal(payload.releaseSha, "2222222222222222222222222222222222222222");
});

test("readiness reports a null release SHA when no deployment metadata exists", async () => {
  const app = fakeApp();
  const db = {
    async status() {
      return {
        mode: "memory",
        migrationCount: 0,
        latestMigrationVersion: null,
        latestMigrationApplied: true,
        latencyMs: 1
      };
    }
  };
  installLaunchReadinessHttp(app, {
    db,
    config: { nodeEnv: "test", databaseMode: "memory", previewMemoryMode: true }
  });
  const payload = await app.hook(
    { method: "GET", raw: { url: "/ready" } },
    fakeReply(),
    { status: "ok" }
  );
  assert.equal(payload.releaseSha, null);
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
