import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("storefront loads the dedicated demo development asset", async () => {
  const html = await read("public/store.html");
  assert.match(html, /demo-development\.js\?v=20260805-demo/);
});

test("demo development tracker is restricted to the demo storefront", async () => {
  const source = await read("public/demo-development.js");
  assert.match(source, /const DEMO_SLUG = "demo"/);
  assert.match(source, /new RegExp\(`\^\/store\/\$\{DEMO_SLUG\}\/\?\$`\)/);
  assert.match(source, /location\.hostname\.toLowerCase\(\)\.startsWith\(`\$\{DEMO_SLUG\}\.\`\)/);
  assert.match(source, /if \(!isDemoStore\(\)/);
});

test("demo preview derives its permanent link from the configured store base domain", async () => {
  const source = await read("public/demo-development.js");
  assert.match(source, /config\?\.storeBaseDomain/);
  assert.match(source, /https:\/\/\$\{DEMO_SLUG\}\.\$\{baseDomain\}\//);
  assert.match(source, /\/api\/public\/config/);
  assert.match(source, /data-demo-store/);
});

test("demo preview exposes a visible development roadmap and launch safeguards", async () => {
  const source = await read("public/demo-development.js");
  assert.match(source, /aria-valuenow="58"/);
  assert.match(source, /نسخة تجريبية قيد التطوير/);
  assert.match(source, /إطلاقه كمنتج داخل المنصة/);
  assert.match(source, /real orders and payments remain disabled/);
  assert.match(source, /noindex,nofollow,noarchive/);
  assert.equal((source.match(/\[\"[^\"]+\", \"[^\"]+\", \"(?:done|active|planned)\"\]/g) || []).length, 12);
});

test("production showcase keeps the demo subdomain active and attached to the demo store", async () => {
  const showcase = await read("src/showcase.mjs");
  assert.match(showcase, /const hostname = baseDomain \? `demo\.\$\{baseDomain\}` : null/);
  assert.match(showcase, /domain_type, status/);
  assert.match(showcase, /'subdomain','active'/);
  assert.match(showcase, /is_primary=TRUE/);
});
