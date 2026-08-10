import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/admin-bot-finance-v2.mjs", import.meta.url), "utf8");
const start = readFileSync(new URL("../src/start.mjs", import.meta.url), "utf8");


test("hardened finance hook is installed before expanded admin operations", () => {
  assert.match(start, /installAdminBotFinanceV2/);
  assert.match(start, /installAdminBotFinanceV2\(app, \{ db, config \}\);\ninstallAdminBotOperationsV2/);
  assert.match(source, /app\.addHook\("preHandler"/);
  assert.match(source, /x-telegram-bot-api-secret-token/);
  assert.match(source, /telegramOwnerId/);
  assert.match(source, /message\.chat\.type !== "private"/);
});


test("wallet adjustment requires amount and explicit confirmation", () => {
  assert.match(source, /fin2_amount/);
  assert.match(source, /fin2_confirm/);
  assert.match(source, /wallet:confirm:/);
  assert.match(source, /لن يتغير الرصيد قبل الضغط على تأكيد العملية/);
});


test("wallet lock happens before replay check and uses the schema operation taxonomy", () => {
  const lockIndex = source.indexOf("FOR UPDATE OF w");
  const replayIndex = source.indexOf("reference_type='telegram_wallet_adjustment'");
  assert.ok(lockIndex >= 0 && replayIndex > lockIndex);
  assert.match(source, /'adjustment','admin_adjustment'/);
  assert.doesNotMatch(source, /'adjustment','adjustment'/);
});


test("confirmed wallet mutation cannot create a negative balance and is fully recorded", () => {
  assert.match(source, /after < 0/);
  assert.match(source, /UPDATE customer_wallets SET balance_minor=\$1/);
  assert.match(source, /INSERT INTO wallet_ledger/);
  assert.match(source, /'wallet_adjusted'/);
  assert.match(source, /wallet\.adjusted_from_admin_bot/);
  assert.match(source, /replay: true/);
});


test("finance reads and writes remain tenant and store scoped", () => {
  assert.match(source, /w\.tenant_id=\$2 AND w\.store_id=\$3/);
  assert.match(source, /connection\.tenant_id/);
  assert.match(source, /connection\.store_id/);
});
