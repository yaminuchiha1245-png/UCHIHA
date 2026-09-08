import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../migrations/050_subscription_review_revalidation_guard.sql", import.meta.url),
  "utf8"
);
const auditSource = readFileSync(new URL("../scripts/launch-audit.sh", import.meta.url), "utf8");

test("migration 050 revalidates payment state when subscription requests complete", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION uchiha_revalidate_subscription_request_on_completion/);
  assert.match(migration, /request_type NOT IN \('subscription_activation', 'subscription_renewal'\)/);
  assert.match(migration, /payment_status <> 'active'/);
  assert.match(migration, /request_amount < payment_minimum/);
  assert.match(migration, /request_amount > payment_maximum/);
  assert.match(migration, /request_type = 'subscription_activation'/);
  assert.match(migration, /o\.renewal_price_minor/);
  assert.match(migration, /request_amount <> expected_amount/);
  assert.match(migration, /BEFORE UPDATE OF status ON service_requests/);
  assert.match(migration, /OLD\.status IS DISTINCT FROM NEW\.status/);
});

test("launch audit requires schema 050 and the completion revalidation trigger", () => {
  assert.match(auditSource, /LATEST_MIGRATION="050_subscription_review_revalidation_guard"/);
  assert.match(auditSource, /migrationCount',0\)\) >= 50/);
  assert.match(auditSource, /subscription_review_trigger_count/);
  assert.match(auditSource, /subscription payment approval is revalidated/);
});
