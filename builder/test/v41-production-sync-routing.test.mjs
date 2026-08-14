import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(relative) {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("launch asset layer serves catalog-facing routes through the approved v41 shell", async () => {
  const source = await text("../src/launch-assets.mjs");
  for (const path of [
    '"/services"',
    '"/payment-methods"',
    '"/orders"',
    '"/about"'
  ]) {
    assert.match(source, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(source, /const V41_UNIFIED_PATHS = new Set/);
  assert.match(source, /V41_UNIFIED_PATHS\.has\(pathname\)/);
  assert.match(source, /\^\\\/category\\\/\[\^\/\]\+/);
  assert.match(source, /\^\\\/product\\\/\[\^\/\]\+/);
  assert.match(source, /injectAssets\(productionV41Document\(\), \{ styles: V41_STYLES, scripts: \[\] \}\)/);
});

test("live portal banners replace only the v41 slider surface and keep a safe fallback", async () => {
  const source = await text("../public/v41-production-bridge.js");
  assert.match(source, /function syncProductionBanners\(portal\)/);
  assert.match(source, /Array\.isArray\(portal\?\.banners\)/);
  assert.match(source, /row\?\.status === "active"/);
  assert.match(source, /safeBannerAsset\(row\?\.imageUrl\)/);
  assert.match(source, /safeBannerLink\(row\?\.linkUrl\)/);
  assert.match(source, /function renderProductionBanners\(\)/);
  assert.match(source, /track\.replaceChildren\(\.\.\.sequence\)/);
  assert.match(source, /productionBanners\.length/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /action === "production-banner"/);
});

test("portal, account, orders and banners share one refresh cycle", async () => {
  const source = await text("../public/v41-production-bridge.js");
  assert.match(source, /syncProductionBanners\(portal\)/);
  assert.match(source, /runtime\.syncPortal\(portal\)/);
  assert.match(source, /hydrateProductionAccount\(\{ initial \}\)/);
  assert.match(source, /Promise\.all\(\[/);
  assert.match(source, /hydrateProductionPortal\(\)/);
  assert.match(source, /const SYNC_INTERVAL_MS = 60000/);
});
