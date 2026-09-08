# UCHIHA Builder UI V2 — Safe Migration Plan

## Goal
Replace the legacy visual layers with one coherent UI system while preserving existing production APIs, data contracts, authentication, payments, orders, wallet, storefront, bots, support, and project provisioning.

## Rules
1. Production branch `builder/v1-platform` remains untouched until UI V2 acceptance.
2. UI V2 development stays on `design/uchiha-ui-v2`.
3. Never rewrite backend behavior merely to match a preview.
4. Existing API contracts are the source of truth during visual migration.
5. No database migration is required solely for visual redesign.
6. Every production route must retain an equivalent V2 state: loading, empty, success, error, offline/retry where applicable.
7. Remove legacy CSS/JS layers only after the equivalent V2 route is functionally verified.

## Current V2 Preview Surfaces
- `/ui-v2-hub.html` — preview navigation hub.
- `/ui-v2-preview.html` — platform home.
- `/store-v2-preview.html` — storefront.
- `/account-v2-preview.html` — customer account, wallet, payment entry.
- `/admin-v2-preview.html` — owner dashboard.
- `/builder-v2-preview.html` — project/store creation wizard.

## Functional Migration Order

### Phase A — Shared shell
Build a single production-ready V2 shell for:
- brand/header
- responsive navigation
- toast/notice states
- loading/error states
- form primitives
- cards/lists/modals
- functional color tokens
- RTL/LTR behavior
- accessibility focus states

### Phase B — Customer path
Migrate in this order:
1. platform home
2. services/category discovery
3. storefront home
4. category/subcategory/product browsing
5. cart/product selection
6. login/register/TOTP
7. account/profile
8. wallet and ledger
9. add-balance/payment proof
10. orders
11. security/Telegram/identity/support/developer views

### Phase C — Owner path
Migrate:
1. owner overview
2. orders
3. catalog/categories/products
4. customers and finance
5. payment proof review
6. support
7. design/branding editor
8. currencies
9. Telegram bots
10. UCHIHA API library/providers
11. programming/services
12. product intelligence
13. account/security/settings

### Phase D — Project creator
Keep the existing backend provisioning lifecycle but rebuild the visible flow as:
- account
- subscription
- project setup (7 substeps)
- review
- publish

The 7 setup substeps remain logically compatible with the current wizard while each screen shows only the controls required for that decision.

## Storefront Legacy Consolidation
The current storefront loads multiple historical presentation layers including reference, polish, commerce, checkout, catalog, launch, category-color, customer-shell, and boot/runtime scripts. UI V2 must consolidate presentation responsibilities into a small explicit set:
- `ui-v2/core.css`
- `ui-v2/store.css`
- `ui-v2/store.js`
- shared customer shell module

Existing business logic can be adapted behind those modules rather than copied into new parallel layers.

## Verification Gate Per Route
A route cannot replace production until all are true:
- route loads without JS errors
- current API response is consumed correctly
- authentication state is preserved
- loading state works
- empty state works
- error/retry state works
- mobile 320–480 px verified
- tablet verified
- desktop verified
- RTL verified
- keyboard/focus basics verified
- payment/order destructive actions keep current confirmation/security behavior
- no secret/token is rendered into client HTML

## Final Cutover
After all V2 routes pass functional comparison:
1. connect V2 shells to live APIs on the design branch
2. run existing unit/smoke/PostgreSQL tests
3. add browser smoke coverage for critical customer/owner paths
4. remove only superseded legacy visual imports
5. verify production build and Docker image
6. merge by review into `builder/v1-platform`
7. deploy using existing safe VPS release process
8. verify exact release SHA and live smoke before declaring success

## Non-goals
- no change to Game Zone
- no change to UCHIHA School
- no production database reset
- no visual-only rewrite of backend security logic
- no production deployment before explicit design acceptance
