import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = new URL("../migrations/047_subscription_payment_reference_unique.sql", import.meta.url);

test("subscription payment references are unique per payment method across activation and renewal", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /CREATE UNIQUE INDEX/i);
  assert.match(sql, /metadata->>'paymentMethodId'/);
  assert.match(sql, /LOWER\(BTRIM\(metadata->>'paymentReference'\)\)/i);
  assert.match(sql, /subscription_activation/);
  assert.match(sql, /subscription_renewal/);
  assert.match(sql, /status NOT IN \('cancelled', 'rejected'\)/i);
});
