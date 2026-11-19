import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("proof-first wallet schema keeps legacy deposits intact and splits PostgreSQL RLS", async () => {
  const migration = await source("migrations/034_wallet_proof_admin_bot.sql");
  const rls = await source("migrations/035_wallet_proof_admin_bot_rls.sql");
  const db = await source("src/db.mjs");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS wallet_topup_proofs/);
  assert.match(migration, /reference_text TEXT/);
  assert.match(migration, /proof_data TEXT/);
  assert.match(migration, /customer_visible BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /method_type IN \('sham_cash', 'binance_pay', 'usdt_trc20'\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS admin_bot_sessions/);
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /DROP TABLE\s+deposit_requests/i);
  assert.match(rls, /ALTER TABLE wallet_topup_proofs ENABLE ROW LEVEL SECURITY/);
  assert.match(rls, /CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_topup_proof_reference/);
  assert.match(rls, /CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_topup_proof_image/);
  assert.match(rls, /trg_demo_wallet_topup_proofs_read_only/);
  assert.match(rls, /uchiha_block_demo_financial_writes/);
  assert.match(rls, /CREATE POLICY wallet_topup_proofs_tenant_isolation/);
  assert.match(rls, /CREATE POLICY admin_bot_sessions_tenant_isolation/);
  assert.match(db, /version: "034_wallet_proof_admin_bot"[\s\S]{0,180}postgresOnly: false/);
  assert.match(db, /version: "035_wallet_proof_admin_bot_rls"[\s\S]{0,180}postgresOnly: true/);
});

test("account proof UI removes amount dependency and exposes two independent proof paths", async () => {
  const js = await source("public/account-payment-proof-v3.js");
  const css = await source("public/account-payment-proof-v3.css");
  const shell = await source("public/customer-shell-v1.js");
  assert.match(js, /إرسال رقم العملية أو الإيصال/);
  assert.match(js, /إرسال صورة الإيصال/);
  assert.match(js, /wallet-proofs/);
  assert.match(js, /payment-proof-methods/);
  assert.match(js, /paymentQrUrl/);
  assert.match(js, /عرض QR/);
  assert.match(js, /function hideElement/);
  assert.match(js, /if \(node && !node\.hidden\) node\.hidden = true/);
  assert.doesNotMatch(js, /amountMinor\s*:/);
  assert.match(css, /#depositAmount/);
  assert.match(css, /#submitDeposit/);
  assert.match(shell, /x-customer-csrf-token/);
  assert.match(shell, /uchiha:customer-csrf:/);
});

test("primary payment launch cards stay visible without exposing unconfigured destinations", async () => {
  const placeholders = await source("public/account-payment-method-placeholders-v3.js");
  const placeholderCss = await source("public/account-payment-method-placeholders-v3.css");
  const shell = await source("public/customer-shell-v1.js");
  assert.match(placeholders, /sham_cash/);
  assert.match(placeholders, /binance_pay/);
  assert.match(placeholders, /usdt_trc20/);
  assert.match(placeholders, /قيد الإعداد/);
  assert.match(placeholders, /button\.disabled = true/);
  assert.match(placeholders, /const existing = new Map/);
  assert.match(placeholderCss, /payment-proof-method-card-placeholder/);
  assert.match(shell, /account-payment-method-placeholders-v3\.js/);
});

test("payment history includes no-amount proof requests beside legacy deposits", async () => {
  const history = await source("public/account-proof-history-v3.js");
  assert.match(history, /إثباتات التحويل المباشرة/);
  assert.match(history, /\/wallet-proofs/);
  assert.match(history, /proof\.creditedAmountMinor/);
  assert.match(history, /صورة إيصال/);
  assert.match(history, /رقم عملية/);
});

test("service products become direct-purchase only without deleting cart support globally", async () => {
  const js = await source("public/store-direct-buy-v7.js");
  const css = await source("public/store-direct-buy-v7.css");
  const shell = await source("public/customer-shell-v1.js");
  assert.match(js, /directOnly = \/خدمة\//);
  assert.match(js, /cartButton\.hidden = directOnly/);
  assert.match(js, /شراء الآن/);
  assert.match(js, /form\.dataset\.mode === "cart"/);
  assert.match(css, /direct-purchase-only/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(shell, /store-direct-buy-v7\.css/);
});

test("wallet proof routes, QR route, replay guard and proactive admin alert are installed", async () => {
  const start = await source("src/start.mjs");
  const module = await source("src/wallet-proof-admin.mjs");
  const guard = await source("src/wallet-proof-submission-guard.mjs");
  const qr = await source("src/payment-proof-qr.mjs");
  const notifier = await source("src/store-admin-notify.mjs");
  assert.match(start, /installWalletProofSubmissionGuard/);
  assert.match(start, /installWalletProofSubmissionGuard\(app, \{ db, config \}\)/);
  assert.match(start, /installWalletProofAdmin/);
  assert.match(start, /installWalletProofAdmin\(app, \{ db, config \}\)/);
  assert.match(start, /installPaymentProofQr\(app, \{ db, config \}\)/);
  assert.doesNotMatch(start, /ensureWalletProofSchema/);
  assert.match(module, /\/api\/public\/stores\/:slug\/wallet-proofs/);
  assert.match(module, /reviewWalletTopupProof/);
  assert.match(module, /wallet_ledger/);
  assert.match(module, /pushWalletProofToAdminBot/);
  assert.match(module, /walletCurrency = customer\.wallet_currency/);
  assert.match(module, /s\.status IN \('active','ready'\) AND t\.status='active'/);
  assert.match(guard, /payment_destination_not_configured/);
  assert.match(guard, /proof_already_submitted/);
  assert.match(guard, /proof_sha256/);
  assert.match(qr, /QRCode\.toString/);
  assert.match(qr, /payment-proof-methods\/:methodId\/qr/);
  assert.match(notifier, /إثبات تحويل جديد/);
  assert.match(notifier, /adm:proof:/);
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
