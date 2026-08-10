# UCHIHA Admin Bot — Store Settings V1 (2026-08-10)

Branch: `builder/v1-platform`

This continuation extends the same independently connected Telegram admin bot. It does not redesign the storefront and does not create a second database.

## Runtime

`src/admin-bot-store-settings-v1.mjs` is installed as a focused `preHandler` before the finance, operations, and advanced admin webhook layers. It only handles its own settings/support callbacks and sessions; unrelated updates continue to the existing admin-bot handlers.

Before handling any action it verifies the active admin bot connection, Telegram webhook secret, configured owner Telegram ID, exact owner chat, and private-chat context.

## Store settings

The **الإعدادات** screen now shows the store slug, currency, store status, active bot count, active support-channel count, visible banner count, support tickets needing attention, and the current welcome message.

The owner can edit the storefront welcome message from Telegram. The write is tenant scoped and audit logged as `store.welcome_changed_from_admin_bot`.

## Support channels

The owner can list, open, add, edit, show, and hide support channels. Supported types follow the existing schema: WhatsApp, Telegram, Instagram, email, TikTok, Discord, phone, and custom.

Creation is a durable multi-step flow: choose type -> enter display name -> enter target/link/number. Name, target, creation, and visibility changes are audit logged.

## Store banners

The owner can list and open existing banners, show/hide a banner, and create a new image banner from Telegram.

Creation flow: title -> HTTPS image URL -> optional HTTPS/relative destination link. External non-HTTPS URLs and URLs containing credentials are rejected. The banner is inserted into the existing `store_banners` table with safe next sort order and `active` status. Creation and visibility changes are audit logged.

## Support tickets

The owner can list recent support tickets, prioritize active/urgent tickets visually, open a ticket with its recent message history, reply as `staff`, and mark an active ticket as resolved.

A reply is written to the existing `support_messages` table and changes the thread to `waiting_customer`. Resolving a ticket changes it to `resolved`. Both actions are tenant/store scoped and audit logged. No unsupported customer-notification type is inserted.

## Durable sessions

Multi-step settings actions use the existing `admin_bot_sessions` table with `set1_*` states and support `/cancel` without affecting unrelated admin-bot sessions.

## Validation contract

`test/admin-bot-store-settings-v1.test.mjs` contracts installation order, owner/private-chat/webhook-secret enforcement, welcome/support/banner management, safe banner URLs, support replies/resolution, audit coverage, and tenant/store scoping.

These changes are committed to `builder/v1-platform` only. They are not a claim that GitHub Actions is green or that the VPS/live site has been deployed.
