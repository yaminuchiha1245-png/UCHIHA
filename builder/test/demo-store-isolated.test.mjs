import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicUrl = new URL("../public/", import.meta.url);

async function source(name) {
  return readFile(new URL(name, publicUrl), "utf8");
}

test("demo route leaves the legacy storefront before app.js starts", async () => {
  const theme = await source("theme.js");
  const redirect = theme.indexOf("/assets/demo-store.html");
  const legacyShell = theme.indexOf("uchiha-store-static-first");
  assert.ok(redirect >= 0, "demo storefront redirect is missing");
  assert.ok(redirect < legacyShell, "demo redirect must run before the legacy storefront fallback");
  assert.match(theme, /isDemoHost\s*\|\|\s*isDemoPath/);
});

test("isolated demo storefront includes its own assets, primary views, and closable panels", async () => {
  const html = await source("demo-store.html");
  assert.match(html, /demo-store\.css/);
  assert.match(html, /demo-store\.js/);

  for (const view of ["home", "wallet", "orders", "order-details"]) {
    assert.match(html, new RegExp(`data-view=["']${view}["']`));
  }

  assert.match(html, /id="menuPanel"/);
  assert.match(html, /id="cartPanel"/);
  assert.match(html, /id="productPanel"/);
  assert.ok((html.match(/data-close/g) || []).length >= 3, "every overlay needs a close control");
  assert.doesNotMatch(html, /<dialog/i, "demo preview must not depend on dialog support");
});

test("isolated demo runtime owns routes, products, cart, orders, and recovery", async () => {
  const runtime = await source("demo-store.js");
  assert.match(runtime, /function openPanel/);
  assert.match(runtime, /function closePanel/);
  assert.match(runtime, /function setRoute/);
  assert.match(runtime, /function loadCatalog/);
  assert.match(runtime, /function loadProducts/);
  assert.match(runtime, /function renderCart/);
  assert.match(runtime, /function filterOrders/);
  assert.match(runtime, /elements\.backdrop\.addEventListener\("click", closePanel\)/);
  assert.match(runtime, /الدفع الحقيقي معطّل في المتجر التجريبي/);
  assert.doesNotMatch(runtime, /createElement\(["']script["']\)/i);
});
