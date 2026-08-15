import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scripts = new URL("../scripts/", import.meta.url);
const readScript = (name) => readFile(new URL(name, scripts), "utf8");

test("VPS smoke requires exact production release but does not roll root back for optional demo DNS", async () => {
  const smoke = await readScript("smoke-vps.sh");
  assert.match(smoke, /EXPECTED_RELEASE_SHA="\$\(git -C "\$REPO_DIR" rev-parse HEAD\)"/);
  assert.match(smoke, /data\.get\('releaseSha'\) != expected_release/);
  assert.match(smoke, /PASS live release SHA matches repository HEAD/);
  assert.match(smoke, /LATEST_MIGRATION="050_subscription_review_revalidation_guard"/);
  assert.match(smoke, /optional demo host/);
  assert.match(smoke, /root deployment remains valid/);
  assert.match(smoke, /PASS root production deployment acceptance gate/);
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
