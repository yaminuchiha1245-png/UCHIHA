# UCHIHA Admin Bot — Wallet Finance V1 (2026-08-10)

Branch: `builder/v1-platform`

This layer adds owner-controlled wallet adjustments to the same Telegram store admin bot and the same store database.

## Flow

From **العملاء** the owner can open a customer and choose:

- **إضافة رصيد**
- **خصم رصيد**

The bot then asks for the numeric amount, shows the customer, operation, amount and current balance, and requires an explicit **تأكيد العملية** callback before any wallet write happens.

## Safety

`src/admin-bot-finance-v1.mjs` is installed as a `preHandler` before the advanced admin webhook route. Before handling a finance action it verifies:

- active admin bot connection
- Telegram webhook secret
- configured owner Telegram ID
- exact owner chat
- private chat only

The confirmed write runs inside a tenant-scoped database transaction and locks the customer wallet with `FOR UPDATE`.

For each adjustment it:

1. verifies the session operation ID,
2. locks the wallet,
3. prevents a negative resulting balance,
4. updates `customer_wallets`,
5. writes an `adjustment` entry in `wallet_ledger`,
6. writes a `wallet_adjusted` customer notification,
7. writes `wallet.adjusted_from_admin_bot` to `audit_logs`.

The operation uses a UUID `telegram_wallet_adjustment` reference. The existing unique ledger reference constraint protects against applying the same confirmed operation twice; if a duplicate transaction races, PostgreSQL rolls that duplicate transaction back rather than double-changing the wallet.

## Intentionally not allowed

This layer does not:

- mark unpaid orders as paid,
- bypass payment-proof approval,
- alter provider/API financial execution,
- allow a customer wallet to become negative,
- expose the BotFather token to Telegram messages or the browser.

## Test

`test/admin-bot-finance-v1.test.mjs` contracts owner/private-chat authentication, explicit confirmation, wallet locking, negative-balance prevention, ledger/audit/notification writes and tenant/store scoping.

This is committed only to `builder/v1-platform`; it is not a production deployment claim.
