import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../migrations/049_subscription_single_tenant_binding_guard.sql", import.meta.url),
  "utf8"
);
const appSource = readFileSync(new URL("../src/app.mjs", import.meta.url), "utf8");
const auditSource = readFileSync(new URL("../scripts/launch-audit.sh", import.meta.url), "utf8");

test("store creation consumes only an unbound live subscription", () => {
  assert.match(appSource, /tenant_id IS NULL AND status IN \('trial', 'active'\)/);
  assert.match(appSource, /AND ends_at > NOW\(\)/);
  assert.match(appSource, /UPDATE subscriptions SET tenant_id = \$2 WHERE id = \$1/);
});

test("migration 049 makes subscription tenant binding immutable and live-only", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION uchiha_lock_subscription_tenant_binding/);
  assert.match(migration, /OLD\.tenant_id IS NOT NULL AND NEW\.tenant_id IS DISTINCT FROM OLD\.tenant_id/);
  assert.match(migration, /Subscription tenant binding is immutable once assigned/);
  assert.match(migration, /NEW\.status NOT IN \('trial', 'active'\) OR NEW\.ends_at <= NOW\(\)/);
  assert.match(migration, /BEFORE UPDATE OF tenant_id ON subscriptions/);
  assert.match(migration, /WHEN \(OLD\.tenant_id IS DISTINCT FROM NEW\.tenant_id\)/);
});

test("launch audit is advanced when schema 049 is release-gated", () => {
  // This assertion intentionally fails if a future migration is added without moving the launch gate.
  assert.match(auditSource, /LATEST_MIGRATION="049_subscription_single_tenant_binding_guard"/);
  assert.match(auditSource, /subscription_binding_trigger_count/);
});
