import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { installLaunchAssetInjection } from "../src/launch-assets.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("homepage is replaced by the single unified platform surface", async () => {
  const html = await read("../public/index.html");
  assert.match(html, /platform-unified\.css\?v=20260804\.1/);
  assert.match(html, /platform-unified\.js\?v=20260804\.1/);
  assert.match(html, /id="unifiedCategoryGrid"/);
  assert.match(html, /id="unifiedServicesGrid"/);
  assert.match(html, /unified-dashboard-preview/);
  assert.doesNotMatch(html, /home-stage1\.css/);
  assert.doesNotMatch(html, /marketing\.css/);
  assert.doesNotMatch(html, /platform-console/);
});

test("unified client keeps navigation and filtering finite and non-destructive", async () => {
  const client = await read("../public/platform-unified.js");
  assert.match(client, /AbortController/);
  assert.match(client, /data-category-filter/);
  assert.match(client, /unified-auth-route/);
  assert.match(client, /unified-create-route/);
  assert.match(client, /\/api\/platform\/account/);
  assert.doesNotMatch(client, /document\.body\.innerHTML/);
  assert.doesNotMatch(client, /while\s*\(true\)/);
});

test("unified stylesheet removes old auth presentation without hiding functional forms", async () => {
  const css = await read("../public/platform-unified.css");
  assert.match(css, /body\[data-page="builder"\]\.unified-auth-route main > \.hero/);
  assert.match(css, /\.builder-shell/);
  assert.match(css, /\.account-unified-page/);
  assert.doesNotMatch(css, /#authStep\s*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(css, /#storeForm\s*\{[^}]*display:\s*none/s);
});

test("public platform routes receive the same shell assets", async () => {
  let hook;
  const app = {
    addHook(name, handler) {
      assert.equal(name, "onSend");
      hook = handler;
    }
  };
  installLaunchAssetInjection(app);
  const reply = {
    removeHeader() {},
    header() {}
  };
  const base = "<!doctype html><html><head></head><body><main>content</main></body></html>";
  for (const pathname of ["/login", "/register", "/create-store", "/services", "/support"]) {
    const output = await hook({ method: "GET", raw: { url: pathname } }, reply, base);
    assert.match(output, /platform-unified\.css\?v=2026\.08\.04\.1/);
    assert.match(output, /platform-unified\.js\?v=2026\.08\.04\.1/);
  }
});
