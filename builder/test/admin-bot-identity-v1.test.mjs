import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/admin-bot-identity-v1.mjs", import.meta.url), "utf8");
const start = readFileSync(new URL("../src/start.mjs", import.meta.url), "utf8");


test("identity settings own the Telegram settings hub before Store Settings V1", () => {
  assert.match(start, /installAdminBotIdentityV1/);
  const identity = start.indexOf("installAdminBotIdentityV1(app");
  const storeSettings = start.indexOf("installAdminBotStoreSettingsV1(app");
  const fallback = start.indexOf("installAdvancedAdminBotWebhook(app");
  assert.ok(identity > -1 && storeSettings > identity && fallback > storeSettings);
});


test("identity settings are owner-only and authenticate the admin webhook", () => {
  assert.match(source, /purpose='admin' AND status='active'/);
  assert.match(source, /x-telegram-bot-api-secret-token/);
  assert.match(source, /sha256\(secret\) !== connection\.webhook_secret_hash/);
  assert.match(source, /telegramOwnerId/);
  assert.match(source, /String\(chatId\) !== String\(ownerTelegramId\)/);
  assert.match(source, /incoming\.chat\.type !== "private"/);
});


test("identity screen edits brand colors, media and font without overwriting the rest of the design", () => {
  assert.match(source, /primary_color/);
  assert.match(source, /secondary_color/);
  assert.match(source, /logo_url/);
  assert.match(source, /cover_url/);
  assert.match(source, /font_family/);
  assert.match(source, /validHex/);
  assert.match(source, /safeHttpsUrl/);
  assert.match(source, /Tajawal/);
  assert.match(source, /Noto Kufi Arabic/);
  assert.match(source, /store_identity\.changed_from_admin_bot/);
});


test("contact edits preserve the owner Telegram identity and audit only configuration state", () => {
  assert.match(source, /Telegram ID الخاص بمالك بوت الإدارة يبقى محفوظًا منفصلًا/);
  assert.match(source, /const after = \{ \.\.\.before \}/);
  assert.match(source, /store_contact\.changed_from_admin_bot/);
  assert.match(source, /configured: Boolean\(before\[field\]\)/);
  assert.match(source, /configured: Boolean\(value\)/);
});


test("currency management preserves the base currency and uses explicit rate confirmation", () => {
  assert.match(source, /store_currency_settings/);
  assert.match(source, /rate_to_base/);
  assert.match(source, /manual_telegram/);
  assert.match(source, /is_base=FALSE/);
  assert.match(source, /code === store\.currency/);
  assert.match(source, /id1_currency_confirm/);
  assert.match(source, /✅ حفظ وتفعيل/);
  assert.match(source, /لا يمكن إخفاء العملة الأساسية/);
  assert.match(source, /store_currency\.rate_changed_from_admin_bot/);
  assert.match(source, /store_currency\.visibility_changed_from_admin_bot/);
});


test("settings hub delegates existing support, banner and ticket actions instead of duplicating them", () => {
  assert.match(source, /adm5:welcome/);
  assert.match(source, /adm5:support/);
  assert.match(source, /adm5:banners/);
  assert.match(source, /adm5:threads/);
});
