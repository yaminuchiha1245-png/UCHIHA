# UCHIHA Builder — UI V2 Extraction

Status: **Preview phase complete / production unchanged**

Branch: `design/uchiha-ui-v2`

## What was extracted from the current platform

The V2 preview keeps the current product structure and reorganizes it into a single UI system instead of rebuilding the business logic.

### Customer-facing flows
1. Platform home and service discovery.
2. Services/categories search and filtering.
3. Storefront: banner, categories, subcategories, products and customer entry points.
4. Product detail, delivery fields, cart, wallet checkout and order summary.
5. Customer account and wallet.
6. Add-balance flow with payment method, amount, fee/net value and payment proof.
7. Orders with status, fulfillment path and delivery details.
8. Customer support with conversations, tickets and attachments.
9. Account security: password, 2FA, active sessions, Telegram link, identity status and project secret placeholders.

### Owner/admin flows
10. Owner dashboard: project/store status, KPIs, pending work, quick actions and service health.
11. Unified management center:
   - Products and categories
   - Customers and balances
   - Payments, deposits and currencies
   - Store design/theme
   - Telegram customer/admin bots
   - Providers and API connections
   - UCHIHA API library
   - Product intelligence / quality review
12. Project/store creation wizard with staged setup, preview, verification and publish handoff.

## Current source capabilities preserved for integration
- Existing customer/order/wallet APIs remain the future data source; V2 does not replace them.
- Payment-method information stays separate from the authenticated add-balance/proof flow.
- Support keeps login, thread creation, messages and file/image/PDF/TXT attachments.
- Admin retains orders, catalog, customers/finance, support, design, bots, API library, programming services, product intelligence, currencies and account/security entry points.
- Provider keys and bot tokens are never embedded in preview HTML; owner enters them through protected settings.

## Preview files
- `builder/public/ui-v2-hub.html`
- `builder/public/ui-v2-preview.html`
- `builder/public/services-v2-preview.html`
- `builder/public/store-v2-preview.html`
- `builder/public/product-checkout-v2-preview.html`
- `builder/public/account-v2-preview.html`
- `builder/public/add-balance-v2-preview.html`
- `builder/public/orders-v2-preview.html`
- `builder/public/support-v2-preview.html`
- `builder/public/security-v2-preview.html`
- `builder/public/admin-v2-preview.html`
- `builder/public/admin-management-v2-preview.html`
- `builder/public/builder-v2-preview.html`

## Shared V2 styles
- `builder/public/ui-v2/uchiha-ui-v2.css`
- `builder/public/ui-v2/services-v2.css`
- `builder/public/ui-v2/store-v2.css`
- `builder/public/ui-v2/account-v2.css`
- `builder/public/ui-v2/customer-flow-v2.css`
- `builder/public/ui-v2/support-v2.css`
- `builder/public/ui-v2/admin-v2.css`
- `builder/public/ui-v2/builder-v2.css`
- `builder/public/ui-v2/completion-v2.css`
- `builder/public/ui-v2/hub.css`

## Next phase after visual approval
1. Bind V2 components to the existing authenticated APIs one flow at a time.
2. Keep old pages as rollback paths during migration.
3. Add contract/integration tests for each migrated flow.
4. Validate responsive/RTL/accessibility and browser behavior.
5. Only after acceptance: merge into `builder/v1-platform`, run production validation, then deploy using the existing guarded release path.
