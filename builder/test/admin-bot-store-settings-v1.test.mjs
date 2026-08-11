import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/admin-bot-store-settings-v1.mjs", import.meta.url), "utf8");
const start = readFileSync(new URL("../src/start.mjs", import.meta.url), "utf8");


test("store settings hook is installed before search, finance and the advanced webhook", () => {
  assert.match(start, /installAdminBotStoreSettingsV1/);
  const storeSettings = start.indexOf("installAdminBotStoreSettingsV1(app");
  const search = start.indexOf("installAdminBotSearchV1(app");
  const finance = start.indexOf("installAdminBotFinanceV2(app");
  const fallback = start.indexOf("installAdvancedAdminBotWebhook(app");
  assert.ok(storeSettings > -1 && search > storeSettings && finance > search && fallback > finance);
  assert.match(source, /app\.addHook\("preHandler"/);
  assert.match(source, /\/webhooks\/telegram-admin\//);
});


test("settings actions stay owner-only private-chat-only and webhook authenticated", () => {
  assert.match(source, /x-telegram-bot-api-secret-token/);
  assert.match(source, /sha256\(secret\) !== connection\.webhook_secret_hash/);
  assert.match(source, /telegramOwnerId/);
  assert.match(source, /String\(chatId\) !== String\(ownerTelegramId\)/);
  assert.match(source, /incoming\.chat\.type !== "private"/);
});


test("welcome support channels and banners are managed from Telegram", () => {
  assert.match(source, /adm:settings/);
  assert.match(source, /set1_welcome/);
  assert.match(source, /store\.welcome_changed_from_admin_bot/);
  assert.match(source, /store_support_channels/);
  assert.match(source, /support_channel\.created_from_admin_bot/);
  assert.match(source, /support_channel\.visibility_changed_from_admin_bot/);
  assert.match(source, /store_banners/);
  assert.match(source, /set1_banner_media/);
  assert.match(source, /safeHttpsUrl/);
  assert.match(source, /banner\.created_from_admin_bot/);
  assert.match(source, /banner\.visibility_changed_from_admin_bot/);
});


test("support tickets can be read replied to and resolved without leaving the store scope", () => {
  assert.match(source, /support_threads/);
  assert.match(source, /support_messages/);
  assert.match(source, /author_type, author_user_id, message/);
  assert.match(source, /'staff'/);
  assert.match(source, /status='waiting_customer'/);
  assert.match(source, /status='resolved'/);
  assert.match(source, /support_thread\.replied_from_admin_bot/);
  assert.match(source, /support_thread\.resolved_from_admin_bot/);
  assert.match(source, /tenant_id=\$2 AND store_id=\$3/);
});


test("banner links reject insecure external URLs", () => {
  assert.match(source, /url\.protocol !== "https:"/);
  assert.match(source, /url\.username \|\| url\.password/);
  assert.match(source, /allowRelative/);
});
