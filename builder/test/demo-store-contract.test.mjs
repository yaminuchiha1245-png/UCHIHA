import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../public");

async function text(file) {
  return readFile(path.join(publicDir, file), "utf8");
}

test("demo storefront keeps the approved primary views and navigation contracts", async () => {
  const html = await text("demo-store.html");
  const script = await text("demo-store.js");
  const styles = await text("demo-store.css");

  for (const view of ["home", "wallet", "orders", "order-details"]) {
    assert.match(html, new RegExp(`data-view=["']${view}["']`));
    assert.match(script, new RegExp(`["']${view}["']`));
  }

  for (const requiredId of [
    "menuPanel",
    "cartPanel",
    "productPanel",
    "categoryGrid",
    "ordersList",
    "orderSearch",
    "backdrop",
    "toast"
  ]) {
    assert.match(html, new RegExp(`id=["']${requiredId}["']`));
  }

  assert.match(script, /function closePanel\(/);
  assert.match(script, /function setRoute\(/);
  assert.match(script, /function filterOrders\(/);
  assert.match(script, /popstate/);
  assert.doesNotMatch(script, /removeChild\([^)]*script/i);
  assert.doesNotMatch(script, /createElement\(["']script["']\)/i);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /body\.panel-open\{overflow:hidden\}/);
});

test("demo storefront original visual assets exist and are referenced", async () => {
  const html = await text("demo-store.html");
  const assets = [
    "demo-assets/uchiha-hero.svg",
    "demo-assets/uchiha-avatar.svg",
    "demo-assets/sharingan-wallet.svg"
  ];

  for (const asset of assets) {
    const source = await text(asset);
    assert.match(source, /<svg/);
    assert.match(html, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
