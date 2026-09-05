import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sourceUrl = new URL("../src/launch-renewals.mjs", import.meta.url);
const startUrl = new URL("../src/start.mjs", import.meta.url);
const priceGuardUrl = new URL("../migrations/038_subscription_renewal_price_guard.sql", import.meta.url);

async function source(url) {
  return readFile(url, "utf8");
}

test("renewal routes are installed and require authentication, CSRF, and idempotency", async () => {
  const [renewals, start] = await Promise.all([source(sourceUrl), source(startUrl)]);
  assert.match(start, /installLaunchRenewalRoutes\(app,\s*\{\s*db,\s*config\s*\}\)/);
  assert.match(renewals, /authenticateLaunchUser\(db, request\)/);
  assert.match(renewals, /requireLaunchCsrf\(request, user\)/);
  assert.match(renewals, /Idempotency-Key/);
  assert.match(renewals, /idempotency_conflict/);
  assert.match(renewals, /payment_reference_used/);
});

test("renewal approval extends from the later of current expiry or now", async () => {
  const renewals = await source(sourceUrl);
  assert.match(renewals, /currentEnd\s*>\s*now\s*\?\s*currentEnd\s*:\s*now/);
  assert.match(renewals, /durationEnd\(base, subscription\.duration_unit, Number\(subscription\.duration_count\)\)/);
  assert.match(renewals, /SET status='active', ends_at=\$2, renews_at=\$2/);
});

test("only subscription-expired tenants are automatically reactivated", async () => {
  const renewals = await source(sourceUrl);
  assert.match(renewals, /subscription\.tenant_status\s*===\s*"subscription_expired"/);
  assert.match(renewals, /stage='subscription_renewed'/);
  assert.match(renewals, /status='retry'/);
  assert.doesNotMatch(renewals, /tenant_status\s*===\s*"suspended"[\s\S]*SET status='active'/);
});

test("database guard rejects stale renewal amount or currency", async () => {
  const sql = await source(priceGuardUrl);
  assert.match(sql, /requestType'\s*=\s*'subscription_renewal'/);
  assert.match(sql, /subscriptionId/);
  assert.match(sql, /renewal_price_minor/);
  assert.match(sql, /amountMinor/);
  assert.match(sql, /currency/);
  assert.match(sql, /ERRCODE\s*=\s*'23514'/);
});
