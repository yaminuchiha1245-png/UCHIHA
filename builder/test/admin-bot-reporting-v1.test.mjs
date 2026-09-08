import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/admin-bot-reporting-v1.mjs", import.meta.url), "utf8");
const start = readFileSync(new URL("../src/start.mjs", import.meta.url), "utf8");


test("reporting intercepts overview before identity and store settings hooks", () => {
  assert.match(start, /installAdminBotReportingV1/);
  const reporting = start.indexOf("installAdminBotReportingV1(app");
  const identity = start.indexOf("installAdminBotIdentityV1(app");
  const storeSettings = start.indexOf("installAdminBotStoreSettingsV1(app");
  assert.ok(reporting > -1 && identity > reporting && storeSettings > identity);
  assert.match(source, /adm:overview/);
  assert.match(source, /app\.addHook\("preHandler"/);
});


test("reporting is owner-only private-chat-only and webhook authenticated", () => {
  assert.match(source, /x-telegram-bot-api-secret-token/);
  assert.match(source, /sha256\(secret\) !== connection\.webhook_secret_hash/);
  assert.match(source, /telegramOwnerId/);
  assert.match(source, /String\(chatId\) !== String\(ownerTelegramId\)/);
  assert.match(source, /incoming\.chat\.type !== "private"/);
});


test("overview reports paid sales windows and operational attention counts", () => {
  assert.match(source, /INTERVAL '24 hours'/);
  assert.match(source, /INTERVAL '7 days'/);
  assert.match(source, /INTERVAL '30 days'/);
  assert.match(source, /payment_status='paid'/);
  assert.match(source, /wallet_topup_proofs/);
  assert.match(source, /support_threads/);
  assert.match(source, /wallet_liability/);
  assert.match(source, /store_admin_notifications/);
});


test("overview labels sales as operational data rather than claiming accounting profit", () => {
  assert.match(source, /ليست صافي الربح المحاسبي/);
  assert.match(source, /أعلى المنتجات المدفوعة/);
  assert.match(source, /order_items/);
});
