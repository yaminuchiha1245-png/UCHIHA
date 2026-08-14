import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { installLaunchAssetInjection } from "../src/launch-assets.mjs";

const assetsUrl = new URL("../src/launch-assets.mjs", import.meta.url);
const accountRenewalsUrl = new URL("../public/account-renewals.js", import.meta.url);
const responsiveUrl = new URL("../public/v41-responsive.css", import.meta.url);
const storefrontResponsiveUrl = new URL("../public/store-desktop-responsive.css", import.meta.url);
const productionBridgeUrl = new URL("../public/v41-production-bridge.js", import.meta.url);

test("launch assets preserve v41 visual runtime while wiring preloaded production bridge, responsive root, storefront and renewal UI", async () => {
  const source = await readFile(assetsUrl, "utf8");
  assert.match(source, /const V41_DOCUMENT = readFileSync\(new URL\("\.\.\/public\/index\.html"/);
  assert.match(source, /const V41_STYLES = \[`\/assets\/v41-responsive\.css\?v=\$\{RELEASE\}`\]/);
  assert.match(source, /const V41_BRIDGE = `\/assets\/v41-production-bridge\.js\?v=\$\{RELEASE\}`/);
  assert.match(source, /const STOREFRONT_STYLES = \[`\/assets\/store-desktop-responsive\.css\?v=\$\{RELEASE\}`\]/);
  assert.match(source, /productionV41Document/);
  assert.match(source, /output\.replace\(\/<\\\/head>\/i,[\s\S]*V41_BRIDGE/);
  assert.match(source, /UCHIHA Platform<\/title>/);
  assert.match(source, /normalizeStorefrontRelease/);
  assert.match(source, /account-renewals\.css/);
  assert.match(source, /account-renewals\.js/);
  assert.match(source, /launch-admin-renewals\.js/);
});

test("production public aliases are registered as real Fastify routes instead of relying on 404 onSend replacement", () => {
  const routes = [];
  const app = {
    get(path) { routes.push(path); },
    addHook() {}
  };
  installLaunchAssetInjection(app);
  for (const path of [
    "/register",
    "/register.html",
    "/index.html",
    "/login.html",
    "/services.html",
    "/api-services",
    "/about",
    "/refund-policy",
    "/privacy.html",
    "/terms.html"
  ]) {
    assert.ok(routes.includes(path), `${path} must be a real GET route`);
  }
});

test("root response keeps v41 design, preloads bridge before body runtime and removes demo browser title", async () => {
  let onSend;
  const app = {
    get() {},
    addHook(name, handler) {
      assert.equal(name, "onSend");
      onSend = handler;
    }
  };
  installLaunchAssetInjection(app);
  const headers = new Map();
  const reply = {
    removeHeader() {},
    header(name, value) { headers.set(name.toLowerCase(), value); return this; }
  };
  const output = await onSend(
    { method: "GET", raw: { url: "/" } },
    reply,
    "ignored"
  );
  assert.match(output, /<title>UCHIHA Platform<\/title>/);
  assert.doesNotMatch(output, /<title>UCHIHA Platform — v41 Final Demo<\/title>/);
  assert.match(output, /v41-responsive\.css\?v=2026\.08\.14\.3/);
  assert.match(output, /<script src="\/assets\/v41-production-bridge\.js\?v=2026\.08\.14\.3"><\/script><\/head>/);
  assert.match(output, /<div class="app" id="app">/);
  assert.match(output, /function render\(\)/);
  const bridgePosition = output.indexOf("v41-production-bridge.js");
  const bodyPosition = output.indexOf("<body");
  const runtimePosition = output.indexOf("function render()");
  assert.ok(bridgePosition >= 0 && bridgePosition < bodyPosition, "production bridge must execute from head before v41 body");
  assert.ok(runtimePosition > bridgePosition, "production bridge must load before archived v41 runtime");
  assert.equal(headers.get("cache-control"), "no-store, max-age=0");
});

test("v41 production bridge prevents local demo account, wallet, payment and admin transactions", async () => {
  const source = await readFile(productionBridgeUrl, "utf8");
  assert.match(source, /uchiha-platform-v19-demo/);
  assert.match(source, /localStorage\.removeItem\(DEMO_STORAGE_KEY\)/);
  assert.match(source, /auth:\s*"\/login"/);
  assert.match(source, /account:\s*"\/account"/);
  assert.match(source, /wallet:\s*"\/add-balance"/);
  assert.match(source, /orders:\s*"\/orders"/);
  assert.match(source, /payments:\s*"\/payment-methods"/);
  assert.match(source, /builder:\s*"\/create-store"/);
  assert.match(source, /"demo-admin-launch":\s*"\/platform-admin"/);
  assert.match(source, /loginForm:\s*"\/login"/);
  assert.match(source, /registerForm:\s*"\/register"/);
  assert.match(source, /requestForm:\s*"\/services"/);
  assert.match(source, /paymentForm:\s*"\/payment-methods"/);
  assert.match(source, /stopImmediatePropagation\(\)/);
  assert.match(source, /document\.addEventListener\("click"[\s\S]*true\);/);
  assert.match(source, /document\.addEventListener\("submit"[\s\S]*true\);/);
});

test("storefront response upgrades stale runtime asset versions before it reaches the browser", async () => {
  let onSend;
  const app = {
    get() {},
    addHook(name, handler) {
      assert.equal(name, "onSend");
      onSend = handler;
    }
  };
  installLaunchAssetInjection(app);
  const headers = new Map();
  const reply = {
    removeHeader() {},
    header(name, value) { headers.set(name.toLowerCase(), value); return this; }
  };
  const oldHtml = `<!doctype html><html><head>
    <link rel="stylesheet" href="/assets/styles.css">
    <link rel="stylesheet" href="/assets/store-reference.css?v=2026.08.11.2">
    <script src="/assets/theme.js?v=2026.08.11.2"></script>
    </head><body>
    <script src="/assets/i18n.js" defer></script>
    <script src="/assets/payments-links.js" defer></script>
    <script src="/assets/app.js?v=2026.08.11.2" defer></script>
    </body></html>`;
  const output = await onSend(
    { method: "GET", raw: { url: "/store/demo" } },
    reply,
    oldHtml
  );
  assert.doesNotMatch(output, /2026\.08\.11\.2/);
  assert.match(output, /styles\.css\?v=2026\.08\.14\.3/);
  assert.match(output, /theme\.js\?v=2026\.08\.14\.3/);
  assert.match(output, /i18n\.js\?v=2026\.08\.14\.3/);
  assert.match(output, /payments-links\.js\?v=2026\.08\.14\.3/);
  assert.match(output, /app\.js\?v=2026\.08\.14\.3/);
  assert.match(output, /store-desktop-responsive\.css\?v=2026\.08\.14\.3/);
  assert.equal(headers.get("cache-control"), "no-store, max-age=0");
});

test("v41 responsive layer removes phone-frame limit and includes desktop breakpoints", async () => {
  const source = await readFile(responsiveUrl, "utf8");
  assert.match(source, /\.app\{[^}]*max-width:none!important/);
  assert.match(source, /height:100dvh!important/);
  assert.match(source, /@media \(min-width:768px\)/);
  assert.match(source, /@media \(min-width:1100px\)/);
  assert.match(source, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(source, /width:min\(720px,calc\(100% - 48px\)\)/);
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
  assert.match(source, /Number\(minor \|\| 0\) \/ factor/);
  assert.doesNotMatch(source, /Number\(minor \|\| 0\) \/ 100/);
});
