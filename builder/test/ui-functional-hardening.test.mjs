import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("preview shell loads the functional hardening helper with the current release", async () => {
  const preview = await read("public/preview-banner.js");
  assert.match(preview, /functional-hardening\.js\?v=\$\{RELEASE_VERSION\}/);
  assert.match(preview, /data-functional-hardening/);
  assert.match(preview, /installFunctionalHardening\(\)/);
  assert.match(preview, /launch-builder-sales\.js/);
});

test("login and account paths select the login tab instead of registration", async () => {
  const hardening = await read("public/functional-hardening.js");
  assert.match(hardening, /\["\/login", "\/account"\]\.includes\(window\.location\.pathname\)/);
  assert.match(hardening, /loginTab\.classList\.add\("active"\)/);
  assert.match(hardening, /registerForm\.hidden = true/);
  assert.match(hardening, /loginForm\.hidden = false/);
  assert.match(hardening, /#authStep/);
});

test("builder authentication gets accessible password visibility controls at runtime", async () => {
  const hardening = await read("public/functional-hardening.js");
  assert.match(hardening, /input\[type="password"\]:not\(\[data-password-enhanced\]\)/);
  assert.match(hardening, /button\.setAttribute\("aria-controls", input\.id\)/);
  assert.match(hardening, /button\.setAttribute\("aria-pressed", String\(reveal\)\)/);
  assert.match(hardening, /input\.type = reveal \? "text" : "password"/);
  assert.match(hardening, /\.password-control/);
  assert.match(hardening, /\.password-toggle/);
});

test("critical create and checkout forms reject duplicate taps and stabilize idempotency", async () => {
  const hardening = await read("public/functional-hardening.js");
  assert.match(hardening, /protectedFormIds = new Set\(\["registerForm", "loginForm", "storeForm", "orderForm"\]\)/);
  assert.match(hardening, /form\.dataset\.submitting === "true"/);
  assert.match(hardening, /event\.stopImmediatePropagation\(\)/);
  assert.match(hardening, /form\.dataset\.requestKey \|\|= crypto\.randomUUID\(\)/);
  assert.match(hardening, /headers\.set\("idempotency-key"/);
  assert.match(hardening, /response\.status >= 400 && response\.status < 500/);
});

test("technical values stay LTR without changing the surrounding RTL interface", async () => {
  const hardening = await read("public/functional-hardening.js");
  assert.match(hardening, /input\[type="email"\],input\[type="tel"\],input\[type="url"\]/);
  assert.match(hardening, /input\.dir = "ltr"/);
  assert.match(hardening, /unicode-bidi:plaintext/);
  assert.match(hardening, /overflow-wrap:anywhere/);
  assert.match(hardening, /\.form-grid>\*/);
});

test("PWA, launch shell and HTTP release markers are explicit and cache-safe", async () => {
  const expected = new Map([
    ["public/sw.js", /2026\.08\.02\.2/],
    ["public/pwa.js", /2026\.08\.02\.2/],
    ["public/preview-banner.js", /2026\.08\.03\.1/],
    ["public/functional-hardening.js", /2026\.08\.02\.2/],
    ["src/http-hardening.mjs", /2026\.08\.02\.2/],
    ["src/smoke.mjs", /2026\.08\.02\.2/]
  ]);
  const paths = [...expected.keys()];
  const sources = await Promise.all(paths.map(read));
  for (const [index, source] of sources.entries()) {
    assert.match(source, expected.get(paths[index]), paths[index]);
    assert.doesNotMatch(source, /2026\.08\.02\.1/, paths[index]);
  }
  assert.match(sources[0], /functional-hardening\.js/);
  assert.match(sources[0], /keys\.filter\(\(key\) => key !== CACHE_NAME && key\.startsWith\("uchiha-"\)\)/);
  assert.match(sources[0], /cache: "no-store"/);
});
