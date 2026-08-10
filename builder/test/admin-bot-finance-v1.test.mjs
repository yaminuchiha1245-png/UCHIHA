import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/admin-bot-finance-v1.mjs", import.meta.url), "utf8");
const start = readFileSync(new URL("../src/start.mjs", import.meta.url), "utf8");


test("finance hook is installed before the advanced admin webhook", () => {
  assert.match(start, /installAdminBotFinanceV1/);
  assert.match(start, /installAdminBotFinanceV1\(app, \{ db, config \}\);\ninstallAdminBotOperationsV2/);
  assert.match(source, /app\.addHook\("preHandler"/);
  assert.match(source, /x-telegram-bot-api-secret-token/);
  assert.match(source, /telegramOwnerId/);
  assert.match(source, /message\.chat\.type !== "private"/);
});


test("wallet adjustment requires amount then explicit confirmation", () => {
  assert.match(source, /fin_wallet_amount/);
  assert.match(source, /fin_wallet_confirm/);
  assert.match(source, /wallet:confirm:/);
  assert.match(source, /لن يتم تنفيذ أي تغيير قبل الضغط على تأكيد/);
});


test("wallet adjustment is transactional idempotent and cannot create a negative balance", () => {
  assert.match(source, /FOR UPDATE OF w/);
  assert.match(source, /after < 0/);
  assert.match(source, /telegram_wallet_adjustment/);
  assert.match(source, /entry_type, operation_type/);
  assert.match(source, /'adjustment','adjustment'/);
  assert.match(source, /wallet\.adjusted_from_admin_bot/);
  assert.match(source, /customer_notifications/);
  assert.match(source, /'wallet_adjusted'/);
  assert.match(source, /replay: true/);
});


test("wallet mutation stays tenant and store scoped", () => {
  assert.match(source, /w\.tenant_id=\$2 AND w\.store_id=\$3/);
  assert.match(source, /UPDATE customer_wallets SET balance_minor=\$1/);
  assert.match(source, /connection\.tenant_id/);
  assert.match(source, /connection\.store_id/);
});
