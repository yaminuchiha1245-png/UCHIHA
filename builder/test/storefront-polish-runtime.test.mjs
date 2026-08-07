import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("storefront runtime polish keeps search, images, loading feedback, mobile commerce, and checkout resilient", async () => {
  const [runtime, css, commerce, checkout, theme, worker] = await Promise.all([
    read("public/store-polish-v2.js"),
    read("public/store-polish-v2-runtime.css"),
    read("public/store-commerce-v3.css"),
    read("public/store-checkout-v4.css"),
    read("public/theme.js"),
    read("public/sw.js")
  ]);

  assert.match(runtime, /const RELEASE = "2026\.08\.07\.8"/);
  assert.match(runtime, /store-search-clear/);
  assert.match(runtime, /classList\.toggle\("has-search-value", hasValue\)/);
  assert.match(runtime, /dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\)/);
  assert.match(runtime, /document\.addEventListener\("error", handleImageFailure, true\)/);
  assert.match(runtime, /dataset\.storeFallback/);
  assert.match(runtime, /MutationObserver/);
  assert.match(runtime, /aria-busy/);
  assert.match(runtime, /aria-live/);
  assert.match(css, /\.store-main-search\.has-search-value input/);
  assert.doesNotMatch(css, /:has\(/);
  assert.match(css, /#storeNotificationsLink/);
  assert.match(commerce, /\.product-actions\s*\{[\s\S]*grid-template-columns:\s*44px minmax\(0, 1fr\)/);
  assert.match(commerce, /\.store-add-cart::before/);
  assert.match(commerce, /min-height:\s*44px/);
  assert.match(commerce, /\.product-body h3\s*\{[\s\S]*font-size:\s*12\.5px/);
  assert.match(commerce, /\.product-body > p\s*\{[\s\S]*font-size:\s*10\.75px/);
  assert.match(commerce, /\.store-mobile-nav a,[\s\S]*font-size:\s*9\.5px/);
  assert.match(checkout, /\.order-dialog\[open\]/);
  assert.match(checkout, /\.order-product-image/);
  assert.match(checkout, /#orderDynamicFields/);
  assert.match(checkout, /position:\s*sticky/);
  assert.match(checkout, /#checkoutStoreCart/);
  assert.match(checkout, /env\(safe-area-inset-bottom/);
  assert.match(theme, /store-commerce-v3\.css/);
  assert.match(theme, /store-checkout-v4\.css/);
  assert.match(theme, /monochrome-v1\.css/);
  assert.match(theme, /2026\.08\.07\.15/);
  assert.match(worker, /store-commerce-v3\.css/);
  assert.match(worker, /store-checkout-v4\.css/);
  assert.match(worker, /monochrome-v1\.css/);
  assert.match(worker, /2026\.08\.07\.15/);
});
