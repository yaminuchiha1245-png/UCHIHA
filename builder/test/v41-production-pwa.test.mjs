import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const launchAssetsUrl = new URL("../src/launch-assets.mjs", import.meta.url);
const staticIndexUrl = new URL("../public/index.html", import.meta.url);
const platformDocumentUrl = new URL("../public/platform-v5.html", import.meta.url);
const platformRuntimeUrl = new URL("../public/platform-v5.js", import.meta.url);
const serviceWorkerUrl = new URL("../public/sw.js", import.meta.url);

test("production launch serves UCHIHA Builder instead of the archived v41 shell", async () => {
  const source = await readFile(launchAssetsUrl, "utf8");
  assert.match(source, /PUBLIC_DOCUMENT = readFileSync\(new URL\("\.\.\/public\/platform-v5\.html"/);
  assert.match(source, /function isPlatformPublicPath\(pathname\)/);
  assert.match(source, /\^\\\/category\\\/\[\^\/\]\+/);
  assert.match(source, /\^\\\/product\\\/\[\^\/\]\+/);
  assert.match(source, /return documentResponse\(reply, PUBLIC_DOCUMENT\)/);
  assert.doesNotMatch(source, /V41_DOCUMENT/);
  assert.doesNotMatch(source, /V41_UNIFIED_PATHS/);
  assert.doesNotMatch(source, /v41-production-bridge/);
  assert.doesNotMatch(source, /v41-responsive/);
  assert.doesNotMatch(source, /productionV41Document/);
});

test("static preview and production compatibility documents both keep the Builder identity", async () => {
  const [indexHtml, platformHtml] = await Promise.all([readFile(staticIndexUrl, "utf8"), readFile(platformDocumentUrl, "utf8")]);
  for (const html of [indexHtml, platformHtml]) {
    assert.match(html, /<title>UCHIHA Builder<\/title>/);
    assert.match(html, /class="uchiha-v5(?:\s|\")/);
    assert.doesNotMatch(html, /v41 Final Demo/i);
    assert.doesNotMatch(html, /data-v41-production-pending/);
  }
  assert.match(indexHtml, /platform-v5\.js\?v=2026\.08\.15\.1/);
  assert.match(platformHtml, /platform-v5\.js\?v=2026\.08\.14\.3/);
});

test("production platform document carries the real Builder identity", async () => {
  const html = await readFile(platformDocumentUrl, "utf8");
  assert.match(html, /<title>UCHIHA Builder<\/title>/);
  assert.match(html, /class="uchiha-v5(?:\s|\")/);
  assert.match(html, /UCHIHA <span>Builder<\/span>/);
  assert.match(html, /platform-v5\.css\?v=/);
  assert.match(html, /platform-v5\.js\?v=/);
  assert.match(html, /href="\/create-store"/);
  assert.match(html, /href="\/account"/);
  assert.match(html, /href="\/orders"/);
  assert.doesNotMatch(html, /v41 Final Demo/i);
  assert.doesNotMatch(html, /data-v41-production-pending/);
});

test("UCHIHA Builder shell loads production account, catalog and orders from the backend", async () => {
  const source = await readFile(platformRuntimeUrl, "utf8");
  assert.match(source, /requestJson\("\/api\/public\/portal"\)/);
  assert.match(source, /requestJson\("\/api\/me"\)/);
  assert.match(source, /requestJson\("\/api\/platform\/account"\)/);
  assert.match(source, /requestJson\("\/api\/platform\/orders"\)/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /"x-csrf-token": state\.csrfToken/);
  assert.match(source, /requestJson\("\/api\/auth\/logout"/);
});

test("public routes keep a single platform shell across home, categories, products, orders and balance", async () => {
  const source = await readFile(launchAssetsUrl, "utf8");
  for (const path of ["/", "/services", "/payment-methods", "/support", "/orders"]) {
    assert.ok(source.includes(`"${path}"`), `${path} must use the public production shell`);
  }
  assert.match(source, /app\.get\("\/category\/:categorySlug", handler\)/);
  assert.match(source, /app\.get\("\/product\/:productSlug", handler\)/);
  assert.match(source, /app\.get\("\/add-balance\/:methodKey", handler\)/);
  assert.match(source, /app\.get\("\/orders", handler\)/);
});

test("HTML navigation is always fetched from the server without stale shell reuse", async () => {
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
