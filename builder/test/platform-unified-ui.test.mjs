import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { installLaunchAssetInjection } from "../src/launch-assets.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("static homepage is usable before JavaScript initializes", async () => {
  const html = await read("../public/index.html");
  assert.match(html, /platform-v5\.css\?v=20260805\.5/);
  assert.match(html, /platform-v5-responsive\.css\?v=20260805\.5/);
  assert.match(html, /platform-v5-polish\.css\?v=20260805\.5/);
  assert.match(html, /platform-v5\.js\?v=20260805\.5/);
  assert.match(html, /platform-v5-stability\.js\?v=20260805\.5/);
  assert.match(html, /platform-v5-polish\.js\?v=20260805\.5/);
  assert.match(html, /platform-v5-recovery\.js\?v=20260805\.5/);
  assert.match(html, /pwa\.js\?v=20260805\.5/);
  assert.ok(
    html.indexOf("platform-v5-stability.js") < html.indexOf("platform-v5-polish.js"),
    "stability guard must load before polish"
  );
  assert.match(html, /id="appDrawerRoot"/);
  assert.match(html, /id="platformPage"/);
  assert.match(html, /id="bottomNav"/);
  assert.match(html, /data-v5-static-fallback/);
  assert.match(html, /href="\/category\/telegram-bots"/);
  assert.match(html, /الأقسام الرئيسية/);
  assert.doesNotMatch(html, /class="v5-loading"/);
  assert.doesNotMatch(html, /platform-unified\.(?:css|js)/);
  assert.doesNotMatch(html, /marketing\.css/);
  assert.doesNotMatch(html, /home-stage1/);
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

test("v5 interface keeps empty image boxes, names below them, and a right drawer", async () => {
  const css = await read("../public/platform-v5.css");
  assert.match(css, /\.v5-drawer\s*\{[\s\S]*inset-inline-end:\s*0/);
  assert.match(css, /width:\s*min\(40vw,\s*370px\)/);
  assert.match(css, /\.v5-card-media\.empty::after/);
  assert.match(css, /\.v5-category-name[\s\S]*margin-top:\s*9px/);
  assert.match(css, /font-family:\s*Arial, Tahoma/);
  assert.match(css, /--v5-red:\s*#c92732/);
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

test("all public and legacy routes return the resilient v5 document", async () => {
  let hook;
  const routes = [];
  const app = {
    get(path, handler) {
      routes.push({ path, handler });
    },
    addHook(name, handler) {
      assert.equal(name, "onSend");
      hook = handler;
    }
  };
  installLaunchAssetInjection(app);
  assert.deepEqual(
    routes.map((route) => route.path),
    [
      "/category/:categorySlug",
      "/category/:categorySlug/:subcategorySlug",
      "/product/:productSlug",
      "/add-balance",
      "/add-balance/:methodKey",
      "/orders"
    ]
  );

  const headers = new Map();
  const reply = {
    removeHeader(name) { headers.delete(name); },
    header(name, value) { headers.set(name, value); }
  };
  const legacy = "<!doctype html><html><head><link rel=\"stylesheet\" href=\"/assets/marketing.css\"></head><body><main>legacy support</main></body></html>";
  for (const pathname of ["/", "/login", "/register", "/services", "/support", "/support.html", "/contact.html", "/payment-methods", "/add-balance", "/orders"]) {
    const output = await hook({ method: "GET", raw: { url: pathname } }, reply, legacy);
    assert.match(output, /id="platformPage"/);
    assert.match(output, /data-v5-static-fallback/);
    assert.match(output, /platform-v5\.css\?v=20260805\.5/);
    assert.match(output, /platform-v5-polish\.css\?v=20260805\.5/);
    assert.match(output, /platform-v5\.js\?v=20260805\.5/);
    assert.match(output, /platform-v5-stability\.js\?v=20260805\.5/);
    assert.match(output, /platform-v5-polish\.js\?v=20260805\.5/);
    assert.match(output, /platform-v5-recovery\.js\?v=20260805\.5/);
    assert.ok(output.indexOf("platform-v5-stability.js") < output.indexOf("platform-v5-polish.js"));
    assert.doesNotMatch(output, /class="v5-loading"/);
    assert.doesNotMatch(output, /legacy support/);
    assert.doesNotMatch(output, /marketing\.css/);
    assert.doesNotMatch(output, /platform-unified\.(?:css|js)/);
  }
  assert.equal(headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(headers.get("pragma"), "no-cache");
  assert.equal(headers.get("expires"), "0");
});

test("dynamic platform handlers serve the same resilient v5 document", async () => {
  const routes = [];
  const app = {
    get(path, handler) { routes.push({ path, handler }); },
    addHook() {}
  };
  installLaunchAssetInjection(app);
  const reply = { removeHeader() {}, header() {} };
  for (const route of routes) {
    const output = await route.handler({ params: {} }, reply);
    assert.match(output, /id="platformPage"/);
    assert.match(output, /data-v5-static-fallback/);
    assert.match(output, /platform-v5\.js\?v=20260805\.5/);
    assert.match(output, /platform-v5-stability\.js\?v=20260805\.5/);
    assert.match(output, /platform-v5-polish\.js\?v=20260805\.5/);
    assert.match(output, /platform-v5-recovery\.js\?v=20260805\.5/);
    assert.doesNotMatch(output, /class="v5-loading"/);
  }
});

test("create-store keeps its functional wizard behind a dedicated v5 bridge", async () => {
  let hook;
  const app = {
    get() {},
    addHook(_name, handler) { hook = handler; }
  };
  installLaunchAssetInjection(app);
  const reply = { removeHeader() {}, header() {} };
  const builder = "<!doctype html><html><head></head><body data-page=\"builder\"><main><section class=\"builder-shell\"><form id=\"storeForm\"></form></section></main><script src=\"/assets/app.js\"></script></body></html>";
  const output = await hook({ method: "GET", raw: { url: "/create-store" } }, reply, builder);
  assert.match(output, /platform-v5\.css\?v=2026\.08\.05\.5/);
  assert.match(output, /platform-v5-polish\.css\?v=2026\.08\.05\.5/);
  assert.match(output, /platform-v5-builder\.js\?v=2026\.08\.05\.5/);
  assert.match(output, /launch-builder-sales\.js\?v=2026\.08\.05\.5/);
  assert.match(output, /platform-unified-compat\.css\?v=2026\.08\.05\.5/);
  assert.doesNotMatch(output, /platform-v5\.js\?v=2026\.08\.05\.5/);
  assert.doesNotMatch(output, /platform-v5-polish\.js\?v=2026\.08\.05\.5/);
  assert.match(output, /id="storeForm"/);
});
