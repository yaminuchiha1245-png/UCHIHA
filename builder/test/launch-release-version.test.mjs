import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const RELEASE = "2026.08.14.3";
const SCHEMA = "047_subscription_payment_reference_unique";

async function text(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("launch release version is synchronized across runtime, PWA, HTTP and VPS gates", async () => {
  const [assets, sw, pwa, http, smoke, audit, rc] = await Promise.all([
    text("../src/launch-assets.mjs"),
    text("../public/sw.js"),
    text("../public/pwa.js"),
    text("../src/http-hardening.mjs"),
    text("../scripts/smoke-vps.sh"),
    text("../scripts/launch-audit.sh"),
    text("../LAUNCH_RC.md")
  ]);
  const escaped = RELEASE.replaceAll(".", "\\.");
  assert.match(assets, new RegExp(`const RELEASE = "${escaped}"`));
  assert.match(sw, new RegExp(`const RELEASE_VERSION = "${escaped}"`));
  assert.match(pwa, new RegExp(`const RELEASE_VERSION = "${escaped}"`));
  assert.match(pwa, new RegExp(`/sw\\.js\\?v=\\$\\{RELEASE_VERSION\\}`));
  assert.match(http, new RegExp(`const RELEASE_VERSION = "${escaped}"`));
  assert.match(smoke, new RegExp(`PUBLIC_RELEASE="${escaped}"`));
  assert.match(audit, new RegExp(`PUBLIC_RELEASE="${escaped}"`));
  assert.match(rc, new RegExp(escaped));
  assert.match(smoke, new RegExp(SCHEMA));
  assert.match(audit, new RegExp(SCHEMA));
  assert.match(rc, new RegExp(SCHEMA));
});

test("public and account documents do not load stale duplicate release assets", async () => {
  const [platform, account] = await Promise.all([
    text("../public/platform-v5.html"),
    text("../public/account-unified.html")
  ]);
  const escaped = RELEASE.replaceAll(".", "\\.");
  for (const source of [platform, account]) {
    assert.match(source, new RegExp(escaped));
    assert.doesNotMatch(source, /2026\.08\.11\.2/);
    assert.doesNotMatch(source, /20260805\.1/);
  }
  assert.match(platform, new RegExp(`platform-v5-responsive\\.css\\?v=${escaped}`));
  assert.match(platform, new RegExp(`pwa\\.js\\?v=${escaped}`));
  assert.match(account, new RegExp(`platform-v5-responsive\\.css\\?v=${escaped}`));
  assert.match(account, new RegExp(`account-unified\\.js\\?v=${escaped}`));
  assert.match(account, new RegExp(`pwa\\.js\\?v=${escaped}`));
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
