import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/admin-bot-search-v1.mjs", import.meta.url), "utf8");
const start = readFileSync(new URL("../src/start.mjs", import.meta.url), "utf8");


test("search layer is installed before finance, operations and advanced fallback", () => {
  assert.match(start, /installAdminBotSearchV1/);
  const search = start.indexOf("installAdminBotSearchV1(app");
  const finance = start.indexOf("installAdminBotFinanceV2(app");
  const operations = start.indexOf("installAdminBotOperationsV2(app");
  const fallback = start.indexOf("installAdvancedAdminBotWebhook(app");
  assert.ok(search > -1 && finance > search && operations > finance && fallback > operations);
});


test("search layer is owner-only and authenticates Telegram webhook updates", () => {
  assert.match(source, /purpose='admin' AND status='active'/);
  assert.match(source, /x-telegram-bot-api-secret-token/);
  assert.match(source, /sha256\(secret\) !== connection\.webhook_secret_hash/);
  assert.match(source, /telegramOwnerId/);
  assert.match(source, /String\(chatId\) !== String\(ownerTelegramId\)/);
  assert.match(source, /incoming\.chat\.type !== "private"/);
});


test("orders can be searched and filtered without duplicating order mutations", () => {
  assert.match(source, /search1_orders/);
  assert.match(source, /LOWER\(o\.order_number\)/);
  assert.match(source, /LOWER\(COALESCE\(o\.customer_name,''\)\)/);
  assert.match(source, /attention/);
  assert.match(source, /processing/);
  assert.match(source, /completed/);
  assert.match(source, /payment_status='paid'/);
  assert.match(source, /adm:order:/);
  assert.doesNotMatch(source, /UPDATE orders/);
});


test("customers can be searched by name, email or phone and delegate to Finance V2 detail", () => {
  assert.match(source, /search1_customers/);
  assert.match(source, /LOWER\(c\.display_name\)/);
  assert.match(source, /LOWER\(c\.email\)/);
  assert.match(source, /LOWER\(COALESCE\(c\.phone,''\)\)/);
  assert.match(source, /adm4:customer:/);
  assert.doesNotMatch(source, /UPDATE store_customers/);
  assert.doesNotMatch(source, /UPDATE customer_wallets/);
});
