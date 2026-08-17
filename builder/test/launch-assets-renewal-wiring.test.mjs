import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { installLaunchAssetInjection } from "../src/launch-assets.mjs";

const assetsUrl = new URL("../src/launch-assets.mjs", import.meta.url);
const platformUrl = new URL("../public/platform-v5.html", import.meta.url);
const accountRenewalsUrl = new URL("../public/account-renewals.js", import.meta.url);
const storefrontResponsiveUrl = new URL("../public/store-desktop-responsive.css", import.meta.url);

function replyHarness() {
  const headers = new Map();
  return {
    headers,
    reply: {
      removeHeader(name) { headers.delete(name); },
      header(name, value) { headers.set(String(name).toLowerCase(), value); return this; }
    }
  };
}

test("launch assets serve V60 publicly while preserving storefront, account renewal and wizard wiring", async () => {
  const source = await readFile(assetsUrl, "utf8");
  for (const token of [
    'const V60_DOCUMENT = gunzipSync(',
    'const PUBLIC_DOCUMENT = readFileSync(new URL("../public/platform-v5.html"',
    'const ACCOUNT_DOCUMENT = readFileSync(new URL("../public/account-unified.html"',
    'const STOREFRONT_STYLES = [`/assets/store-desktop-responsive.css?v=${RELEASE}`]',
    '/assets/platform-v5.css?v=${RELEASE}',
    '/assets/platform-v5-responsive.css?v=${RELEASE}',
    '/assets/platform-v5-polish.css?v=${RELEASE}',
    'normalizeStorefrontRelease',
    'account-renewals.css',
    'account-renewals.js',
    'platform-v5-builder.js',
    'launch-admin-renewals.js',
    'x-uchiha-ui-release',
    '/platform-v60.js'
  ]) assert.ok(source.includes(token), `${token} must remain wired`);

  for (const retired of [
    "V41_DOCUMENT",
    "V41_STYLES",
    "V41_BRIDGE",
    "productionV41Document",
    "v41-production-bridge.js",
    "v41-responsive.css"
  ]) assert.equal(source.includes(retired), false, `${retired} must stay retired from production launch assets`);
});

test("production aliases and V60-only customer routes are registered as real Fastify routes", () => {
  const routes = [];
  const app = {
    get(path) { routes.push(path); },
    addHook() {}
  };
  installLaunchAssetInjection(app);
  for (const path of [
    "/register", "/register.html", "/index.html", "/login.html", "/services.html",
    "/api-services", "/about", "/refund-policy", "/privacy.html", "/terms.html",
    "/wallet", "/builder", "/pricing", "/domain", "/notifications", "/platform-v60.js"
  ]) assert.ok(routes.includes(path), `${path} must be a real GET route`);
});

test("root response is V60 and disables stale HTML caching", async () => {
  let onSend;
  const app = { get() {}, addHook(name, handler) { assert.equal(name, "onSend"); onSend = handler; } };
  installLaunchAssetInjection(app);
  const { headers, reply } = replyHarness();
  const output = await onSend(
    { method: "GET", raw: { url: "/" } }, reply,
    "<!doctype html><html><body>legacy</body></html>"
  );
  assert.match(output, /<title>UCHIHA Builder<\/title>/);
  assert.match(output, /name="uchiha-release" content="V60-VPS-2026\.08\.17"/);
  assert.match(output, /\/platform-v60\.js\?v=60\.0\.0/);
  assert.doesNotMatch(output, /platform-v5\.js\?v=/);
  assert.doesNotMatch(output, /legacy/);
  assert.equal(headers.get("x-uchiha-ui-release"), "v60");
  assert.equal(headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(headers.get("pragma"), "no-cache");
  assert.equal(headers.get("expires"), "0");
});

test("account remains on renewal-capable Builder surface during V60 rollout", async () => {
  let onSend;
  const app = { get() {}, addHook(_name, handler) { onSend = handler; } };
  installLaunchAssetInjection(app);
  const { reply } = replyHarness();
  const output = await onSend({ method: "GET", raw: { url: "/account" } }, reply, "legacy");
  assert.match(output, /account-renewals\.css\?v=2026\.08\.14\.3/);
  assert.match(output, /account-renewals\.js\?v=2026\.08\.14\.3/);
  assert.match(output, /platform-v5\.js\?v=2026\.08\.14\.3/);
});

test("static Builder compatibility document remains available for operational and deep routes", async () => {
  const html = await readFile(platformUrl, "utf8");
  assert.match(html, /<title>UCHIHA Builder<\/title>/);
  assert.match(html, /data-v5-static-fallback/);
  assert.match(html, /href="\/create-store"/);
  assert.match(html, /href="\/account"/);
  assert.match(html, /href="\/orders"/);
  assert.doesNotMatch(html, /v41 Final Demo/i);
});

test("storefront response upgrades stale runtime asset versions before it reaches the browser", async () => {
  let onSend;
  const app = { get() {}, addHook(_name, handler) { onSend = handler; } };
  installLaunchAssetInjection(app);
  const { headers, reply } = replyHarness();
  const oldHtml = `<!doctype html><html><head>
    <link rel="stylesheet" href="/assets/styles.css">
    <link rel="stylesheet" href="/assets/store-reference.css?v=2026.08.11.2">
    <script src="/assets/theme.js?v=2026.08.11.2"></script>
    </head><body>
    <script src="/assets/i18n.js" defer></script>
    <script src="/assets/payments-links.js" defer></script>
    <script src="/assets/app.js?v=2026.08.11.2" deer></script>
    </body></html>`;
  const output = await onSend({ method: "GET", raw: { url: "/store/demo" } }, reply, oldHtml);
  assert.doesNotMatch(output, /2026\.08\.11\.2/);
  for (const asset of ["styles.css", "theme.js", "i18n.js", "payments-links.js", "app.js", "store-desktop-responsive.css"]) {
    assert.match(output, new RegExp(`${asset.replaceAll(".", "\\.")}\\?v=2026\\.08\\.14\\.3`));
  }
  assert.equal(headers.get("cache-control"), "no-store, max-age=0");
});

test("storefront desktop layer expands commerce grids and converts mobile nav to a desktop dock", async () => {
  const source = await readFile(storefrontResponsiveUrl, "utf8");
  assert.match(source, /--reference-page-width:1360px/);
  assert.match(source, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(source, /--reference-page-width:1440px/);
  assert.match(source, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(source, /width:min\(720px,calc\(100% - 64px\)\)/);
  assert.match(source, /transform:translateX\(-50%\)/);
});

test("renewal customer UI derives minor-unit factor from the selected currency", async () => {
  const source = await readFile(accountRenewalsUrl, "utf8");
  assert.match(source, /resolvedOptions\(\)\.maximumFractionDigits/);
  assert.match(source, /factor:\s*10 \*\* digits/);
  assert.match(source, /Number\(minor \|| 0\) \/ factor/);
  assert.doesNotMatch(source, /Number\(minor \|| 0\) \/ 100/);
});
