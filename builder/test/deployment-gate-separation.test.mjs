import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scripts = new URL("../scripts/", import.meta.url);
const readScript = (name) => readFile(new URL(name, scripts), "utf8");

test("VPS smoke requires the exact V60 production release but does not roll root back for optional demo DNS", async () => {
  const smoke = await readScript("smoke-vps.sh");
  assert.match(smoke, /EXPECTED_RELEASE_SHA="\$\(git -C "\$REPO_DIR" rev-parse HEAD\)"/);
  assert.match(smoke, /data\.get\('releaseSha'\) != expected_release/);
  assert.match(smoke, /PASS live release SHA matches repository HEAD/);
  assert.match(smoke, /LATEST_MIGRATION="050_subscription_review_revalidation_guard"/);
  assert.match(smoke, /migration count is below launch baseline/);
  assert.match(smoke, /deployment-data-integrity\.sh/);
  assert.match(smoke, /optional demo host/);
  assert.match(smoke, /root deployment remains valid/);
  assert.match(smoke, /PASS root UCHIHA Builder V60 production deployment acceptance gate/);
});

test("V60 smoke validates the public shell and retains intentional storefront compatibility assets", async () => {
  const smoke = await readScript("smoke-vps.sh");
  assert.match(smoke, /UI_RELEASE="v60"/);
  assert.match(smoke, /V60_RUNTIME="\/platform-v60\.js\?v=60\.0\.0"/);
  assert.match(smoke, /V60_RUNTIME_ASSET="\/assets\/platform-v60\.js\?v=60\.0\.0"/);
  assert.match(smoke, /x-uchiha-ui-release:.*v60/);
  assert.match(smoke, /PASS UCHIHA Builder V60 production homepage is active/);
  assert.match(smoke, /PASS both V60 runtime endpoints are live/);
  assert.ok(smoke.includes('assets/theme.js?v=$PUBLIC_RELEASE'));
  assert.ok(smoke.includes('grep -q "var ASSET_VERSION = \\"$PUBLIC_RELEASE\\""'));
  assert.ok(smoke.includes('assets/runtime-recovery.js?v=$PUBLIC_RELEASE'));
  assert.ok(smoke.includes('grep -q "const RELEASE_VERSION = \\"$PUBLIC_RELEASE\\""'));
  assert.match(smoke, /PASS storefront compatibility assets remain current/);
  assert.doesNotMatch(smoke, /! grep -q '2026\.08\.11\.2'/);
});

test("fatal data integrity gate retains bot tenant safety and payment currency/min/max validation", async () => {
  const integrity = await readScript("deployment-data-integrity.sh");
  assert.match(integrity, /bot_connections bc JOIN tenants t/);
  assert.match(integrity, /t\.status='connecting_bots'/);
  assert.match(integrity, /lease_expires_at>NOW\(\)/);
  assert.match(integrity, /subscription_payment_mismatches/);
  assert.match(integrity, /minimum_amount_minor/);
  assert.match(integrity, /maximum_amount_minor/);
  assert.match(integrity, /paymentMethodId/);
  assert.match(integrity, /pending subscription proofs match active payment currency and min\/max limits/);
});

test("launch audit keeps the subscription offer public while protected sales APIs reject anonymous access", async () => {
  const audit = await readScript("launch-audit.sh");
  assert.ok(audit.includes('$BASE_URL/api/subscription-offer'));
  assert.ok(audit.includes('subscription_offer_code" == 200'));
  assert.ok(audit.includes('/api/subscription-offer remains a public read-only sales endpoint'));

  const protectedLoop = audit.match(/for endpoint in ([^;]+); do/)?.[1] || "";
  assert.ok(protectedLoop.includes("/api/subscription-status"));
  assert.ok(protectedLoop.includes("/api/platform/subscription-requests"));
  assert.ok(protectedLoop.includes("/api/subscription-renewals"));
  assert.ok(protectedLoop.includes("/api/platform/subscription-renewals"));
  assert.ok(protectedLoop.includes("/api/public/stores/demo/support-v2"));
  assert.equal(protectedLoop.includes("/api/subscription-offer"), false);
});

test("launch audit keeps technical and data safety failures fatal while owner setup remains pending", async () => {
  const audit = await readScript("launch-audit.sh");
  assert.match(audit, /LATEST_MIGRATION="050_subscription_review_revalidation_guard"/);
  assert.match(audit, /CONFIG_PENDING=0/);
  assert.match(audit, /config_pending\(\)/);
  assert.match(audit, /configure a paid sellable subscription offer/);
  assert.match(audit, /configure an active real platform payment method/);
  assert.match(audit, /support attachment RLS is enabled/);
  assert.match(audit, /subscription payment approval is revalidated/);
  assert.match(audit, /LAUNCH BLOCKED:/);
  assert.match(audit, /DEPLOYMENT READY: 0 technical\/security failures/);
  assert.match(audit, /LAUNCH CONFIG PENDING:/);
});
