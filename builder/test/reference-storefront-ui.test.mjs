import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicUrl = new URL("../public/", import.meta.url);
const sourceUrl = new URL("../src/", import.meta.url);

async function publicSource(name) {
  return readFile(new URL(name, publicUrl), "utf8");
}

async function source(name) {
  return readFile(new URL(name, sourceUrl), "utf8");
}

test("storefront reference skin has one professional control system", async () => {
  const [css, runtimeCss] = await Promise.all([
    publicSource("store-reference.css"),
    publicSource("store-reference-runtime.css")
  ]);
  assert.match(css, /--reference-control-height:\s*44px/);
  assert.match(css, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(runtimeCss, /\.category-card-visual/);
  assert.match(runtimeCss, /\.product-visual/);
  assert.match(runtimeCss, /\.product-actions/);
  assert.doesNotMatch(css, /\.gif/i);
});

test("storefront loading indicator is centered and UCHIHA branded", async () => {
  const [css, runtime] = await Promise.all([
    publicSource("store-reference.css"),
    publicSource("store-reference.js")
  ]);
  assert.match(css, /\.store-loading\s*\{[\s\S]*place-items:\s*center/);
  assert.match(css, /\.store-loader-orbit::before/);
  assert.match(css, /@keyframes reference-store-spin/);
  assert.match(runtime, /\/assets\/brand\/uchiha-mark\.svg/);
  assert.match(runtime, /reference-demo-bar/);
});

test("owner panel uses matching compact controls and responsive navigation", async () => {
  const [css, runtime, html] = await Promise.all([
    publicSource("admin-reference.css"),
    publicSource("admin-reference.js"),
    publicSource("admin.html")
  ]);
  assert.match(css, /--admin-reference-control:\s*44px/);
  assert.match(css, /grid-template-columns:\s*246px minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(runtime, /reference-admin-demo/);
  assert.match(html, /class="nav-icon"><svg/);
  assert.match(css, /prefers-reduced-motion/);
});

test("finance support and account settings share the owner reference skin", async () => {
  const [css, theme, paymentsHtml, supportHtml, accountHtml] = await Promise.all([
    publicSource("admin-subpages-reference.css"),
    publicSource("theme.js"),
    publicSource("payments-admin.html"),
    publicSource("support-admin.html"),
    publicSource("account-admin.html")
  ]);
  assert.match(css, /--reference-control:\s*44px/);
  assert.match(css, /data-page="payments-admin"/);
  assert.match(css, /data-page="support-admin"/);
  assert.match(css, /data-page="account-admin"/);
  assert.match(theme, /owner-subadmin/);
  assert.match(theme, /admin-subpages-reference\.css/);
  assert.match(paymentsHtml, /admin-subpages-reference\.css/);
  assert.match(paymentsHtml, /theme\.js/);
  assert.match(supportHtml, /data-page="support-admin"/);
  assert.match(accountHtml, /data-page="account-admin"/);
});

test("persistent demo branding points to UCHIHA-owned assets", async () => {
  const [branding, showcase] = await Promise.all([
    source("demo-uchiha-branding.mjs"),
    source("showcase.mjs")
  ]);
  assert.match(branding, /UCHIHA STORE/);
  assert.match(branding, /#8f3044/);
  assert.match(branding, /uchiha-slide-main\.svg/);
  assert.match(branding, /uchiha-category-games\.svg/);
  assert.match(showcase, /applyUchihaShowcaseBranding/);
  assert.match(showcase, /متجر UCHIHA التجريبي/);
});

test("all new visual assets are present and original SVG documents", async () => {
  const names = [
    "demo-assets/uchiha-slide-main.svg",
    "demo-assets/uchiha-slide-account.svg",
    "demo-assets/uchiha-slide-support.svg",
    "demo-assets/uchiha-category-games.svg",
    "demo-assets/uchiha-category-subscriptions.svg",
    "demo-assets/uchiha-category-digital.svg"
  ];
  for (const name of names) {
    const svg = await publicSource(name);
    assert.match(svg, /<svg/);
    assert.doesNotMatch(svg, /ahminix/i);
  }
});
