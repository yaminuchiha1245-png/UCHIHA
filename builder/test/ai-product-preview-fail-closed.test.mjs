import assert from "node:assert/strict";
import test from "node:test";
import { installAiProductActivationGuard } from "../src/ai-product-activation-guard.mjs";
import { sha256 } from "../src/security.mjs";

function reply() {
  return {
    statusCode: 200,
    payload: null,
    code(value) { this.statusCode = value; return this; },
    send(value) { this.payload = value; return this; }
  };
}

test("memory preview rejects AI purchases without running PostgreSQL-only readiness SQL", async () => {
  let hook;
  const app = { addHook(name, fn) { if (name === "preHandler") hook = fn; } };
  let postgresOnlyQuerySeen = false;
  const db = {
    async query(sql) {
      const source = String(sql);
      if (source.includes("FROM sessions")) {
        return {
          rows: [{
            id: "11111111-1111-4111-8111-111111111111",
            is_platform_admin: false,
            csrf_hash: sha256("csrf-ok")
          }]
        };
      }
      if (source.includes("to_regclass")) postgresOnlyQuerySeen = true;
      throw new Error(`unexpected query: ${source}`);
    }
  };
  installAiProductActivationGuard(app, {
    db,
    config: {
      nodeEnv: "development",
      databaseMode: "memory",
      databaseUrl: "",
      requirePersistentDatabase: false,
      appBaseUrl: "http://localhost:4100",
      cookieSecure: false,
      telegramMode: "fake",
      rateLimitEnabled: true,
      previewMemoryMode: true,
      demoSeed: true,
      allowDemoBilling: true
    }
  });

  const response = reply();
  await hook({
    method: "POST",
    raw: { url: "/api/platform/ai-bots/purchase" },
    cookies: { uchiha_builder_session: "session" },
    headers: { "x-csrf-token": "csrf-ok" },
    body: { displayName: "Preview" }
  }, response);

  assert.equal(postgresOnlyQuerySeen, false);
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload?.error, "ai_product_launch_not_ready");
});
