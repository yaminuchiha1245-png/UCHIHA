import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/admin-bot-advanced-webhook.mjs", import.meta.url), "utf8");


test("advanced admin bot owns the standalone webhook and preserves secret validation", () => {
  assert.match(source, /\/webhooks\/telegram-admin\/:connectionId/);
  assert.match(source, /purpose='admin'/);
  assert.match(source, /x-telegram-bot-api-secret-token/);
  assert.match(source, /sha256\(providedSecret\)/);
  assert.match(source, /decryptSecret\(connection\.token_ciphertext/);
  assert.match(source, /handleTelegramUpdate/);
});


test("advanced admin bot manages customers safely", () => {
  assert.match(source, /adm2:customer:/);
  assert.match(source, /customer\.blocked_from_admin_bot/);
  assert.match(source, /customer\.unblocked_from_admin_bot/);
  assert.match(source, /UPDATE customer_sessions SET revoked_at=COALESCE\(revoked_at,NOW\(\)\)/);
  assert.match(source, /status === "active" \? "blocked" : "active"/);
});


test("advanced admin bot manages categories and payment method configuration", () => {
  assert.match(source, /adm2:category:/);
  assert.match(source, /category\.visibility_changed_from_admin_bot/);
  assert.match(source, /category\.renamed_from_admin_bot/);
  assert.match(source, /adm2:payment:/);
  assert.match(source, /payment_method\.destination_changed_from_admin_bot/);
  assert.match(source, /payment_method\.renamed_from_admin_bot/);
  assert.match(source, /payment_method\.visibility_changed_from_admin_bot/);
  assert.match(source, /advanced_payment_destination/);
});


test("advanced admin bot remains owner-only and private-chat-only", () => {
  assert.match(source, /telegramOwnerId/);
  assert.match(source, /String\(ownerId\) !== String\(chatId\)/);
  assert.match(source, /message\.chat\.type !== "private"/);
});
