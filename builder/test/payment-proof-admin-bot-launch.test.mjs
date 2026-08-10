import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("proof-first wallet schema keeps legacy deposits intact", async () => {
  const migration = await source("migrations/034_wallet_proof_admin_bot.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS wallet_topup_proofs/);
  assert.match(migration, /reference_text TEXT/);
  assert.match(migration, /proof_data TEXT/);
  assert.match(migration, /customer_visible BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /method_type IN \('sham_cash', 'binance_pay', 'usdt_trc20'\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS admin_bot_sessions/);
  assert.doesNotMatch(migration, /DROP TABLE\s+deposit_requests/i);
});

test("account proof UI removes amount dependency and exposes two independent proof paths", async () => {
  const js = await source("public/account-payment-proof-v3.js");
  const css = await source("public/account-payment-proof-v3.css");
  assert.match(js, /إرسال رقم العملية أو الإيصال/);
  assert.match(js, /إرسال صورة الإيصال/);
  assert.match(js, /wallet-proofs/);
  assert.match(js, /payment-proof-methods/);
  assert.doesNotMatch(js, /amountMinor\s*:/);
  assert.match(css, /#depositAmount/);
  assert.match(css, /#submitDeposit/);
});

test("service products become direct-purchase only without deleting cart support globally", async () => {
  const js = await source("public/store-direct-buy-v7.js");
  assert.match(js, /directOnly = \/خدمة\//);
  assert.match(js, /cartButton\.hidden = directOnly/);
  assert.match(js, /شراء الآن/);
  assert.match(js, /form\.dataset\.mode === "cart"/);
});

test("wallet proof routes are installed by the production start entry", async () => {
  const start = await source("src/start.mjs");
  const module = await source("src/wallet-proof-admin.mjs");
  assert.match(start, /installWalletProofAdmin/);
  assert.match(start, /installWalletProofAdmin\(app, \{ db, config \}\)/);
  assert.match(module, /\/api\/public\/stores\/:slug\/wallet-proofs/);
  assert.match(module, /reviewWalletTopupProof/);
  assert.match(module, /wallet_ledger/);
});

test("store admin bot is owner locked and manages proofs products and payment methods", async () => {
  const telegram = await source("src/telegram.mjs");
  assert.match(telegram, /telegramOwnerId/);
  assert.match(telegram, /هذا البوت مخصص لمالك المتجر فقط/);
  assert.match(telegram, /adm:proofs/);
  assert.match(telegram, /adm:products/);
  assert.match(telegram, /adm:payments/);
  assert.match(telegram, /adm:notifications/);
  assert.match(telegram, /proof_credit/);
  assert.match(telegram, /product_price/);
  assert.match(telegram, /payment_method_destination/);
  assert.match(telegram, /reviewWalletTopupProof/);
});
