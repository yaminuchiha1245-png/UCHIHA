import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicUrl = new URL("../public/", import.meta.url);

async function source(name) {
  return readFile(new URL(name, publicUrl), "utf8");
}

test("demo route stays on the real PostgreSQL storefront runtime", async () => {
  const theme = await source("theme.js");
  assert.doesNotMatch(theme, /\/assets\/demo-store\.html/);
  assert.doesNotMatch(theme, /uchiha-store-static-first/);
  assert.doesNotMatch(theme, /Nova Digital/);
  assert.match(theme, /store-reference\.css/);
  assert.match(theme, /store-reference\.js/);
  assert.match(theme, /admin-reference\.css/);
  assert.match(theme, /admin-reference\.js/);
  assert.match(theme, /phase:\s*"reference-runtime"/);
});

test("isolated demo storefront remains as a non-routed visual fixture", async () => {
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
  assert.doesNotMatch(html, /<dialog/i, "the fixture must not depend on dialog support");
});

test("isolated demo fixture owns routes, products, cart, orders, and recovery", async () => {
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
