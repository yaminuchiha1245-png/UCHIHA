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
  const [css, runtimeCss, polishCss, polishRuntimeCss, commerceCss, checkoutCss] = await Promise.all([
    publicSource("store-reference.css"),
    publicSource("store-reference-runtime.css"),
    publicSource("store-polish-v2.css"),
    publicSource("store-polish-v2-runtime.css"),
    publicSource("store-commerce-v3.css"),
    publicSource("store-checkout-v4.css")
  ]);
  assert.match(css, /--reference-control-height:\s*44px/);
  assert.match(css, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(runtimeCss, /\.category-card-visual/);
  assert.match(runtimeCss, /\.product-visual/);
  assert.match(runtimeCss, /\.product-actions/);
  assert.match(polishCss, /\.store-search-shell\s*\{[\s\S]*position:\s*sticky/);
  assert.match(polishCss, /\.store-mobile-nav \.mobile-nav-primary/);
  assert.match(polishCss, /\.store-more-dialog\[open\]/);
  assert.match(polishCss, /\.product-actions button\s*\{[\s\S]*min-height:\s*40px/);
  assert.match(polishCss, /prefers-reduced-motion/);
  assert.match(polishRuntimeCss, /\.store-search-clear/);
  assert.match(polishRuntimeCss, /\.store-main-search\.has-search-value input/);
  assert.doesNotMatch(polishRuntimeCss, /:has\(/);
  assert.match(polishRuntimeCss, /#storeNotificationsLink\s*\{[\s\S]*display:\s*grid/);
  assert.match(polishRuntimeCss, /\.store-profile-chip\s*\{[\s\S]*display:\s*none/);
  assert.match(commerceCss, /\.product-actions\s*\{[\s\S]*grid-template-columns:\s*44px minmax\(0, 1fr\)/);
  assert.match(commerceCss, /\.store-add-cart::before/);
  assert.match(commerceCss, /font-size:\s*12\.5px/);
  assert.match(checkoutCss, /\.order-dialog\[open\]/);
  assert.match(checkoutCss, /\.order-product-image/);
  assert.match(checkoutCss, /\.store-cart-item/);
  assert.match(checkoutCss, /position:\s*sticky/);
  assert.doesNotMatch(css, /\.gif/i);
  assert.doesNotMatch(polishCss, /\.gif/i);
});

test("storefront loading indicator and welcome are centered and UCHIHA branded", async () => {
  const [css, welcomeCss, runtime] = await Promise.all([
    publicSource("store-reference.css"),
    publicSource("store-reference-welcome.css"),
    publicSource("store-reference.js")
  ]);
  assert.match(css, /\.store-loading\s*\{[\s\S]*place-items:\s*center/);
  assert.match(css, /\.store-loader-orbit::before/);
  assert.match(css, /@keyframes reference-store-spin/);
  assert.match(welcomeCss, /\.reference-login-overlay/);
  assert.match(welcomeCss, /\.reference-login-card/);
  assert.match(runtime, /\/assets\/brand\/uchiha-mark\.svg/);
  assert.match(runtime, /reference-demo-bar/);
  assert.match(runtime, /reference-login-overlay/);
  assert.match(runtime, /متابعة كزائر/);
  assert.match(runtime, /uchiha-demo-welcome-dismissed/);
});

test("storefront boot guard prevents an endless loading screen", async () => {
  const [guard, theme, worker] = await Promise.all([
    publicSource("store-boot-guard.js"),
    publicSource("theme.js"),
    publicSource("sw.js")
  ]);
  assert.match(guard, /unhandledrejection/);
  assert.match(guard, /window\.setTimeout/);
  assert.match(guard, /\/api\/storefront\//);
  assert.match(guard, /loading\.hidden = true/);
  assert.match(guard, /app\.hidden = false/);
  assert.match(guard, /storeBootRecovered/);
  assert.match(theme, /store-boot-guard\.js/);
  assert.match(theme, /store-polish-v2\.css/);
  assert.match(theme, /store-polish-v2-runtime\.css/);
  assert.match(theme, /store-commerce-v3\.css/);
  assert.match(theme, /store-checkout-v4\.css/);
  assert.match(theme, /store-polish-v2\.js/);
  assert.match(theme, /2026\.08\.07\.13/);
  assert.match(worker, /store-boot-guard\.js/);
  assert.match(worker, /store-polish-v2\.css/);
  assert.match(worker, /store-polish-v2-runtime\.css/);
  assert.match(worker, /store-commerce-v3\.css/);
  assert.match(worker, /store-checkout-v4\.css/);
  assert.match(worker, /store-polish-v2\.js/);
  assert.match(worker, /2026\.08\.07\.13/);
});

test("owner panel uses matching controls, responsive drawer navigation, and readable mobile content", async () => {
  const [css, runtime, polishCss, polishRuntime, html, theme, worker] = await Promise.all([
    publicSource("admin-reference.css"),
    publicSource("admin-reference.js"),
    publicSource("admin-polish-v2.css"),
    publicSource("admin-polish-v2.js"),
    publicSource("admin.html"),
    publicSource("theme.js"),
    publicSource("sw.js")
  ]);
  assert.match(css, /--admin-reference-control:\s*44px/);
  assert.match(css, /grid-template-columns:\s*246px minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(runtime, /reference-admin-demo/);
  assert.match(html, /class="nav-icon"><svg/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(polishCss, /--admin-mobile-sidebar-width/);
  assert.match(polishCss, /\.admin-mobile-nav-open \.dashboard-sidebar/);
  assert.match(polishCss, /\.admin-mobile-backdrop/);
  assert.match(polishCss, /env\(safe-area-inset-bottom/);
  assert.match(polishRuntime, /const RELEASE = "2026\.08\.07\.11"/);
  assert.match(polishRuntime, /aria-expanded/);
  assert.match(polishRuntime, /sidebar\.inert/);
  assert.match(polishRuntime, /event\.key === "Escape"/);
  assert.match(polishRuntime, /closest\("\.nav-item"\)/);
  assert.match(theme, /admin-polish-v2\.css/);
  assert.match(theme, /admin-polish-v2\.js/);
  assert.match(worker, /admin-polish-v2\.css/);
  assert.match(worker, /admin-polish-v2\.js/);
});

test("finance support and account settings share the owner reference skin and mobile workflows", async () => {
  const [css, polish, workflow, theme, worker, paymentsHtml, supportHtml, accountHtml] = await Promise.all([
    publicSource("admin-subpages-reference.css"),
    publicSource("admin-subpages-polish-v2.css"),
    publicSource("admin-subpages-polish-v2.js"),
    publicSource("theme.js"),
    publicSource("sw.js"),
    publicSource("payments-admin.html"),
    publicSource("support-admin.html"),
    publicSource("account-admin.html")
  ]);
  assert.match(css, /--reference-control:\s*44px/);
  assert.match(css, /data-page="payments-admin"/);
  assert.match(css, /data-page="support-admin"/);
  assert.match(css, /data-page="account-admin"/);
  assert.match(polish, /--subadmin-sticky-offset/);
  assert.match(polish, /scroll-snap-type:\s*inline proximity/);
  assert.match(polish, /\.admin-dialog\[open\]/);
  assert.match(polish, /\.identity-admin-dialog\[open\]/);
  assert.match(polish, /\.support-mobile-back/);
  assert.match(polish, /\.support-reply-form\s*\{[\s\S]*position:\s*sticky/);
  assert.match(polish, /env\(safe-area-inset-bottom/);
  assert.match(polish, /\.search-row\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(workflow, /const RELEASE = "2026\.08\.07\.13"/);
  assert.match(workflow, /MutationObserver/);
  assert.match(workflow, /scrollIntoView/);
  assert.match(workflow, /support-mobile-back/);
  assert.match(workflow, /data-identity-dialog-trigger/);
  assert.match(theme, /owner-subadmin/);
  assert.match(theme, /admin-subpages-reference\.css/);
  assert.match(theme, /admin-subpages-polish-v2\.css/);
  assert.match(theme, /admin-subpages-polish-v2\.js/);
  assert.match(worker, /admin-subpages-polish-v2\.css/);
  assert.match(worker, /admin-subpages-polish-v2\.js/);
  assert.match(paymentsHtml, /admin-subpages-reference\.css/);
  assert.match(paymentsHtml, /theme\.js/);
  assert.match(supportHtml, /data-page="support-admin"/);
  assert.match(accountHtml, /data-page="account-admin"/);
});

test("persistent demo branding points to UCHIHA-owned assets and four root categories", async () => {
  const [branding, showcase] = await Promise.all([
    source("demo-uchiha-branding.mjs"),
    source("showcase.mjs")
  ]);
  assert.match(branding, /UCHIHA STORE/);
  assert.match(branding, /#8f3044/);
  assert.match(branding, /uchiha-slide-main\.svg/);
  assert.match(branding, /uchiha-category-games\.svg/);
  assert.match(branding, /uchiha-category-services\.svg/);
  assert.match(branding, /UCHIHA_DEMO_SERVICES_CATEGORY_ID/);
  assert.match(branding, /UCHIHA_DEMO_SERVICE_PRODUCT_ID/);
  assert.match(branding, /programming_service/);
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
    "demo-assets/uchiha-category-digital.svg",
    "demo-assets/uchiha-category-services.svg"
  ];
  for (const name of names) {
    const svg = await publicSource(name);
    assert.match(svg, /<svg/);
    assert.doesNotMatch(svg, /ahminix/i);
  }
});