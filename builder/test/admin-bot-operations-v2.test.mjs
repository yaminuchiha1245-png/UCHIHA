import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/admin-bot-operations-v2.mjs", import.meta.url), "utf8");
const start = readFileSync(new URL("../src/start.mjs", import.meta.url), "utf8");


test("expanded admin operations are installed before the advanced webhook route", () => {
  assert.match(start, /installAdminBotOperationsV2/);
  assert.match(start, /installAdminBotOperationsV2\(app, \{ db, config \}\);\ninstallAdvancedAdminBotWebhook/);
  assert.match(source, /app\.addHook\("preHandler"/);
  assert.match(source, /\/webhooks\/telegram-admin\//);
  assert.match(source, /x-telegram-bot-api-secret-token/);
  assert.match(source, /telegramOwnerId/);
  assert.match(source, /message\.chat\.type !== "private"/);
});


test("categories can be created from Telegram without bypassing tenant scope", () => {
  assert.match(source, /category:add-root/);
  assert.match(source, /category:add-child/);
  assert.match(source, /ops_category_name/);
  assert.match(source, /INSERT INTO categories/);
  assert.match(source, /category\.created_from_admin_bot/);
  assert.match(source, /uniqueCategorySlug/);
});


test("product management supports name stock category and visibility", () => {
  assert.match(source, /product:name:/);
  assert.match(source, /product:stock:/);
  assert.match(source, /product:category:/);
  assert.match(source, /product:toggle:/);
  assert.match(source, /product\.renamed_from_admin_bot/);
  assert.match(source, /product\.stock_changed_from_admin_bot/);
  assert.match(source, /product\.category_changed_from_admin_bot/);
  assert.match(source, /product\.visibility_changed_from_admin_bot/);
  assert.match(source, /غير محدود/);
});


test("order actions are intentionally limited to safe manual transitions", () => {
  assert.match(source, /EXISTS\(SELECT 1 FROM provider_orders po WHERE po\.order_id=o\.id\) AS provider_linked/);
  assert.match(source, /provider_order_managed/);
  assert.match(source, /unsafe_order_transition/);
  assert.match(source, /targetStatus === "processing" && row\.status === "paid" && row\.payment_status === "paid"/);
  assert.match(source, /targetStatus === "completed" && row\.status === "processing" && row\.payment_status === "paid"/);
  assert.match(source, /targetStatus === "cancelled".*\["new", "awaiting_payment"\]/s);
  assert.match(source, /order\.status_changed_from_admin_bot/);
});
