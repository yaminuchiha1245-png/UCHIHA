# UCHIHA Builder — UI V2 Structure Map

> Branch: `design/uchiha-ui-v2`
> Baseline: `bd05519828f37affbf1500a7bfee84fe238c2564`
> Purpose: preserve the working platform structure and data contracts while rebuilding the presentation layer from scratch.

## Non-negotiable rule

This branch is a visual/product-architecture redesign only. Do not deploy it to production and do not replace the current `builder/v1-platform` UI until the new design is reviewed and explicitly promoted.

The redesign must preserve existing backend/API behavior, PostgreSQL data, authentication, tenant isolation, payments, orders, storefront data, Telegram integrations, subscription logic, support, security and production readiness unless a separate backend change is intentionally reviewed.

---

## 1. Platform / public entry

Current source anchors:
- `public/index.html`
- `public/platform-v5.html`
- `public/services.html`
- `public/showcase.html`
- `public/contact.html`
- `public/privacy.html`
- `public/terms.html`

Current functional structure to preserve:
- UCHIHA brand/header
- account/login state
- service search
- service categories
- trust/support entry points
- bottom navigation on mobile
- PWA/runtime boot behavior

Primary user routes currently represented by the home UI:
- `/`
- `/login`
- `/services`
- `/create-store`
- `/category/telegram-bots`
- `/category/mobile-apps`
- `/category/websites`
- `/category/hosting-domains/domains`
- `/category/hosting-domains/website-hosting`
- `/orders`
- `/add-balance`
- `/account`
- `/account#wallet`
- `/support`

### UI V2 target

Replace the current layered v3/v5/v41/polish presentation with one coherent shell:
- one header system
- one mobile navigation system
- one card system
- one typography scale
- one spacing scale
- one state/feedback system
- one responsive strategy
- one illustration/icon language

---

## 2. Builder / project creation

Current source anchor:
- `public/builder.html`

Current product flow:
1. Account creation / login
2. Subscription
3. Project/store identity and setup
4. Publish

The current builder also exposes:
- service/component selection
- real platform explanation
- template selection
- store/project wizard
- slug/subdomain setup
- activity type
- identity/theme setup
- later optional bots/apps

### UI V2 target

Turn this into a clean guided workspace rather than a marketing page plus embedded wizard:
- progress rail with clear completed/current/upcoming states
- live project preview beside the form on larger screens
- mobile preview drawer on phones
- autosave status that never shifts layout
- one primary action per step
- advanced options hidden behind explicit secondary controls

---

## 3. Customer account

Current source anchors:
- `public/account.html`
- `public/account-unified.html`
- `public/platform-account-core.css`
- `public/platform-account-core.js`
- `public/customer-shell-v1.css`
- `public/customer-shell-v1.js`

Current capabilities that must remain reachable:
- register/login
- TOTP / two-factor challenge
- profile/account information
- balance visibility
- notifications
- security and sessions
- Telegram linking
- identity verification
- support
- wallet
- payments
- orders
- developer/API surface
- logout

### Wallet / add-balance flow

Preserve:
- wallet balance
- incoming/purchase totals
- ledger/history
- payment-method chooser
- destination/account data
- min/max limits
- QR where supported
- transfer instructions
- amount input
- commission/net calculation
- transfer proof upload
- proof/payment history

### UI V2 target

Use a single customer shell with routes/views instead of visually unrelated account sub-pages. The account should feel like one app, not a collection of separate HTML files.

---

## 4. Store owner admin

Current source anchors:
- `public/admin.html`
- `public/platform-admin.html`
- `public/payments-admin.html`
- `public/support-admin.html`
- admin catalog/design/launch/bot-link assets

Core navigation to preserve:
- Overview
- Orders
- Products & categories
- Customers & finance
- Support
- Settings & services

Overview capabilities:
- product count
- category count
- order count
- customer count
- support count
- quick actions
- provisioning/deployment state
- store identity summary

Settings/services capabilities:
- appearance/banner
- UCHIHA API library
- programming services
- Telegram bots
- product intelligence
- payments/customers
- account/security
- currency/rate management

Design editor capabilities:
- template
- primary/secondary/background/surface/text/muted/border colors
- font
- radius
- button style
- card style
- logo
- cover
- live preview

### UI V2 target

Rebuild as a modern responsive control panel:
- desktop: stable sidebar + top command bar + content canvas
- tablet: collapsible rail
- mobile: compact top bar + bottom/slide navigation
- critical metrics first, advanced settings grouped by task
- no duplicate navigation entries across multiple shells

---

## 5. Storefront / client-facing store

Current source anchors:
- `public/store.html`
- `public/store-reference.css`
- `public/store-reference.js`
- `public/store-launch-v6.css`
- `public/store-launch-v6.js`
- `public/store-catalog-v5.css`
- `public/store-commerce-v3.css`
- `public/store-checkout-v4.css`
- `public/store-direct-buy-v7.css`
- `public/store-direct-buy-v7.js`
- `public/store-desktop-responsive.css`
- `public/store-boot-guard.js`

Backend/data anchors:
- `src/storefront-api.mjs`
- `src/storefront-account.mjs`
- `src/storefront-subscription-guard.mjs`
- `src/store-admin-notify.mjs`

Functional scope to preserve:
- tenant/store identity
- catalog/categories/products
- product details
- direct buy / checkout
- customer account relation
- subscription guard
- admin notifications
- responsive storefront behavior

### UI V2 target

Store templates may vary visually, but they must use the same semantic components and data contract. A template changes composition/tokens—not business logic.

---

## 6. Payments, wallet and financial proof

