import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(relative) {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("launch asset layer serves catalog-facing routes through the UCHIHA Builder shell", async () => {
  const source = await text("../src/launch-assets.mjs");
  for (const path of ["/services", "/payment-methods", "/orders", "/about"]) {
    assert.equal(source.includes(`"${path}"`), true, `${path} must be included in the Builder launch routing layer`);
  }
  assert.equal(source.includes("const PUBLIC_DOCUMENT_PATHS = new Set"), true);
  assert.equal(source.includes("PUBLIC_DOCUMENT_PATHS.has(pathname)"), true);
  assert.equal(source.includes("/^\\/category\\/[^/]+"), true);
  assert.equal(source.includes("/^\\/product\\/[^/]+"), true);
  assert.equal(source.includes("documentResponse(reply, PUBLIC_DOCUMENT)"), true);
  assert.equal(source.includes("platform-v5.html"), true);
  assert.equal(source.includes("V41_UNIFIED_PATHS"), false);
  assert.equal(source.includes("productionV41Document"), false);
  assert.equal(source.includes("v41-production-bridge"), false);
});

test("Builder runtime hydrates portal, account and orders from production APIs", async () => {
  const source = await text("../public/platform-v5.js");
  assert.match(source, /requestJson\("\/api\/public\/portal"\)/);
  assert.match(source, /requestJson\("\/api\/me"\)/);
  assert.match(source, /requestJson\("\/api\/platform\/account"\)/);
  assert.match(source, /requestJson\("\/api\/platform\/orders"\)/);
  assert.match(source, /state\.portal = portal/);
  assert.match(source, /state\.products = catalogProducts\(portal\)/);
  assert.match(source, /state\.paymentMethods = availablePaymentMethods\(portal\)/);
  assert.match(source, /state\.contacts = activeContacts\(portal\)/);
  assert.match(source, /credentials: "same-origin"/);
});

test("Builder keeps a safe home-slide fallback while portal data remains the production source", async () => {
  const source = await text("../public/platform-v5.js");
  assert.match(source, /const HOME_SLIDES = Object\.freeze\(\[/);
  assert.match(source, /function homeHero\(\)/);
  assert.match(source, /state\.portal = portal/);
  assert.doesNotMatch(source, /v41-production-bridge/);
  assert.doesNotMatch(source, /SYNC_INTERVAL_MS = 60000/);
});
