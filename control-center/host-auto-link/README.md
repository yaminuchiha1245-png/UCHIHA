# UCHIHA Control Panel v1.1.3 automatic infrastructure link

This directory contains the host-side read-only infrastructure snapshot used by the approved `com.uchiha.controlpanel` Android app.

The VPS periodically publishes a sanitized JSON status document containing:
- Hostfiley VPS health and non-sensitive utilization.
- PostgreSQL engine/version/health discovery.
- DNS provider detection, nameservers, known domains, and local SSL state.

No passwords, API tokens, SSH credentials, database URLs, project secrets, or signing keys are exposed.

Production endpoint: `https://panel.uchiha-builder.com/api/app/infrastructure`.

The Android runtime consumes this endpoint while preserving the approved v1.0.1 visual interface. DNS write access is intentionally not claimed unless Cloudflare API authorization exists.

## Real-data rule

No demo domain, server, or database rows are emitted. The snapshot discovers active Nginx virtual hosts, local TLS certificates, the running PostgreSQL container/database, Docker service health, Hostfiley VPS utilization, and authoritative nameservers. Missing capabilities are reported as unavailable instead of filled with sample values.
