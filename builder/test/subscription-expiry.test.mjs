import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { expireTenantSubscriptions } from "../src/subscription-expiry.mjs";

function fakeDb(expiredRows = []) {
  const calls = [];
  return {
    calls,
    async transaction(handler) {
      return handler({
        async query(text, values = []) {
          calls.push({ text, values });
          if (/UPDATE\s+subscriptions/i.test(text)) {
            return { rows: expiredRows, rowCount: expiredRows.length };
          }
          return { rows: [], rowCount: 1 };
        }
      });
    }
  };
}

test("expired tenant subscriptions fail closed across storefront and provisioning state", async () => {
  const db = fakeDb([{ tenant_id: "tenant-a" }, { tenant_id: "tenant-a" }]);
  const result = await expireTenantSubscriptions(db);

  assert.equal(result.expiredSubscriptions, 2);
  assert.deepEqual(result.tenantIds, ["tenant-a"]);
  const sql = db.calls.map((call) => call.text).join("\n");
  assert.match(sql, /SET status='subscription_expired'/);
  assert.match(sql, /UPDATE stores[\s\S]*status='suspended'/);
  assert.match(sql, /UPDATE provisioning_jobs[\s\S]*stage='subscription_expired'/);
  assert.match(sql, /UPDATE customer_sessions[\s\S]*revoked_at/i);
  assert.equal(db.calls.filter((call) => call.values?.[0] === "tenant-a").length, 4);
});

test("subscription expiry sweep is a no-op when nothing has expired", async () => {
  const db = fakeDb([]);
  const result = await expireTenantSubscriptions(db);
  assert.deepEqual(result, { expiredSubscriptions: 0, tenantIds: [] });
  assert.equal(db.calls.length, 1);
});

test("tenant activation migration requires a live unexpired subscription", async () => {
  const sql = await readFile(
    new URL("../migrations/037_tenant_activation_subscription_guard.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /NEW\.status\s*=\s*'active'/i);
  assert.match(sql, /s\.status\s+IN\s*\('trial',\s*'active'\)/i);
  assert.match(sql, /s\.ends_at\s*>\s*NOW\(\)/i);
  assert.match(sql, /ERRCODE\s*=\s*'23514'/i);
});
