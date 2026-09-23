# UCHIHA RADIUS V1-83: fast visual staging (23 September 2026)

Canonical locked reference: reference/UCHIHA-RADIUS-UI-V1-83.html
SHA-256: bdfea1a81d3a82e96330d1a287bc1120046c53af59eca68bb1a3afd452756237.
Never substitute RADIUS-A-Master-v101; those are separate products.

## Fast staging build

Use Node.js 24, install dependencies, then run:

    npm ci
    node scripts/build-provider-v183.mjs server
    node scripts/build-fast-v183.mjs
    node scripts/check-fast-v183.mjs

The locked V1-83 reference remains byte-identical. The fast build splits two lossless WebP atlases, 44 SVGs and four fonts from the original inline CSS, preserves the CSS order in four stylesheets, and reuses the compiled runtime without modifying the app. It fingerprints and separately caches every static asset and precompresses HTML, CSS and JS with gzip.

Verified visual staging URL: https://radius.uchiha-builder.com/v183/
Nginx stage configuration: deploy/nginx-fast-v183-stage.conf.

Staging is NOT a production release. The correct v183 backend, signed Telegram login, tenant migrations and actual MikroTik Site Agent need separate integration tests before replacing the live bot or launching to subscribers. Do not point the Telegram Mini App to a disconnected UI and claim it is functional.

## Speed and verification

The public HTTPS staging HTML is 26,404 bytes raw, 7,409 bytes gzip; the original compiled HTML was 2,680,744 bytes raw and about 1,910,283 bytes gzip. On a cold headless Chromium run emulating 2Mbps downstream and 80ms latency, first contentful paint was 972ms, DOMContentLoaded about 2.2 seconds; real devices and networks vary. The large icon/art atlases remain original lossless assets and can be independently cached on repeat visits.

The local release check has 95 tests: 94 passed, none failed, and one PostgreSQL integration test skipped when its database test environment was absent. The fast build integrity check runs as an additional separate step, not included in that count.

Preserve the current bot token, certificate and unrelated VPS services. Do not touch the primary domain uchiha-builder.com.
