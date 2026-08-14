import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const backendUrl = new URL("../src/launch-subscription-admin.mjs", import.meta.url);
const uiUrl = new URL("../public/launch-admin-sales.js", import.meta.url);

test("platform subscription offer editor has protected read/write backend routes", async () => {
  const source = await readFile(backendUrl, "utf8");
  assert.match(source, /app\.get\("\/api\/subscription-offer"/);
  assert.match(source, /app\.put\("\/api\/platform\/subscription-offer"/);
  assert.match(source, /requireLaunchAdmin\(user\)/);
  assert.match(source, /requireLaunchCsrf\(request, user\)/);
  assert.match(source, /platform\.subscription_offer_updated/);
  assert.match(source, /\^\[A-Z0-9\]\{2,12\}\$/);
  assert.match(source, /saleEnabled && priceMinor <= 0/);
  assert.match(source, /renewalEnabled && renewalPriceMinor <= 0/);
});

test("offer update preserves hidden trial and discount values unless explicitly supplied", async () => {
  const source = await readFile(backendUrl, "utf8");
  assert.match(source, /body\.trialDays === undefined[\s\S]*current\?\.trial_days/);
  assert.match(source, /body\.discountPercent === undefined[\s\S]*current\?\.discount_percent/);
});

test("mobile admin pricing UI supports crypto-style currency codes and real backend", async () => {
  const source = await readFile(uiUrl, "utf8");
  assert.match(source, /api\("\/api\/subscription-offer"\)/);
  assert.match(source, /api\("\/api\/platform\/subscription-offer"/);
  assert.match(source, /maxlength="12" pattern="\[A-Za-z0-9\]\{2,12\}"/);
  assert.match(source, /step="any"/);
  assert.doesNotMatch(source, /trialDays:\s*0/);
  assert.doesNotMatch(source, /discountPercent:\s*0/);
  assert.match(source, /saleEnabled:\s*form\.elements\.saleEnabled\.checked/);
  assert.match(source, /renewalEnabled:\s*form\.elements\.renewalEnabled\.checked/);
});
