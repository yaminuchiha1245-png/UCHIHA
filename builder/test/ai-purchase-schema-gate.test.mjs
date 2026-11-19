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

const secureConfig = {
  nodeEnv: "production",
  databaseMode: "postgres",
  databaseUrl: "postgres://db/uchiha",
  requirePersistentDatabase: true,
  appBaseUrl: "https://uchiha.example",
  cookieSecure: true,
  telegramMode: "live",
  rateLimitEnabled: true,
  previewMemoryMode: false,
  demoSeed: false,
  allowDemoBilling: false
};

test("purchase fails closed before wallet route when migration 033 or lease table is missing", async () => {
  let hook;
  let walletTouched = false;
  const app = { addHook(name, fn) { if (name === "preHandler") hook = fn; } };
  const db = {
    async query(sql) {
      const source = String(sql);
      if (source.includes("FROM sessions")) {
        return {
          rows: [{ id: "buyer-1", is_platform_admin: false, csrf_hash: sha256("csrf-ok") }]
        };
      }
      if (source.includes("to_regclass")) {
        return {
          rows: [{
            identity_migration_applied: true,
            prompt_lease_migration_applied: false,
            unique_index_present: true,
            prompt_lease_table_present: false
          }]
        };
      }
      if (source.includes("platform_account_wallets")) walletTouched = true;
      throw new Error(`unexpected query: ${source}`);
    }
  };

  installAiProductActivationGuard(app, { db, config: secureConfig });
  const response = reply();
  await hook({
    method: "POST",
    raw: { url: "/api/platform/ai-bots/purchase" },
    cookies: { uchiha_builder_session: "session-token" },
    headers: { "x-csrf-token": "csrf-ok" },
    body: { displayName: "UCHIHA AI", openAiCostAccepted: true }
  }, response);

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.payload, {
    error: "ai_product_launch_not_ready",
    message: "منتج بوت الذكاء الاصطناعي غير متاح للشراء حاليًا. حاول لاحقًا."
  });
  assert.equal(walletTouched, false);
  assert.doesNotMatch(JSON.stringify(response.payload), /033|migration|lease/i);
});
