# UCHIHA Admin Bot — Catalog V3 (2026-08-11)

Branch: `builder/v1-platform`

This continuation expands the independently connected Telegram admin bot into a practical mobile catalog manager while preserving the current UCHIHA storefront and existing payment/order safety rules.

## Runtime wiring

`src/admin-bot-catalog-v3.mjs` is installed from `src/start.mjs` before `installAdminBotOperationsV2` and before the general advanced admin webhook fallback.

It runs only as a focused `preHandler` for:

`POST /webhooks/telegram-admin/:connectionId`

Recognized catalog actions are handled once and short-circuited. Existing Operations V2 and original admin-bot handlers continue to own the established price, stock, category and visibility callbacks when Catalog V3 intentionally delegates to them.

## Security

Every handled update verifies:

- active `purpose='admin'` bot connection
- Telegram `x-telegram-bot-api-secret-token`
- stored webhook-secret hash
- exact `contact_data.telegramOwnerId`
- private Telegram chat
- tenant/store scoped reads and writes

BotFather tokens remain encrypted and are never included in catalog messages or source configuration.

## Product list and search

The Telegram **المنتجات** screen now includes:

- recent products with price, type, status and category
- open product detail
- **➕ إضافة منتج**
- **🔎 بحث** by product name or description

Search results open the same enhanced product detail without creating a second product-management model.

## Local product creation wizard

The owner can create a local product entirely from Telegram using durable `admin_bot_sessions`.

Supported local product types:

- digital
- physical
- service
- subscription
- code/card
- account
- game top-up
- programming service

`api_service` is intentionally excluded from this wizard because API products require provider/service mappings and must continue through the UCHIHA Library import flow.

The wizard collects:

1. product type
2. name
3. optional description
4. existing category or no category
5. price in the store currency
6. stock quantity or unlimited
7. manual or local-automatic delivery mode
8. explicit final confirmation

Nothing is inserted before the final confirmation button.

## Creation integrity

Confirmed creation is transactional and uses the same core product model as the web administration flow:

- unique tenant-scoped slug
- `source_kind='local'`
- store currency
- built-in catalog artwork when no merchant image exists
- deterministic `analyzeProductInputSchema`
- `product_input_analyses`
- `outbox_events` with `product.created`
- audit action `product.created_from_admin_bot`

The confirmation carries a generated operation ID. `admin_idempotency_records` reserves that operation under scope `telegram.product.create`, so a repeated Telegram callback cannot create the same product twice. A replay resolves to the already-created product.

## Enhanced product detail

Catalog V3 adds direct controls for:

- description edit / clear
- HTTPS image URL edit
- restore the platform default image

It deliberately reuses existing safe callbacks for:

- name edit
- price edit
- stock edit
- category move/remove
- show/hide

This avoids competing implementations for the same mutation.

## Media behavior

New local products receive an existing UCHIHA catalog image automatically based on product type/name. A merchant may later provide a HTTPS image URL from Telegram. Sending `-` in the image editor restores the appropriate platform image.

No image bytes or BotFather secrets are written into source code.

## Tests

Added:

- `test/admin-bot-catalog-v3.test.mjs`

The test contracts install order, owner/webhook security, local-product creation, replay protection, product analysis/outbox/audit integration, search, description/image management, and delegation to the established Operations V2 callbacks.

This file documents implemented source changes only. It is not a claim that the full branch CI is green or that the VPS release has been deployed.
