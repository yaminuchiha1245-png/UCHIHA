import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const publicUrl = new URL("../public/", import.meta.url);
const sourceUrl = new URL("../src/", import.meta.url);
const readPublic = (name) => readFile(new URL(name, publicUrl), "utf8");

test("store shell paints the final UI immediately and exposes exactly three mobile header controls", async () => {
  const [html, css, runtime, polish, preview] = await Promise.all([
    readPublic("store.html"),
    readPublic("store-launch-v6.css"),
    readPublic("store-launch-v6.js"),
    readPublic("store-polish-v2.js"),
    readPublic("preview-banner.js")
  ]);

  for (const marker of [
    "data-store-reference-style=\"true\"",
    "data-store-polish-v2-style=\"true\"",
    "data-store-launch-v6-style=\"true\"",
    "data-store-category-color-final-style=\"true\""
  ]) assert.match(html, new RegExp(marker));

  assert.match(html, /store-loader-orbit"><img src="\/assets\/demo-assets\/uchiha-transparent-mark\.svg"/);
  assert.match(html, /class="store-search-clear"[^>]*hidden/);
  assert.doesNotMatch(html, /demo-development\.js/);

  const tools = html.match(/<nav class="store-account-tools"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.equal((tools.match(/<(?:a|button)\b/g) || []).length, 4, "three visible controls plus one hidden account sync anchor");
  assert.match(tools, /id="storeMoreTrigger"/);
  assert.match(tools, /id="storeBalanceLink"/);
  assert.match(tools, /id="storeNotificationsLink"/);
  assert.match(tools, /id="storeProfileLink"[\s\S]*hidden/);
  assert.doesNotMatch(tools, /store-language-toggle/);

  assert.match(css, /grid-template-areas:\s*"notifications balance menu"/);
  assert.match(css, /#storeBrowseBack\[hidden\][\s\S]*display:\s*none\s*!important/);
  assert.match(css, /\.store-balance-chip small\s*\{[\s\S]*display:\s*inline\s*!important/);
  assert.match(css, /#top\s*\{[\s\S]*margin-inline:\s*auto\s*!important/);
  assert.match(css, /#top > \.store-home-intro,[\s\S]*width:\s*100%\s*!important/);
  assert.match(css, /\.store-category-section,[\s\S]*width:\s*100%\s*!important/);
  assert.match(css, /\.store-product-grid\s*\{[\s\S]*repeat\(3, minmax\(0,1fr\)\)/);
  assert.match(css, /@keyframes launch-drawer-enter[\s\S]*translate3d\(100%,0,0\)/);
  assert.match(css, /\.store-loader-orbit::after\s*\{[\s\S]*display:\s*none\s*!important/);
  assert.match(css, /\.store-search-clear\s*\{[\s\S]*transform:\s*none\s*!important/);

  assert.match(runtime, /setPointerCapture/);
  assert.match(runtime, /pointermove/);
  assert.match(runtime, /pointercancel/);
  assert.match(runtime, /bannerImage\.draggable = false/);
  assert.match(runtime, /addEventListener\("dragstart"/);
  assert.match(runtime, /store-banner-enter-" \+ direction/);
  assert.doesNotMatch(runtime, /\n\s*enhanceCurrencyDialog\(\);/);
  assert.match(polish, /storeSearchClearBound/);
  assert.match(preview, /querySelector\('a\[data-demo-store\]'\)/);
  assert.doesNotMatch(preview, /querySelector\("\[data-demo-store\]"\)/);
});

test("Konan artwork is responsive, cached, and persisted as the fourth nested-demo banner", async () => {
  const [branding, worker, referenceRuntime] = await Promise.all([
    readFile(new URL("demo-uchiha-branding.mjs", sourceUrl), "utf8"),
    readPublic("sw.js"),
    readPublic("store-reference.js")
  ]);

  assert.equal((branding.match(/mediaUrl:/g) || []).length, 4);
  assert.match(branding, /uchiha-banner-konan\.svg/);
  assert.match(branding, /UCHIHA_DEMO_SERVICES_SUBCATEGORY_ID/);
  assert.match(branding, /parent_id[\s\S]*programming-design-tools/);
  assert.match(branding, /UCHIHA_DEMO_SERVICE_PRODUCT_ID,[\s\S]*UCHIHA_DEMO_SERVICES_SUBCATEGORY_ID/);
  assert.match(referenceRuntime, /الإدارة حاليًا عبر بوت Telegram/);

  for (const name of [
    "demo-assets/uchiha-banner-konan.svg",
    "demo-assets/uchiha-banner-konan-1920.svg",
    "demo-assets/uchiha-banner-konan-1280.svg"
  ]) {
    const info = await stat(new URL(name, publicUrl));
    assert.ok(info.size > 20_000, `${name} should be production artwork`);
    assert.match(worker, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("production cache owners use their current releases while the archived preview helper keeps its own version", async () => {
  const [pwa, worker, recovery, theme, preview] = await Promise.all([
    readPublic("pwa.js"),
    readPublic("sw.js"),
    readPublic("runtime-recovery.js"),
    readPublic("theme.js"),
    readPublic("preview-banner.js")
  ]);

  for (const source of [pwa, worker, recovery]) {
    assert.match(source, /2026\.08\.14\.3/);
    assert.doesNotMatch(source, /2026\.08\.11\.2/);
  }
  assert.match(theme, /2026\.08\.15\.1/);
  assert.doesNotMatch(theme, /2026\.08\.11\.2/);
  assert.match(preview, /2026\.08\.11\.2/);
});
