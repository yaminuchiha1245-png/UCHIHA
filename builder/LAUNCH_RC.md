# UCHIHA Builder — v41 Launch RC1

- Production root: `uchiha-builder.com`
- Approved UI: `UCHIHA Platform — v41 Final Demo`
- Launch assets: `2026.08.14.2`
- Latest schema: `046_active_bot_provisioning_guard`
- Source branch: `builder/v1-platform`
- Production verification gate: `builder/scripts/smoke-vps.sh`
- Launch audit gate: `builder/scripts/launch-audit.sh`

This release candidate preserves `builder/public/index.html` as the approved v41 root and requires PostgreSQL schema 046 before readiness can report healthy.
