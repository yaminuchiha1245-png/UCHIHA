import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scripts = new URL("../scripts/", import.meta.url);
const readScript = (name) => readFile(new URL(name, scripts), "utf8");

test("deploy smoke keeps the strict smoke and can tolerate demo-host-only availability", async () => {
  const [wrapper, strict] = await Promise.all([
    readScript("smoke-vps.sh"),
    readScript("smoke-vps-strict.sh")
  ]);
  assert.match(wrapper, /smoke-vps-strict\.sh/);
  assert.match(wrapper, /PASS live release SHA matches repository HEAD/);
  assert.match(wrapper, /docker inspect -f/);
  assert.match(wrapper, /Demo subdomain is not part of the root deployment acceptance gate/);
  assert.match(strict, /EXPECTED_RELEASE_SHA/);
  assert.match(strict, /DEMO_HOST="demo\.\$BASE_DOMAIN"/);
});

test("deploy launch wrapper preserves strict audit while separating owner configuration", async () => {
  const [wrapper, strict] = await Promise.all([
    readScript("launch-audit.sh"),
    readScript("launch-audit-strict.sh")
  ]);
  assert.match(wrapper, /launch-audit-strict\.sh/);
  assert.match(wrapper, /configure a paid sellable offer with renewal enabled/);
  assert.match(wrapper, /configure an active platform payment method/);
  assert.match(wrapper, /LAUNCH CONFIG PENDING/);
  assert.match(wrapper, /HARD launch audit failure/);
  assert.match(strict, /LATEST_MIGRATION="050_subscription_review_revalidation_guard"/);
  assert.match(strict, /support attachment RLS/);
  assert.match(strict, /subscription payment approval is revalidated/);
});
