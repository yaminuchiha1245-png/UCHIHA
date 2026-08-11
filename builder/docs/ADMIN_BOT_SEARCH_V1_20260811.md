# UCHIHA Admin Bot — Search V1 (2026-08-11)

Branch: `builder/v1-platform`

This continuation improves the Telegram admin bot for stores with many customers and orders. It is intentionally read-only: search/list screens never mutate orders, customers or wallet balances.

## Runtime ownership

`src/admin-bot-search-v1.mjs` is installed before Finance V2, Operations V2 and the general advanced webhook.

It owns only the top-level list/search callbacks:

- `adm:orders`
- `adm:customers`
- `adm8:*`

Order detail callbacks continue to fall through to the established order handler. Customer detail callbacks use `adm4:customer:<customerId>` and therefore continue through Finance V2.

## Order search

The order screen now provides:

- latest orders
- search by order number
- search by customer name
- search by customer email
- attention filter: new / awaiting payment / requires review
- processing filter
- completed filter
- paid filter

Each result shows amount, operational status, payment status and item count. Opening a result delegates to the existing order-detail/operations flow.

Search V1 contains no `UPDATE orders` mutation.

## Customer search

The customer screen now provides:

- recent customers
- search by display name
- search by email
- search by phone
- balance and order-count summary

Opening a customer delegates to Finance V2 where wallet adjustment, status and detail operations retain their existing safety rules.

Search V1 contains no customer-status or wallet-balance update.

## Security

Every handled search update requires:

- active store admin-bot connection
- Telegram webhook secret
- exact owner Telegram ID
- private chat
- tenant/store scoped database queries

## Tests

Added:

- `test/admin-bot-search-v1.test.mjs`

The contracts cover installation order, owner/webhook authentication, order search/filtering, customer search, delegation to existing detail handlers and the absence of order/customer/wallet mutations in the search layer.

This document describes implemented source code. It does not claim that the full repository validation is green or that the branch is deployed to production.
