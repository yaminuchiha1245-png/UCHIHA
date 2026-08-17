import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const launchAssetsUrl = new URL("../src/launch-assets.mjs", import.meta.url);
const staticIndexUrl = new URL("../public/index.html", import.meta.url);
const platformDocumentUrl = new URL("../public/platform-v5.html", import.meta.url);
const platformRuntimeUrl = new URL("../public/platform-v5.js", import.meta.url);
const serviceWorkerUrl = new URL("../public/sw.js", import.meta.url);

test("production launch serves V60 as primary shell while retaining the proven Builder compatibility shell", async () => {
  const source = await readFile(launchAssetsUrl, "utf8");
  assert.match(source, /V60_DOCUMENT = gunzipSync/);
  assert.match(source, /platform-v60\.html\.gz/);
  assert.match(source, /platform-v60\.js\.gz/);
  assert.match(source, /V60_DOCUMENT_PATHS/);
  assert.match(source, /x-uchiha-ui-release/);
  assert.match(source, /PUBLIC_DOCUMENT = readFileSync\(new URL\("\.\.\/public\/platform-v5\.html"/);
  assert.match(source, /function isPlatformPublicPath\(pathname\)/);
  assert.match(source, /\^\\\/category\\\/\[\^\/\]\+/);
  assert.match(source, /\^\\\/product\\\/\[\^\/\]\+/);
  assert.doesNotMatch(source, /V41_DOCUMENT/);
  assert.doesNotMatch(source, /v41-production-bridge/);
});

test("static index fallback remains the tested Builder compatibility shell", async () => {
  const [indexHtml, platformHtml] = await Promise.all([readFile(staticIndexUrl, "utf8"), readFile(platformDocumentUrl, "utf8")]);
  assert.equal(indexHtml, platformHtml);
  assert.match(indexHtml, /<title>UCHIHA Builder<\/title>/);
  assert.match(indexHtml, /class="uchiha-v5"/);
  assert.doesNotMatch(indexHtml, /v41 Final Demo/i);
});

test("compatibility Builder runtime still loads account, catalog and orders from backend", async () => {
  const source = await readFile(platformRuntimeUrl, "utf8");
  assert.match(source, /requestJson\("\/api\/public\/portal"\)/);
  assert.match(source, /requestJson\("\/api\/me"\)/);
  assert.match(source, /requestJson\("\/api\/platform\/account"\)/);
  assert.match(source, /requestJson\("\/api\/platform\/orders"\)/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /"x-csrf-token": state\.csrfToken/);
});

test("V60 owns public customer routes while deep catalog and legal routes retain compatibility handling", async () => {
  const source = await readFile(launchAssetsUrl, "utf8");
  for (const path of ["/", "/services", "/payment-methods", "/support", "/orders", "/wallet", "/notifications"]) {
    assert.ok(source.includes(`"${path}"`), `${path} must be represented in production launch routing`);
  }
  assert.match(source, /app\.get\("\/category\/:categorySlug", handler\)/);
  assert.match(source, /app\.get\("\/product\/:productSlug", handler\)/);
  assert.match(source, /app\.get\("\/add-balance\/:methodKey", handler\)/);
  assert.match(source, /app\.get\("\/orders", handler\)/);
  assert.match(source, /pathname === "\/account"/);
  assert.match(source, /pathname === "\/create-store"/);
});

test("HTML navigation is always fetched from server without stale shell reuse", async () => {
  const source = await readFile(serviceWorkerUrl, "utf8");
  assert.match(source, /async function fresh\(request\)/);
  assert.match(source, /fetch\(request, \{ cache: "no-store" \}\)/);
  assert.match(source, /if \(request\.mode === "navigate"\)/);
  assert.match(source, /fresh\(request\)\.catch/);
});

test("production document responses explicitly disable HTML caching", async () => {
  const source = await readFile(launchAssetsUrl, "utf8");
  assert.match(source, /cache-control", "no-store, max-age=0"/);
  assert.match(source, /pragma", "no-cache"/);
  assert.match(source, /expires", "0"/);
});
