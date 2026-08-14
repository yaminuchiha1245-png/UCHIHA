import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { installLaunchAssetInjection } from "../src/launch-assets.mjs";

const RELEASE = "2026.08.14.3";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function replyHarness() {
  const headers = new Map();
  return {
    headers,
    reply: {
      removeHeader(name) { headers.delete(name); },
      header(name, value) { headers.set(name, value); }
    }
  };
}

function launchHarness() {
  let hook;
  const routes = [];
  const app = {
    get(path, handler) { routes.push({ path, handler }); },
    addHook(name, handler) {
      assert.equal(name, "onSend");
      hook = handler;
    }
  };
  installLaunchAssetInjection(app);
  return { routes, hook };
}

test("static homepage is usable before JavaScript initializes", async () => {
  const html = await read("../public/index.html");
  assert.match(html, /<title>UCHIHA Platform — v41 Final Demo<\/title>/);
  assert.match(html, /<div class="app" id="app">/);
  assert.match(html, /<main id="main"><\/main>/);
  assert.match(html, /id="bootLoader"/);
  assert.match(html, /function render\(\)/);
  assert.match(html, /function notificationsPage\(\)/);
  assert.match(html, /function paymentAdminPage\(\)/);
  assert.match(html, /function supportPage\(\)/);
  assert.doesNotMatch(html, /platform-v5\.(?:css|js)/);
});

