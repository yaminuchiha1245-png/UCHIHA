import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { installLaunchAssetInjection } from "../src/launch-assets.mjs";

const assetsUrl = new URL("../src/launch-assets.mjs", import.meta.url);
const accountRenewalsUrl = new URL("../public/account-renewals.js", import.meta.url);
const responsiveUrl = new URL("../public/v41-responsive.css", import.meta.url);
const storefrontResponsiveUrl = new URL("../public/store-desktop-responsive.css", import.meta.url);

test("launch assets preserve v41 runtime while wiring responsive root, storefront and renewal UI", async () => {
  const source = await readFile(assetsUrl, "utf8");
  assert.match(source, /const V41_DOCUMENT = readFileSync\(new URL\("\.\.\/public\/index\.html"/);
  assert.match(source, /const V41_STYLES = \[`\/assets\/v41-responsive\.css\?v=\$\{RELEASE\}`\]/);
  assert.match(source, /const STOREFRONT_STYLES = \[`\/assets\/store-desktop-responsive\.css\?v=\$\{RELEASE\}`\]/);
  assert.match(source, /pathname === "\/" \|\| pathname === "\/index\.html"[\s\S]*injectAssets\(V41_DOCUMENT/);
  assert.match(source, /normalizeStorefrontRelease/);
  assert.match(source, /account-renewals\.css/);
  assert.match(source, /account-renewals\.js/);
  assert.match(source, /launch-admin-renewals\.js/);
  const rootBlock = source.match(/if \(pathname === "\/" \|\| pathname === "\/index\.html"\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.doesNotMatch(rootBlock, /renewal/i, "renewal assets must not alter the v41 root document");
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
