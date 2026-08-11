import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/admin-bot-catalog-v3.mjs", import.meta.url), "utf8");
const start = readFileSync(new URL("../src/start.mjs", import.meta.url), "utf8");


test("catalog V3 is installed before operations and advanced fallback", () => {
  assert.match(start, /installAdminBotCatalogV3/);
  const catalog = start.indexOf("installAdminBotCatalogV3(app");
  const operations = start.indexOf("installAdminBotOperationsV2(app");
  const fallback = start.indexOf("installAdvancedAdminBotWebhook(app");
  assert.ok(catalog > -1 && operations > catalog && fallback > operations);
});


test("catalog V3 is owner-only and authenticates Telegram webhook updates", () => {
  assert.match(source, /purpose='admin'/);
  assert.match(source, /x-telegram-bot-api-secret-token/);
  assert.match(source, /sha256\(secret\) !== connection\.webhook_secret_hash/);
  assert.match(source, /telegramOwnerId/);
  assert.match(source, /String\(chatId\) !== String\(ownerTelegramId\)/);
  assert.match(source, /incoming\.chat\.type !== "private"/);
});


test("catalog V3 creates local products with durable replay protection", () => {
  assert.match(source, /telegram\.product\.create/);
  assert.match(source, /admin_idempotency_records/);
  assert.match(source, /ON CONFLICT \(store_id, actor_user_id, scope, idempotency_key\) DO NOTHING/);
  assert.match(source, /INSERT INTO products/);
  assert.match(source, /'local'/);
  assert.match(source, /INSERT INTO product_input_analyses/);
  assert.match(source, /analyzeProductInputSchema/);
  assert.match(source, /INSERT INTO outbox_events/);
  assert.match(source, /product\.created_from_admin_bot/);
  assert.match(source, /لم يُنشأ المنتج مرتين/);
  assert.doesNotMatch(source, /create:type:api_service/);
});


test("catalog V3 provides mobile product management without duplicating existing safe operations", () => {
  assert.match(source, /➕ إضافة منتج/);
  assert.match(source, /🔎 بحث/);
  assert.match(source, /cat3_search/);
  assert.match(source, /cat3_description_edit/);
  assert.match(source, /cat3_image_edit/);
  assert.match(source, /safeHttpsUrl/);
  assert.match(source, /adm3:product:name:/);
  assert.match(source, /adm3:product:stock:/);
  assert.match(source, /adm3:product:category:/);
  assert.match(source, /adm3:product:toggle:/);
  assert.match(source, /adm:product:price:/);
});
