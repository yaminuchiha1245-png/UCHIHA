import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { installLaunchAssetInjection } from "../src/launch-assets.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("homepage is a small renderer shell and does not hard-code random products", async () => {
  const html = await read("../public/index.html");
  assert.match(html, /platform-unified\.css\?v=20260804\.2/);
  assert.match(html, /platform-unified\.js\?v=20260804\.2/);
  assert.match(html, /id="platformPage"/);
  assert.doesNotMatch(html, /unifiedServicesGrid/);
  assert.doesNotMatch(html, /home-stage1\.css/);
  assert.doesNotMatch(html, /marketing\.css/);
  assert.doesNotMatch(html, /platform-console/);
});

test("unified client implements parent categories, child categories and product routes", async () => {
  const client = await read("../public/platform-unified.js");
  assert.match(client, /const CATEGORIES/);
  assert.match(client, /\/category\/\$\{encodeURIComponent\(category\.slug\)\}/);
  assert.match(client, /\/product\/\$\{encodeURIComponent\(product\.slug\)\}/);
  assert.match(client, /لن نعرض المنتجات قبل اختيار القسم المناسب/);
  assert.match(client, /\/api\/public\/portal/);
  assert.match(client, /\/api\/platform\/account/);
  assert.match(client, /\/api\/auth\/\$\{mode\}/);
  assert.doesNotMatch(client, /document\.body\.innerHTML/);
  assert.doesNotMatch(client, /while\s*\(true\)/);
});

test("public palette is black and white with only a restrained red accent", async () => {
  const css = await read("../public/platform-unified.css");
  assert.match(css, /--u-bg: #050505/);
  assert.match(css, /--u-text: #ffffff/);
  assert.match(css, /--u-accent: #c81e2b/);
  assert.match(css, /font-family: Arial, Tahoma/);
  assert.match(css, /font-weight: 900/);
  assert.doesNotMatch(css, /#805dff/i);
  assert.doesNotMatch(css, /#ab5df3/i);
  assert.doesNotMatch(css, /#35b8ff/i);
});

test("legacy public routes return the new document and catalog routes are real URLs", async () => {
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
    ["/category/:categorySlug", "/category/:categorySlug/:subcategorySlug", "/product/:productSlug"]
  );

  const headers = new Map();
  const reply = {
    removeHeader(name) { headers.delete(name); },
    header(name, value) { headers.set(name, value); }
  };
  const legacy = "<!doctype html><html><head><link rel=\"stylesheet\" href=\"/assets/marketing.css\"></head><body><main>legacy support</main></body></html>";
  for (const pathname of ["/login", "/register", "/services", "/support", "/support.html", "/contact.html", "/payment-methods"]) {
    const output = await hook({ method: "GET", raw: { url: pathname } }, reply, legacy);
    assert.match(output, /id="platformPage"/);
    assert.match(output, /platform-unified\.css\?v=20260804\.2/);
    assert.match(output, /platform-unified\.js\?v=20260804\.2/);
    assert.doesNotMatch(output, /legacy support/);
    assert.doesNotMatch(output, /marketing\.css/);
  }
  assert.equal(headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(headers.get("cache-control"), "no-cache, max-age=0, must-revalidate");
});

test("dynamic catalog handlers serve the same public document", async () => {
  const routes = [];
  const app = {
    get(path, handler) { routes.push({ path, handler }); },
    addHook() {}
  };
  installLaunchAssetInjection(app);
  const headers = new Map();
  const reply = {
    removeHeader(name) { headers.delete(name); },
    header(name, value) { headers.set(name, value); }
  };
  for (const route of routes) {
    const output = await route.handler({ params: {} }, reply);
    assert.match(output, /id="platformPage"/);
    assert.match(output, /platform-unified\.js\?v=20260804\.2/);
  }
});

test("create-store keeps its working wizard but receives only the unified visual shell", async () => {
  let hook;
  const app = {
    get() {},
    addHook(_name, handler) { hook = handler; }
  };
  installLaunchAssetInjection(app);
  const reply = { removeHeader() {}, header() {} };
  const builder = "<!doctype html><html><head></head><body data-page=\"builder\"><main><section class=\"builder-shell\"><form id=\"storeForm\"></form></section></main><script src=\"/assets/app.js\"></script></body></html>";
  const output = await hook({ method: "GET", raw: { url: "/create-store" } }, reply, builder);
  assert.match(output, /platform-unified\.css\?v=2026\.08\.04\.2/);
  assert.match(output, /platform-unified-compat\.css\?v=2026\.08\.04\.2/);
  assert.match(output, /platform-unified\.js\?v=2026\.08\.04\.2/);
  assert.match(output, /id="storeForm"/);
});
