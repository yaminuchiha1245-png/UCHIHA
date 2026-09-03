# UCHIHA Control Center

Production Core v4 package for the new UCHIHA Control Center.

This branch intentionally keeps the Control Center isolated from the existing bot files.

## Package
`UCHIHA-Control-Center-PRODUCTION-v4-CLEAN.zip`

The archive contains the complete source tree:
- final mobile-first UI
- Node.js backend API
- Owner session authentication
- Policy Engine and approval gates
- tamper-evident audit log
- connector registry for GitHub / Server / DNS / Vault
- Dockerfile and Docker Compose
- PWA/offline shell
- Caddy/Nginx/systemd deployment examples
- persistent data and backup tooling

No production secret is stored in this repository. `OWNER_PASSWORD_HASH` and connector credentials must be supplied only as server environment variables.

High-impact operations remain disabled or approval-gated until the real infrastructure connectors are configured.
