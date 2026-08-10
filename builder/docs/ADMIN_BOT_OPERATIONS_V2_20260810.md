# UCHIHA Admin Bot — Operations V2 (2026-08-10)

Branch: `builder/v1-platform`

This continuation expands the independently connected Telegram store admin bot without redesigning the storefront and without touching `main`.

## Runtime wiring

`src/admin-bot-operations-v2.mjs` is installed from `src/start.mjs` **before** `installAdvancedAdminBotWebhook`.

It is a `preHandler` for the existing advanced admin webhook only:

`POST /webhooks/telegram-admin/:connectionId`

The hook handles only the additional management callbacks/sessions. If an update is not one of those operations it falls through to `src/admin-bot-advanced-webhook.mjs`, which can in turn fall through to the established `src/telegram.mjs` admin flows. This prevents duplicate replies and preserves the working proof/payment/product-price behavior.

## Security

Before handling an operation, V2 verifies:

- active `purpose='admin'` bot connection
- Telegram `x-telegram-bot-api-secret-token`
- webhook secret hash
- configured `contact_data.telegramOwnerId`
- exact owner chat ID
- private Telegram chat

Writes stay tenant/store scoped and important mutations are audit logged.

## Categories

The Telegram **الأقسام** screen now supports:

- create a root category
- create a child category after choosing its root parent
- unique slug generation
- safe sort ordering
- existing open/show/hide/rename controls from the advanced layer remain available

Creation uses durable `admin_bot_sessions` and writes `category.created_from_admin_bot` to the audit log.

## Products

The Telegram **المنتجات** screen now provides richer product details and supports:

- rename product
- use the established price-edit flow
- set numeric stock
- set stock to **غير محدود** (`NULL`)
- move product to an existing category
- remove product from a category
- show/hide product

Mutations are tenant/store scoped and audit logged with dedicated action keys.

## Orders

The Telegram **الطلبات** screen now exposes safe operational status actions, deliberately limited so the bot cannot bypass payment/provider/refund logic.

Allowed direct transitions for orders **without** a `provider_orders` record:

- `paid` + payment `paid` -> `processing`
- `processing` + payment `paid` -> `completed`
- `new`/`awaiting_payment` + payment `unpaid`/`pending` -> `cancelled`

Provider-linked orders are read-only in this layer. Paid orders cannot be cancelled here, and unpaid orders cannot be marked paid from this layer. Every successful transition is written as `order.status_changed_from_admin_bot` in the audit log.

## Tests

Added:

- `test/admin-bot-operations-v2.test.mjs`

It statically contracts installation order, webhook/owner security, category creation, product operations, and the intentionally narrow manual-order transition rules.

## Release status

These changes are committed to `builder/v1-platform`. They are not a claim that CI is green or that production/VPS has been deployed. The existing Builder GitHub Actions execution issue must still be resolved or independently validated before a production release.
