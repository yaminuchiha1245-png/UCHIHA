import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const RELEASE = "2026.08.14.3";
const SCHEMA = "047_subscription_payment_reference_unique";

async function text(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("launch release version is synchronized across runtime, PWA, HTTP and VPS gates", async () => {
  const [assets, sw, http, smoke, audit, rc] = await Promise.all([
    text("../src/launch-assets.mjs"),
    text("../public/sw.js"),
    text("../src/http-hardening.mjs"),
    text("../scripts/smoke-vps.sh"),
    text("../scripts/launch-audit.sh"),
    text("../LAUNCH_RC.md")
  ]);
  assert.match(assets, new RegExp(`const RELEASE = "${RELEASE.replaceAll(".", "\\.")}"`));
  assert.match(sw, new RegExp(`const RELEASE_VERSION = "${RELEASE.replaceAll(".", "\\.")}"`));
  assert.match(http, new RegExp(`const RELEASE_VERSION = "${RELEASE.replaceAll(".", "\\.")}"`));
  assert.match(smoke, new RegExp(`PUBLIC_RELEASE="${RELEASE.replaceAll(".", "\\.")}"`));
  assert.match(audit, new RegExp(`PUBLIC_RELEASE="${RELEASE.replaceAll(".", "\\.")}"`));
  assert.match(rc, new RegExp(RELEASE.replaceAll(".", "\\.")));
  assert.match(smoke, new RegExp(SCHEMA));
  assert.match(audit, new RegExp(SCHEMA));
  assert.match(rc, new RegExp(SCHEMA));
});

test("service worker prewarms responsive and launch-critical assets", async () => {
  const sw = await text("../public/sw.js");
  for (const asset of [
    "v41-responsive.css",
    "platform-v5-responsive.css",
    "launch-payment-method-guard.js",
    "account-renewals.css",
    "account-renewals.js",
    "launch-admin-renewals.js"
  ]) {
    assert.match(sw, new RegExp(asset.replaceAll(".", "\\.")), `${asset} must be in the RC cache manifest`);
  }
});
