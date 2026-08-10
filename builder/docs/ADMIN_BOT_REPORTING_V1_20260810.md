# UCHIHA Admin Bot — Reporting V1 (2026-08-10)

Branch: `builder/v1-platform`

The existing **نظرة عامة** button now opens a richer owner-only operational dashboard inside Telegram.

## Security

`src/admin-bot-reporting-v1.mjs` is a read-only `preHandler` for the advanced admin webhook. It handles only the `adm:overview` callback and verifies the active admin connection, Telegram webhook secret, owner Telegram ID, exact owner chat, and private-chat context before reading store data.

## Dashboard

The overview reports, in the store base currency:

- paid sales recorded in the last 24 hours
- paid sales recorded in the last 7 days
- paid sales recorded in the last 30 days
- total recorded paid sales
- total/paid/attention/processing/completed order counts
- active customer count
- active product count
- pending wallet proof count
- open/waiting support ticket count
- unread owner notification count
- total customer-wallet balance liability
- top three paid products by recorded order-item total

The UI explicitly labels these values as operational sales data and does **not** call them net accounting profit.

Quick buttons link directly to orders, payment proofs, customers, products, support, settings, and the main admin menu.

## Validation

`test/admin-bot-reporting-v1.test.mjs` contracts installation order, owner/private/webhook authentication, paid-sales windows, operational counters, wallet liability, top-products aggregation, and the non-profit accounting disclaimer.

The module is committed only to `builder/v1-platform`. It does not claim a live deployment or a successful CI run.
