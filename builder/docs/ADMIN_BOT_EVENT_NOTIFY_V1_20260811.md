# UCHIHA Admin Bot — Event Notify V1 (2026-08-11)

Branch: `builder/v1-platform`

This continuation makes the independently connected Telegram admin bot proactive for important store events instead of requiring the owner to keep refreshing the admin menu.

## Runtime

`src/admin-bot-event-notify-v1.mjs` is installed from `src/start.mjs`.

The module uses two Fastify hooks:

- `onSend` only recognizes successful response payloads and records a small event descriptor on the request.
- `onResponse` performs Telegram delivery after the customer HTTP response has already been sent.

Telegram failure is caught and logged. It cannot roll back or change the result of customer registration, support messaging, or a paid wallet order.

## Events

### New customer

After a successful:

`POST /api/public/stores/:slug/customers/register`

The owner receives the customer's name, email and phone with buttons for:

- **فتح العميل** → `adm4:customer:<customerId>`
- **كل العملاء** → `adm:customers`

The callback reuses the existing Finance V2 customer screen.

### New support ticket

After a successful:

`POST /api/public/stores/:slug/support`

The owner receives the customer, subject, priority and current status with buttons for:

- **فتح التذكرة** → `adm5:thread:<threadId>`
- **كل التذاكر** → `adm5:threads`

### New customer support message

After a successful:

`POST /api/public/stores/:slug/support/:threadId/messages`

The bot sends the latest customer message and links directly to the existing Telegram support-thread manager.

### Paid wallet order

After a successful:

`POST /api/public/stores/:slug/orders/wallet`

The owner receives order number, customer, formatted amount, item count / first product, operational status and a clear **الدفع: من المحفظة ✅** marker.

Buttons:

- **فتح الطلب** → `adm:order:<orderId>`
- **كل الطلبات** → `adm:orders`

Idempotent order replays with `duplicate: true` are intentionally ignored, so a client retry does not send the same new-order alert again.

## Security and data integrity

Before sending any alert the module resolves the store, requires `contact_data.telegramOwnerId`, requires an active `purpose='admin'` connection scoped to the same tenant/store, decrypts the bot token only in server memory, and sends through the existing `TelegramGateway`.

The module never accepts Telegram commands, never changes financial records, and never performs a second write for the business event. It only notifies the owner about a transaction that already succeeded in the canonical store routes.

## Tests

Added:

- `test/admin-bot-event-notify-v1.test.mjs`

The contracts cover runtime installation, watched routes, duplicate paid-order suppression, post-response delivery, best-effort failure behavior, deep links into existing admin callbacks, and active store-admin scoping.

This document records implemented source behavior only. It is not a claim that the full repository CI is green or that the current branch is deployed to production.
