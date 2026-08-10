# UCHIHA — Payment + Admin Bot Handoff (2026-08-10)

Branch: `builder/v1-platform`

This note records the continuation after the Work session ran out of credits. It is intentionally scoped to the payment proof flow, service direct-purchase behavior, and the store Telegram admin bot. Do not use it as permission to redesign the storefront.

## User-approved behavior

- Preserve the current UCHIHA storefront design and dark visual identity.
- Service products use **شراء الآن** directly; the cart action is hidden for services only.
- The public payment launch area keeps three primary cards visible: **شام كاش**, **Binance Pay**, **USDT**.
- A payment method is actionable only after a real transfer destination/account has been configured.
- Other payment methods are hidden from customers by default and can be added/enabled by the owner.
- The customer does **not** enter the amount transferred.
- After transfer, the customer can submit either:
  1. transaction/order/receipt reference number, or
  2. receipt image.
- Either proof path is sufficient.
- The owner checks the transfer independently, enters the amount actually received in the Telegram admin bot, and the system credits the customer wallet transactionally.
- Admin bot and web/API use the same store database. Do not create a second financial source of truth.
- The **admin bot can now be connected and activated independently**. The owner does not need to create the storefront bot first; storefront bot can be added later.

## Schema

### `034_wallet_proof_admin_bot.sql`

- adds `payment_methods.customer_visible`
- defaults non-primary methods to hidden
- marks active `sham_cash`, `binance_pay`, `usdt_trc20` methods customer-visible
- creates `wallet_topup_proofs`
- creates `admin_bot_sessions`
- is memory-preview compatible

### `035_wallet_proof_admin_bot_rls.sql`

PostgreSQL-only:

- RLS for proof/session tables
- unique replay protection for transaction references and receipt-image hashes
- extends the permanent demo financial write blocker to `wallet_topup_proofs`

Both migrations are registered normally in `src/db.mjs`.

## New public/customer routes

Installed from `src/start.mjs`:

- `GET /api/public/stores/:slug/payment-proof-methods`
- `POST /api/public/stores/:slug/wallet-proofs`
- `GET /api/public/stores/:slug/wallet-proofs`
- `GET /api/public/stores/:slug/payment-proof-methods/:methodId/qr`

The submission guard runs before the write route and rejects:

- visible methods without a configured destination
- reused transaction references
- reused receipt image hashes

## Owner routes

- `GET /api/stores/:storeId/wallet-proofs`
- `POST /api/stores/:storeId/wallet-proofs/:proofId/review`
- `GET /api/stores/:storeId/admin-bot`
- `POST /api/stores/:storeId/admin-bot`

Approval is owner-only. It locks proof + wallet, credits the wallet once, writes `wallet_ledger`, writes audit data, updates proof status, and creates a customer notification.

The standalone admin-bot route is also owner-only. It validates the BotFather token, prevents reuse of the same Telegram bot by another store/channel, encrypts the token and webhook secret, saves `contact_data.telegramOwnerId`, configures the webhook, and marks only the `admin_bot` project component active. It does not require or activate `storefront_bot`.

## Telegram admin bot

`src/telegram.mjs` now provides a store-owner console locked to `contact_data.telegramOwnerId` and private chat.

Current menu includes:

- overview
- orders + order detail
- payment proofs + receipt image display
- approve proof by entering actual received amount
- reject proof
- customers summary
- products + price edit + show/hide
- categories
- payment methods + show/hide + add method
- notifications + mark read
- settings summary

Multi-step admin actions use durable `admin_bot_sessions`.

`src/store-admin-notify.mjs` pushes each newly submitted proof to the active admin bot immediately. Image receipts are sent as Telegram photos. A Telegram notification failure never rolls back the customer's already-committed proof.

### Standalone admin-bot connection

`src/admin-bot-connection.mjs` adds a dedicated connection flow so the owner can use the admin bot immediately without first creating a storefront bot.

Dashboard enhancement files:

- `public/admin-bot-link-v1.js`
- `public/admin-bot-link-v1.css`

They are injected only on `/admin/:storeId` through `src/launch-assets.mjs`. The old two-bot form is replaced in the browser with a focused admin-bot form containing only:

- Admin BotFather token
- owner Telegram ID
- connection status
- one **اختبار وربط بوت الإدارة** button

After success the UI instructs the owner to open the bot and send `/admin`.

## Customer UI layers

Loaded through `public/customer-shell-v1.js` without redesigning the existing account/store shell:

- `account-payment-proof-v3.css/js`
- `account-payment-method-placeholders-v3.css/js`
- `account-proof-history-v3.js`
- `store-direct-buy-v7.css/js`

Important implementation details:

- the old required amount/proof controls remain in legacy markup for compatibility but are hidden by the new proof layer
- the new request payload contains no amount
- customer CSRF is bridged through session storage because `/customer/me` rotates the CSRF token
- placeholder reconciliation is idempotent to avoid MutationObserver render loops
- direct-purchase service action becomes full-width after its cart action is hidden

## Payment logos

Existing assets used:

- `/assets/payment-assets/sham-cash.svg`
- `/assets/payment-assets/binance-pay.svg`
- `/assets/payment-assets/usdt.svg`

## Safety invariants

- never credit a proof twice
- never accept the same transaction reference twice for the same customer/method
- never accept the same receipt image hash twice for the same customer/method
- never accept a proof for a payment method without a configured transfer destination
- permanent demo remains financially read-only
- admin bot is owner-only and private-chat-only
- never place BotFather tokens in GitHub/source code
- encrypt stored Telegram tokens and webhook secrets
- do not merge `main`

## Tests added

- `test/payment-proof-admin-bot-launch.test.mjs`
- `test/wallet-proof-schema-memory.test.mjs`
- `test/wallet-proof-submission-guard.test.mjs`
- `test/admin-bot-independent-link.test.mjs`

The branch CI was already failing before this continuation and GitHub job logs have been unavailable through the connector (`BlobNotFound`). Do not claim CI is green until an actual successful run is observed.
