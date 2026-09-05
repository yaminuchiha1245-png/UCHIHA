# Game Zone v1.0 RC20

Game Zone is the handoff-ready release candidate for the customer Telegram Bot/Mini App, client Android wrapper, Admin web center, Admin Android wrapper, shared Backend/API and production deployment stack.

## RC20 focus — final purchase experience and owner-controlled fulfillment promise

RC20 completes the current product-purchase UX requested for client delivery:

- Home shows main categories only.
- Main categories, subcategories, products and payment methods use the same square image-card system.
- Customer cards show only the image and name; product cards additionally show a compact gold price badge inside the lower image area.
- Selecting a product opens a centered purchase dialog while the product grid remains visible behind a light dim/blur layer.
- Product-specific customer fields support Player ID, Server ID, Zone ID, username, email, phone, number, text and select fields.
- Supplier/API field mapping remains internal and is never shown to the customer.
- The owner controls a separate customer-facing delivery promise, for example `فوري`, `تلقائي`, `يدوي`, `ضمن أوقات العمل خلال 30 دقيقة`, or any other bounded text.
- The delivery promise is snapshotted on the order so an existing order keeps the text promised at checkout even if the product is edited later.
- Payment top-ups support receipt-image upload and Admin receipt review.
- Orders show number, price, date and delivery promise in one horizontal row.

## Supplier APIs

Products can define `providerProductId`, structured `inputSchema`, and `providerInputMap`. The HTTP provider adapter supports authentication, custom request fields, nested response mapping, primary/fallback routing, status polling and ambiguous-result manual review. Real supplier credentials belong in deployment secrets, not in source code or chat.

## Production architecture truth

Critical financial/order/top-up flows wait for durable persistence before returning success. PostgreSQL production mode retains the single active application-writer lock plus Financial Mirror, Financial Journal, Wallet Authority and Business Authority. This release still intentionally does **not** claim horizontal multi-writer support or a complete normalized SQL primary repository.

## Handoff status

The code package is ready for owner/customer handoff as a release candidate. Live production activation still requires the operator-provided values listed in `docs/OWNER-HANDOFF-RC20.md`: Telegram credentials, domain/VPS, PostgreSQL, real supplier/payment credentials and Android signing material.
