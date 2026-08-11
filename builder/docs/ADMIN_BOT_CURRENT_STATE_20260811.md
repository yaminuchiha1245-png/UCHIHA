# UCHIHA Telegram Admin Bot — Current State (2026-08-11)

Branch: `builder/v1-platform`

This is the current handoff for the independently connected store-admin Telegram bot. It supersedes older partial notes when they disagree about admin-bot capabilities. It does not authorize storefront redesign, work on `main`, or bypassing production validation.

## Connection and security

- Admin bot can be connected without creating a storefront bot first.
- BotFather token is validated, encrypted at rest, fingerprinted, and never returned in full.
- Owner Telegram ID is stored in `stores.contact_data.telegramOwnerId`.
- Admin webhook: `POST /webhooks/telegram-admin/:connectionId`.
- Telegram secret header is checked against `webhook_secret_hash`.
- Admin operations require the exact owner chat ID and a private chat.
- The dashboard self-test checks/repairs the advanced admin webhook and sends a test message to the owner.

## Proactive event notifications

### Event Notify V1 — `src/admin-bot-event-notify-v1.mjs`

The admin bot now proactively alerts the owner after important customer-side operations succeed:

- new customer registration
- new support ticket
- new customer message inside an existing support ticket
- new wallet-paid order

The module captures only successful POST responses in `onSend`, then performs Telegram I/O from `onResponse` after the customer HTTP response has already been sent. A Telegram failure is logged and cannot roll back the customer operation.

Deep links reuse existing admin handlers:

- new customer → `adm4:customer:<customerId>`
- support ticket/message → `adm5:thread:<threadId>`
- paid order → `adm:order:<orderId>`

Wallet-order responses with `duplicate: true` are ignored so an idempotent client retry does not create a duplicate “new order” alert.

Before delivery, the notifier resolves the exact store, requires `contact_data.telegramOwnerId`, requires an active admin-bot connection scoped to the same tenant/store, decrypts the bot token only in server memory, and sends through the existing `TelegramGateway`.

## Focused admin layers

Focused `preHandler` layers are installed before the general advanced webhook so a recognized action is handled once and all other updates fall through safely.

### Reporting V1 — `src/admin-bot-reporting-v1.mjs`

- paid sales: 24h / 7d / 30d / total
- order counters
- active products and customers
- pending payment proofs
- open support tickets
- unread notifications
- total customer-wallet liability
- top paid products

### Store Settings V1 — `src/admin-bot-store-settings-v1.mjs`

- welcome message
- support channels: add/edit/show/hide
- banners: add/show/hide
- support tickets: list/detail/reply/resolve

### Finance V2 — `src/admin-bot-finance-v2.mjs`

- customer detail and wallet balance
- add wallet balance with explicit confirmation
- deduct wallet balance with explicit confirmation
- wallet lock + ledger entry + customer notification + audit
- operation replay protection prevents duplicate balance changes
- negative wallet balances are rejected

### Catalog V3 — `src/admin-bot-catalog-v3.mjs`

- product list with price/type/status/category
- product search by name or description
- enhanced product detail
- create local product from Telegram
- supported types: digital, physical, service, subscription, code/card, account, game top-up, programming service
- API-service creation is intentionally excluded because provider mappings must come from the UCHIHA Library import flow
- creation wizard: type → name → description → category → price → stock → delivery → confirmation
- transactionally writes product, product analysis, outbox event and audit
- `admin_idempotency_records` prevents duplicate creation from repeated Telegram callbacks
- edit/clear description
- set HTTPS image URL or restore platform default image
- delegates name/price/stock/category/show-hide mutations to the already-established safe handlers instead of duplicating them

### Operations V2 — `src/admin-bot-operations-v2.mjs`

- create root/child categories
- category hierarchy and visibility operations
- rename product
- edit stock / unlimited stock
- move or clear product category
- show/hide product
- safe manual-order operational transitions only
- provider-linked orders stay read-only in this layer
- unpaid orders cannot be marked paid from this layer
- paid orders cannot be cancelled from this layer

### Advanced fallback — `src/admin-bot-advanced-webhook.mjs` + `src/telegram.mjs`

Preserves established flows including:

- main menu
- order/proof/product fallbacks
- receipt image display
- approve transfer proof by entering the amount actually received
- reject transfer proof
- add/show/hide payment methods
- notifications
- base settings fallback

## Payment-proof invariants

- Customer never types the transferred amount.
- Customer submits either reference/transaction number OR receipt image.
- Owner verifies the transfer independently.
- Owner enters the amount actually received only when approving.
- Proof approval locks proof + wallet and credits only once.
- Duplicate reference/image submissions are rejected.
- A payment method without a configured destination cannot receive a proof.
- Demo financial writes remain blocked.

## Current runtime order

`src/start.mjs` installs Event Notify V1 after the standalone admin-bot connection routes. The focused Telegram-admin command modules remain before the general advanced webhook. Catalog V3 is installed before Operations V2 so the richer product list/create/search UI can short-circuit `adm:products` while intentionally delegating existing `adm3:*` mutations to Operations V2.

## Tests / validation status

Relevant contract tests now include:

- `test/admin-bot-independent-link.test.mjs`
- `test/admin-bot-advanced-management.test.mjs`
- `test/admin-bot-reporting-v1.test.mjs`
- `test/admin-bot-store-settings-v1.test.mjs`
- `test/admin-bot-finance-v2.test.mjs`
- `test/admin-bot-operations-v2.test.mjs`
- `test/admin-bot-catalog-v3.test.mjs`
- `test/admin-bot-event-notify-v1.test.mjs`
- payment-proof schema/guard/launch tests

Catalog V3 was syntax-checked locally. Its four focused static contract tests were also executed locally and passed. The Event Notify V1 test file was syntax-checked locally after its route contract was corrected. These targeted checks do **not** mean the complete repository suite or production validation passed.

The latest observed GitHub `UCHIHA Builder V1` validation remains failed. GitHub's decoded job-log endpoint continues returning `BlobNotFound`, and the job-step endpoint returns no steps, so the connector does not currently expose the failing command. The VPS publish job must remain skipped until validation is actually resolved/independently verified.

## Deployment rule

Production deployment remains the validated VPS release path. Do not use a legacy hosting status as evidence that the current branch is safely deployed, do not bypass the failed validation gate, and do not merge `main` as part of this work.
