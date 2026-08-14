import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dbSource = new URL("../src/db.mjs", import.meta.url);

test("launch hardening migrations are registered in order and latest version is exported", async () => {
  const source = await readFile(dbSource, "utf8");
  const expected = [
    "036_tenant_store_suspension_guard",
    "037_tenant_activation_subscription_guard",
    "038_subscription_renewal_price_guard",
    "039_public_store_requires_active_tenant",
    "040_tenant_bot_connection_guard",
    "041_active_bot_requires_active_tenant",
    "042_tenant_insert_activation_guard",
    "043_showcase_tenant_activation_exception",
    "044_subscription_payment_method_currency_guard",
    "045_subscription_payment_amount_guard"
  ];
  let previous = -1;
  for (const version of expected) {
    const position = source.indexOf(`version: "${version}"`);
    assert.ok(position > previous, `${version} must be registered after the previous migration`);
    previous = position;
    assert.match(source, new RegExp(`migrations/${version}\\.sql`));
  }
  assert.match(source, /export const LATEST_MIGRATION_VERSION = migrations\.at\(-1\)\.version/);
  assert.match(source, /latestMigrationApplied:\s*Boolean/);
});
