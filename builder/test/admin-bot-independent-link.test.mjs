import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const adminBotApi = readFileSync(new URL("../src/admin-bot-connection.mjs", import.meta.url), "utf8");
const start = readFileSync(new URL("../src/start.mjs", import.meta.url), "utf8");
const launchAssets = readFileSync(new URL("../src/launch-assets.mjs", import.meta.url), "utf8");
const ui = readFileSync(new URL("../public/admin-bot-link-v1.js", import.meta.url), "utf8");


test("admin bot can be connected without requiring storefront bot", () => {
  assert.match(adminBotApi, /\/api\/stores\/:storeId\/admin-bot/);
  assert.match(adminBotApi, /gateway\.validateToken\(adminToken, "admin"\)/);
  assert.match(adminBotApi, /gateway\.setWebhook\(adminToken, connectionId, webhookSecret\)/);
  assert.match(adminBotApi, /purpose='admin'/);
  assert.doesNotMatch(adminBotApi, /storefrontToken/);
  assert.match(adminBotApi, /telegramOwnerId/);
  assert.match(adminBotApi, /owner_required/);
});


test("runtime installs standalone admin bot API", () => {
  assert.match(start, /installAdminBotConnectionRoutes/);
  assert.match(start, /installAdminBotConnectionRoutes\(app, \{ db, config \}\)/);
});


test("store dashboard receives standalone admin bot UI", () => {
  assert.match(launchAssets, /admin-bot-link-v1\.js/);
  assert.match(launchAssets, /admin-bot-link-v1\.css/);
  assert.match(launchAssets, /\^\\\/admin\\\/\[\^\/\]\+\$/);
  assert.match(ui, /لا تحتاج إلى إنشاء بوت المتجر الآن/);
  assert.match(ui, /اختبار وربط بوت الإدارة/);
  assert.match(ui, /\/admin/);
  assert.match(ui, /x-csrf-token/);
});
