# UCHIHA Admin Bot — Wallet Finance V2 (2026-08-10)

Branch: `builder/v1-platform`

This is the active wallet-adjustment layer for the independently connected Telegram store admin bot.

## Owner flow

From **العملاء** the owner opens a customer and chooses **إضافة رصيد** or **خصم رصيد**. The bot asks for the amount, displays the customer, operation, amount and current balance, then requires **تأكيد العملية** before any financial write.

## Security gates

`src/admin-bot-finance-v2.mjs` runs as a `preHandler` before the advanced admin webhook and verifies:

- active `purpose='admin'` connection
- Telegram webhook secret
- stored owner Telegram ID
- exact owner chat ID
- private chat only

The BotFather token remains encrypted and is never returned to the browser or Telegram messages.

## Transaction safety

A confirmed adjustment:

1. loads the durable `fin2_confirm` session and exact UUID operation ID,
2. locks the customer wallet with `FOR UPDATE`,
3. only after the lock checks whether the same `telegram_wallet_adjustment` ledger reference already exists,
4. rejects any result below zero,
5. updates `customer_wallets`,
6. inserts a `wallet_ledger` row with `entry_type='adjustment'` and the schema-supported `operation_type='admin_adjustment'`,
7. inserts a `wallet_adjusted` customer notification,
8. writes `wallet.adjusted_from_admin_bot` to `audit_logs`.

Lock-before-replay-check means two simultaneous confirmation callbacks serialize on the wallet. The second sees the ledger reference written by the first and returns the existing result instead of applying the delta again. The existing unique ledger reference is an additional database-level protection.

## Not allowed

This layer cannot mark an unpaid order as paid, cannot bypass payment-proof approval, cannot override provider/API execution, and cannot make a wallet negative.

## Tests

`test/admin-bot-finance-v2.test.mjs` contracts:

- runtime installation order
- owner/private-chat authentication
- amount + confirmation workflow
- wallet lock before replay check
- `admin_adjustment` operation taxonomy
- negative-balance prevention
- wallet ledger, customer notification and audit writes
- tenant/store scoping

The superseded V1 source/test/handoff were removed so there is only one active wallet-finance implementation.

This commit is on `builder/v1-platform` only and does not claim a production deployment or green CI.