test("production CSP authorizes only the approved inline v41 runtime", async () => {
  const [html, app] = await Promise.all([read("../public/index.html"), read("../src/app.mjs")]);
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter(Boolean);
  assert.equal(scripts.length, 1);
  const hash = createHash("sha256").update(scripts[0]).digest("base64");
  assert.match(app, new RegExp(`script-src 'self' 'sha256-${hash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.doesNotMatch(app, /script-src 'self' 'unsafe-inline'/);
});

test("stability guard prevents the drawer polish observer from rewriting forever", async () => {
  const guard = await read("../public/platform-v5-stability.js");
  assert.match(guard, /data-stable-close-label/);
  assert.match(guard, /label\.hidden = true/);
  assert.match(guard, /label\.textContent = "إغلاق"/);
  assert.match(guard, /MutationObserver/);
  assert.match(guard, /queueMicrotask\(stabilize\)/);
  assert.doesNotMatch(guard, /while\s*\(true\)/);
});

test("v5 client never invents sale products and follows category hierarchy", async () => {
  const client = await read("../public/platform-v5.js");
  assert.match(client, /const CATEGORY_TREE/);
  assert.match(client, /\/category\/\$\{encodeURIComponent\(category\.slug\)\}/);
  assert.match(client, /\/product\/\$\{encodeURIComponent\(product\.slug\)\}/);
  assert.match(client, /catalog\.isProduct === true/);
  assert.match(client, /service\.isCatalogProduct === true/);
  assert.match(client, /لا توجد منتجات جاهزة للبيع في هذا القسم حاليًا/);
  assert.match(client, /\/api\/platform\/deposit-requests/);
  assert.match(client, /\/api\/platform\/orders/);
  assert.doesNotMatch(client, /FALLBACK_PRODUCTS/);
  assert.doesNotMatch(client, /store-bot-starter/);
  assert.doesNotMatch(client, /document\.body\.innerHTML/);
  assert.doesNotMatch(client, /while\s*\(true\)/);
});

test("v5 dedicated flows keep the approved full-color visual system", async () => {
  const css = await read("../public/platform-v5.css");
  const polish = await read("../public/platform-v5-polish.css");
  assert.match(css, /\.v5-drawer\s*\{[\s\S]*inset-inline-end:\s*0/);
  assert.match(polish, /\.v5-drawer\s*\{[\s\S]*right:\s*0;[\s\S]*left:\s*auto/);
  assert.match(polish, /width:\s*min\(84vw,\s*360px\)/);
  assert.match(css, /\.v5-category-media img\s*\{[\s\S]*object-fit:\s*contain/);
  assert.match(css, /\.v5-category-media\[data-tone="red"\]/);
  assert.match(css, /\.v5-category-media\[data-tone="orange"\]/);
  assert.match(css, /\.v5-category-name[\s\S]*margin-top:\s*9px/);
  assert.match(css, /\.v5-home-slides\s*\{[\s\S]*aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(css, /@media \(min-width:\s*720px\)[\s\S]*aspect-ratio:\s*16\s*\/\s*7/);
  assert.match(css, /font-family:\s*Arial, Tahoma/);
  assert.match(css, /--v5-red:\s*#c92732/);
  assert.match(polish, /background:\s*linear-gradient\(135deg,[\s\S]*rgba\(79, 8, 21, \.97\)/);
  assert.doesNotMatch(css, /#805dff/i);
  assert.doesNotMatch(css, /#ab5df3/i);
});

test("polish layer uses a custom SVG icon family and smooth motion without emoji", async () => {
  const client = await read("../public/platform-v5-polish.js");
  const css = await read("../public/platform-v5-polish.css");
  assert.match(client, /const ICONS = Object\.freeze/);
  assert.match(client, /language:/);
  assert.match(client, /deposit:/);
  assert.match(client, /shield:/);
  assert.match(client, /telegram:/);
  assert.match(client, /navItem\("\/add-balance"/);
  assert.match(client, /navItem\("\/services"/);
  assert.match(client, /MutationObserver/);
  assert.match(client, /v5-bottom-nav-hidden/);
  assert.doesNotMatch(client, /🏠|💳|👛|📦|👤|🛡️|🔑|🎧|✈️|🌍/u);
  assert.match(css, /grid-template-columns:\s*repeat\(5/);
  assert.match(css, /translate3d\(104%,\s*0,\s*0\)/);
  assert.match(css, /--v5-motion-medium:\s*270ms/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("catalog, payment browsing and orders use the synchronized v41 production shell", async () => {
  const { hook } = launchHarness();
  const { headers, reply } = replyHarness();
  const legacy = "<!doctype html><html><head></head><body><main>legacy</main></body></html>";
  const routes = [
    "/",
    "/services",
    "/payment-methods",
    "/orders",
    "/about",
    "/showcase",
    "/category/telegram-bots",
    "/category/hosting-domains/domains",
    "/product/example-service"
  ];

  for (const pathname of routes) {
    const output = await hook({ method: "GET", raw: { url: pathname } }, reply, legacy);
    assert.match(output, /<title>UCHIHA Platform<\/title>/, `${pathname} must expose the production v41 title`);
    assert.match(output, /<div class="app" id="app">/, `${pathname} must expose the v41 app shell`);
    assert.match(output, /<main id="main"><\/main>/, `${pathname} must expose the v41 main view`);
    assert.match(output, new RegExp(`v41-production-bridge\\.js\\?v=${RELEASE.replaceAll(".", "\\.")}`));
    assert.match(output, /window\.__UCHIHA_V41_RUNTIME__=Object\.freeze/);
    assert.doesNotMatch(output, /data-v5-static-fallback/);
  }

  assert.equal(headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(headers.get("pragma"), "no-cache");
  assert.equal(headers.get("expires"), "0");
});

test("login, support, contact and deposit remain dedicated production flows", async () => {
  const { hook } = launchHarness();
  const { reply } = replyHarness();
  const legacy = "<!doctype html><html><head></head><body><main>legacy support</main></body></html>";
  for (const pathname of ["/login", "/register", "/support", "/support.html", "/contact", "/contact.html", "/add-balance"]) {
    const output = await hook({ method: "GET", raw: { url: pathname } }, reply, legacy);
    assert.match(output, /id="platformPage"/);
    assert.match(output, /data-v5-static-fallback/);
    assert.match(output, new RegExp(`platform-v5\\.css\\?v=${RELEASE.replaceAll(".", "\\.")}`));
    assert.match(output, new RegExp(`platform-v5-polish\\.css\\?v=${RELEASE.replaceAll(".", "\\.")}`));
    assert.match(output, new RegExp(`platform-v5\\.js\\?v=${RELEASE.replaceAll(".", "\\.")}`));
    assert.match(output, new RegExp(`platform-v5-stability\\.js\\?v=${RELEASE.replaceAll(".", "\\.")}`));
    assert.match(output, new RegExp(`platform-v5-polish\\.js\\?v=${RELEASE.replaceAll(".", "\\.")}`));
    assert.match(output, new RegExp(`platform-v5-recovery\\.js\\?v=${RELEASE.replaceAll(".", "\\.")}`));
    assert.ok(output.indexOf("platform-v5-stability.js") < output.indexOf("platform-v5-polish.js"));
    assert.doesNotMatch(output, /class="v5-loading"/);
    assert.doesNotMatch(output, /legacy support/);
    assert.doesNotMatch(output, /marketing\.css/);
  }
});

test("registered dynamic route handlers stay server-safe while onSend upgrades customer-facing routes", async () => {
  const { routes, hook } = launchHarness();
  const routePaths = routes.map((route) => route.path);
  for (const expected of [
    "/category/:categorySlug",
    "/category/:categorySlug/:subcategorySlug",
    "/product/:productSlug",
    "/add-balance",
    "/add-balance/:methodKey",
    "/orders"
  ]) {
    assert.equal(routePaths.includes(expected), true, `${expected} must stay registered`);
  }

  const { reply } = replyHarness();
  const categoryHandler = routes.find((route) => route.path === "/category/:categorySlug")?.handler;
  assert.equal(typeof categoryHandler, "function");
  const raw = await categoryHandler({ params: { categorySlug: "telegram-bots" } }, reply);
  assert.match(raw, /id="platformPage"/);
  assert.match(raw, /data-v5-static-fallback/);

  const final = await hook({ method: "GET", raw: { url: "/category/telegram-bots" } }, reply, raw);
  assert.match(final, /<div class="app" id="app">/);
  assert.match(final, /v41-production-bridge\.js/);
  assert.doesNotMatch(final, /data-v5-static-fallback/);
});

test("create-store keeps its functional wizard behind a dedicated v5 bridge", async () => {
  const { hook } = launchHarness();
  const { reply } = replyHarness();
  const builder = "<!doctype html><html><head></head><body data-page=\"builder\"><main><section class=\"builder-shell\"><form id=\"storeForm\"></form></section></main><script src=\"/assets/app.js\"></script></body></html>";
  const output = await hook({ method: "GET", raw: { url: "/create-store" } }, reply, builder);
  const escaped = RELEASE.replaceAll(".", "\\.");
  assert.match(output, new RegExp(`platform-v5\\.css\\?v=${escaped}`));
  assert.match(output, new RegExp(`platform-v5-polish\\.css\\?v=${escaped}`));
  assert.match(output, new RegExp(`platform-v5-builder\\.js\\?v=${escaped}`));
  assert.match(output, new RegExp(`launch-builder-sales\\.js\\?v=${escaped}`));
  assert.match(output, new RegExp(`launch-payment-method-guard\\.js\\?v=${escaped}`));
  assert.match(output, new RegExp(`platform-unified-compat\\.css\\?v=${escaped}`));
  assert.doesNotMatch(output, new RegExp(`platform-v5\\.js\\?v=${escaped}`));
  assert.doesNotMatch(output, new RegExp(`platform-v5-polish\\.js\\?v=${escaped}`));
  assert.match(output, /id="storeForm"/);
});
