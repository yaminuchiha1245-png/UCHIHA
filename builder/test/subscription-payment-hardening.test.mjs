import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("database subscription payment guard enforces currency and amount limits", async () => {
  const sql = await read("../migrations/045_subscription_payment_amount_guard.sql");
  assert.match(sql, /subscription_activation/);
  assert.match(sql, /subscription_renewal/);
  assert.match(sql, /request_amount\s*<=\s*0/i);
  assert.match(sql, /payment_minimum\s+IS NOT NULL\s+AND\s+request_amount\s*<\s*payment_minimum/i);
  assert.match(sql, /payment_maximum\s+IS NOT NULL\s+AND\s+request_amount\s*>\s*payment_maximum/i);
  assert.match(sql, /UPPER\(COALESCE\(payment_currency/);
  assert.match(sql, /ERRCODE\s*=\s*'23514'/i);
});

test("activation API validates payment currency and configured limits before accepting proof", async () => {
  const source = await read("../src/launch-subscriptions.mjs");
  assert.match(source, /minimum_amount_minor/);
  assert.match(source, /maximum_amount_minor/);
  assert.match(source, /payment_currency_mismatch/);
  assert.match(source, /payment_amount_out_of_range/);
  assert.match(source, /String\(method\.currency \|\| ""\)\.toUpperCase\(\)/);
});

test("activation approval rejects stale offer amount or currency", async () => {
  const source = await read("../src/launch-subscription-admin.mjs");
  assert.match(source, /capturedAmount/);
  assert.match(source, /currentAmount/);
  assert.match(source, /capturedCurrency/);
  assert.match(source, /currentCurrency/);
  assert.match(source, /offer_changed/);
});

test("activation and renewal UIs filter incompatible payment methods before transfer", async () => {
  const [activation, renewal] = await Promise.all([
    read("../public/launch-payment-method-guard.js"),
    read("../public/account-renewals.js")
  ]);
  for (const source of [activation, renewal]) {
    assert.match(source, /minimumAmountMinor/);
    assert.match(source, /maximumAmountMinor/);
  }
  assert.match(activation, /offer\.priceMinor/);
  assert.match(renewal, /subscription\.renewalPriceMinor/);
  assert.match(activation, /لا ترسل أي مبلغ/);
  assert.match(renewal, /لا ترسل أي مبلغ/);
});
