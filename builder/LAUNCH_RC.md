# UCHIHA Builder — v41 Launch RC2

- Production root: `uchiha-builder.com`
- Approved UI: `UCHIHA Platform — v41 Final Demo`
- Responsive production layer: `v41-responsive.css`
- Launch assets: `2026.08.14.3`
- Latest schema: `047_subscription_payment_reference_unique`
- Source branch: `builder/v1-platform`
- Production verification gate: `builder/scripts/smoke-vps.sh`
- Launch audit gate: `builder/scripts/launch-audit.sh`

This release candidate keeps the approved v41 runtime intact, adds a full-screen mobile/tablet/desktop responsive production layer, and requires PostgreSQL schema 047 before readiness can report healthy.
