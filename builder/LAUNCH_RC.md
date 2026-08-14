# UCHIHA Builder — v41 Launch RC2

- Production root: `uchiha-builder.com`
- Approved UI: `UCHIHA Platform — v41 Final Demo`
- Responsive production layer: `v41-responsive.css`
- Launch assets: `2026.08.14.3`
- Latest schema: `047_subscription_payment_reference_unique`
- Source branch: `builder/v1-platform`
- Production verification gate: `builder/scripts/smoke-vps.sh`
- Launch audit gate: `builder/scripts/launch-audit.sh`

This release candidate keeps the approved v41 visual runtime intact while replacing its demo trust boundaries with production ones. The root document injects a narrow adapter inside the original private v41 IIFE, clears and disables the legacy demo LocalStorage state, disables seeded demo chat/admin state, and fails closed if the adapter is unavailable.

Production root behavior in RC2:

- Account identity, available wallet balance, notifications, and user orders are hydrated from authenticated backend APIs.
- Account-sensitive UI remains hidden until the backend resolves guest versus authenticated state, preventing a fake guest/login flash.
- Logout is server-authoritative and CSRF protected; the v41 local logout simulation is not used.
- Categories, services, payments, account, support, builder, domain, and admin actions route into production flows instead of archived v41 transaction screens.
- WhatsApp and social buttons use active contacts from `/api/public/portal`; missing contacts fall back to production support.
- Hard-coded demo service counts are hidden on the production root.
- The production manifest and versioned service worker are registered by the v41 bridge.
- `launch-audit.sh` verifies the private runtime adapter, disabled demo persistence/chat, production account/order/contact endpoints, server logout, PWA registration, and the existing PostgreSQL/container/backup/subscription gates.

A release is **not** considered verified merely because the branch is deployed. `smoke-vps.sh` / `launch-audit.sh` and schema `047_subscription_payment_reference_unique` must still pass on the target production environment.