Frontend anchors:
- `public/payment-methods.html`
- `public/payments-admin.html`
- `public/wallet.html`
- payment proof/history assets

Backend anchors:
- `src/payments.mjs`
- `src/payment-proof-qr.mjs`
- `src/wallet-proof-admin.mjs`
- `src/wallet-proof-submission-guard.mjs`

Preserve:
- payment method configuration
- customer deposits
- proof upload/review
- QR support
- wallet ledger
- admin financial review
- validation/guard logic

The UI redesign must never weaken payment validation or proof guards.

---

## 7. Telegram / bot integrations

Backend anchors include:
- `src/telegram.mjs`
- `src/admin-bot-connection.mjs`
- `src/admin-bot-catalog-v3.mjs`
- `src/admin-bot-finance-v2.mjs`
- `src/admin-bot-identity-v1.mjs`
- `src/admin-bot-operations-v2.mjs`
- `src/admin-bot-store-settings-v1.mjs`
- `src/admin-bot-search-v1.mjs`
- `src/admin-bot-reporting-v1.mjs`
- `src/admin-bot-event-notify-v1.mjs`

UI V2 must expose bot connection/state/configuration clearly without exposing secrets in ordinary page content.

---

## 8. AI / product intelligence

Frontend anchors:
- `public/ai-bot-product.html`
- `public/ai-bot-purchase.html`
- `public/platform-ai-product.html`
- `public/product-intelligence.html`

Backend anchors include:
- `src/ai-bot-product.mjs`
- `src/ai-bot-product-integration.mjs`
- `src/ai-bot-model-admin.mjs`
- `src/ai-bot-usage-limits.mjs`
- `src/ai-product-activation-guard.mjs`
- `src/product-intelligence.mjs`

Preserve all purchase consent, activation, ownership, provisioning and usage-limit guards.

---

## 9. Support

Frontend anchors:
- `public/support.html`
- `public/support-admin.html`
- `public/support-chat-v2.css`

Backend anchors:
- `src/support-chat-v2.mjs`
- `src/support-chat-download-hardening.mjs`

UI V2 target:
- one chat pattern shared by customer and admin
- explicit unread/status states
- attachment/download behavior remains hardened

---

## 10. Subscriptions / renewals / lifecycle

Frontend includes account renewal UI and launch renewal assets.
Backend anchors:
- `src/launch-subscriptions.mjs`
- `src/launch-subscription-admin.mjs`
- `src/launch-renewals.mjs`
- `src/subscription-expiry.mjs`

Preserve subscription status, expiry and renewal behavior exactly during the visual migration.

---

## 11. Runtime / production infrastructure — DO NOT redesign as UI work

Core anchors:
- `src/app.mjs`
- `src/start.mjs`
- `src/db.mjs`
- `src/config.mjs`
- `src/security.mjs`
- `src/http-hardening.mjs`
- `src/rate-limit.mjs`
- `src/readiness.mjs`
- `src/production-readiness.mjs`
- `src/worker.mjs`
- `src/worker-runner.mjs`

These are runtime/business/security layers and are outside the first visual rewrite unless a UI requirement exposes a verified need.

---

## 12. Current UI debt identified during extraction

The current product has accumulated multiple generations of styling and runtime patches, including families named:
- `styles`
- `ui-v2`
- `platform-v3`
- `platform-v5`
- `platform-v41-production`
- `polish`
- `reference`
- `runtime`
- `launch`
- page-specific fixes

UI V2 must not repeat this architecture. New presentation code should be intentionally small and composable.

---

## 13. Proposed UI V2 presentation architecture

```text
builder/
  ui-v2/
    core/
      tokens.css
      reset.css
      typography.css
      motion.css
      a11y.css
    components/
      app-shell.css
      topbar.css
      sidebar.css
      bottom-nav.css
      button.css
      card.css
      input.css
      modal.css
      toast.css
      empty-state.css
      status.css
      data-list.css
      uploader.css
    pages/
      platform.css
      builder.css
      account.css
      admin.css
      storefront.css
      payments.css
      support.css
      ai.css
    js/
      shell.js
      navigation.js
      feedback.js
      preview.js
```

This is the target organization for new work. Existing production files stay intact during migration.

---

## 14. Design direction for UCHIHA UI V2

The new visuals must follow the approved UCHIHA direction:
- high-fidelity / pixel-crisp
- mobile-first, stable layout
- clear RTL hierarchy
- bespoke/custom stylized illustrations for internal functions instead of generic emoji or random line-icon packs
- functional color coding: important functions may have distinct colors while the base surface stays calm
- minimal layout movement
- animations only where they improve understanding, with progressive/smooth motion
- buttons must read as buttons; numbers/statuses must not look clickable
- Play-Store-quality finish
- real service/app marks where an actual external service is represented
- no anime-style UI and no photorealistic decorative clutter

---

## 15. Migration order

1. Build design tokens + unified shell.
2. Rebuild platform home as the visual approval baseline.
3. Rebuild customer account + wallet/payment shell.
4. Rebuild admin dashboard shell.
5. Rebuild storefront component system and templates.
6. Rebuild builder wizard.
7. Rebuild support and AI/product surfaces.
8. Accessibility/responsive/performance pass.
9. Route/API contract regression tests.
10. Only after explicit approval: controlled promotion to production branch.

## Acceptance gate

A page is not considered migrated merely because it looks new. It must:
- retain its working route/API behavior
- work RTL and mobile-first
- preserve loading/error/empty/success states
- avoid secret exposure
- preserve auth/payment/subscription/security guards
- pass existing production/smoke checks where applicable
- visually belong to the same UCHIHA design system
