import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("storefront runtime polish keeps search, images, and loading feedback resilient", async () => {
  const [runtime, css, theme, worker] = await Promise.all([
    read("public/store-polish-v2.js"),
    read("public/store-polish-v2-runtime.css"),
    read("public/theme.js"),
    read("public/sw.js")
  ]);

  assert.match(runtime, /const RELEASE = "2026\.08\.07\.7"/);
  assert.match(runtime, /store-search-clear/);
  assert.match(runtime, /dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\)/);
  assert.match(runtime, /document\.addEventListener\("error", handleImageFailure, true\)/);
  assert.match(runtime, /dataset\.storeFallback/);
  assert.match(runtime, /MutationObserver/);
  assert.match(runtime, /aria-busy/);
  assert.match(runtime, /aria-live/);
  assert.match(css, /#storeNotificationsLink/);
  assert.match(css, /display:\s*grid/);
  assert.match(theme, /store-polish-v2-runtime\.css/);
  assert.match(theme, /store-polish-v2\.js/);
  assert.match(worker, /store-polish-v2-runtime\.css/);
  assert.match(worker, /store-polish-v2\.js/);
});