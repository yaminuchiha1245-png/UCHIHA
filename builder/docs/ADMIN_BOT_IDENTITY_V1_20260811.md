# UCHIHA Admin Bot — Identity & Currency V1 (2026-08-11)

Branch: `builder/v1-platform`

This continuation expands the Telegram admin bot settings area without redesigning the storefront or creating a separate settings database.

## Settings hub

`src/admin-bot-identity-v1.mjs` owns the `adm:settings` callback and is installed before `Store Settings V1`.

The hub exposes:

- **الهوية والمظهر**
- **بيانات التواصل**
- **العملات**
- existing welcome-message management
- existing support-channel management
- existing banners
- existing support tickets

`adm5:*` callbacks intentionally fall through to `src/admin-bot-store-settings-v1.mjs`, so support/banner/ticket behavior is not duplicated.

## Identity

The owner can manage these existing `store_design_tokens` fields from Telegram:

- primary color
- secondary color
- logo URL
- cover URL
- font family

Colors require six-digit HEX syntax. Logo and cover values require HTTPS and may be cleared with `-`. Supported fonts remain aligned with the platform set: Tajawal, Cairo, Noto Kufi Arabic and system UI.

Each change updates only its target design-token column and writes an audit record. It does not overwrite the rest of the store design.

## Contact data

The owner can edit or clear:

- email
- phone
- WhatsApp
- Telegram contact

Updates preserve the complete existing `stores.contact_data` object. In particular, `telegramOwnerId` used to secure the admin bot is not replaced by the public Telegram contact field.

Audit records store only which field changed and whether it is configured; they do not copy the contact value into the audit payload.

## Display currencies

The Telegram bot can list `store_currency_settings`, add a supported display currency, change its manual rate, hide it, or enable it again.

The base store currency cannot be hidden or replaced from this flow.

Rate semantics match the existing platform API: **one unit of the displayed currency expressed in the base store currency**. Rates are positive, limited to eight decimal places, and capped at the same large upper bound used by the platform.

Adding/changing a rate is a multi-step durable session with an explicit confirmation button. Saved rates use `rate_source='manual_telegram'` and never change `stores.currency`.

Visibility uses explicit enable/disable callbacks instead of a blind toggle, so a duplicated Telegram callback converges to the same state.

## Security

Every handled settings update requires:

- active `purpose='admin'` connection
- valid Telegram webhook secret
- exact `contact_data.telegramOwnerId`
- private Telegram chat
- tenant/store scoped queries

Bot tokens are decrypted only in server memory for the response message and never included in settings data or audit logs.

## Tests

Added:

- `test/admin-bot-identity-v1.test.mjs`

The contracts cover install order, owner/webhook authentication, identity fields, contact-data preservation, base-currency protection, explicit currency confirmation and delegation to existing `adm5:*` settings handlers.

This document records implemented source behavior only. It does not claim the full repository CI is green or that production was deployed.
