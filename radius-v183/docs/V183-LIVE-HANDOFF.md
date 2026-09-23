# UCHIHA RADIUS — V1-83 live handoff (2026-09-23)

This is the correct provider/Mini App project, **not** RADIUS-A-Master-v101.
Preserve `reference/UCHIHA-RADIUS-UI-V1-83.html` unchanged; its SHA-256 is
`bdfea1a81d3a82e96330d1a287bc1120046c53af59eca68bb1a3afd452756237`.

## Deployment now verified

- Public root `https://radius.uchiha-builder.com/` redirects to `/v183/`.
- Old `/telegram` and `/telegram/` URLs redirect to `/v183/`, so cached bot menu links do not display the other RADIUS UI. Legacy assets and API services remain on disk for rollback.
- `/v183/` is the same approved V1-83 markup/layout with hashed, independently cached CSS/images/fonts/JavaScript. HTTPS has a valid certificate; the release entry transfers about 7.4 KB gzip. Browser-render timing depends on device and connection, not just HTML size.
- V1-83 API: its own service `uchiha-radius-v183-staging.service` at loopback port 8794, its own PostgreSQL data and signed Telegram session verification. The old provider's database and APIs remain separate.
- Management bot: `uchiha-radius-telegram-bot.service` runs `/opt/uchiha-radius/telegram-v183/v183_screens.py`. Its menu and WebApp use `/v183/`. Only the bot's already-paired owner can use management screens.
- API metrics, sites, plans, subscribers, sessions, invoices, network devices, integration status, Telegram menu, support tickets, reseller cards, vouchers, team, reports and session-start timelines read actual tenant-scoped records. Empty deployments display zero or empty states, never fabricated subscribers/routers/revenue.
- Bot MikroTik buttons open separate contextual screens for listing, registration (pending), connection checks and agent setup; persistent dashboard keyboard is **not** repeated after every action. Financial and provisioning writes have explicit confirmation and idempotency.
- A signed-owner Chromium mobile test covered 11 screens plus real API authentication, and an unknown Telegram ID received HTTP 403 without access. The API unit suite and Python bot tests passed during rollout.

## Explicit release blockers (do not report 100% operation yet)

- The newly linked V1-83 tenant currently has **zero customer subscribers and zero connected MikroTik routers**. Registering a router is not proof of connectivity; a provider must install/pair Site Agent within its real network and validate signed heartbeats, RouterOS operations and live accounting.
- Billing checkout is disabled until a real payment provider and contracts are configured. The owner has a **seven-day internal trial** created 2026-09-23, ending 2026-09-30. This is NOT a paid subscription.
- Real-world Android APK installation, payments, routers and user-specific network performance have not been independently validated as a production launch.

## Safe continuation

1. Continue on `radius-v183-telegram-integration`. Do **not** pull interface code from V101, Master v36 or older demo variants.
2. Before any deploy, run `node scripts/build-provider-v183.mjs server`, `node scripts/build-fast-v183.mjs`, `node scripts/check-fast-v183.mjs`, backend tests and `python3 -m unittest discover -s apps/telegram-bot -p 'test_*.py'`. Use a signed Telegram browser test to verify tenant-scoped zero data and that unknown IDs cannot browse.
3. Publish built hashed assets first; atomically update `/opt/uchiha-radius/v183-stage/index.html.gz` and `index.html` last. Keep previously cached hashed assets.
4. Check public HTTPS `/v183/`, `/api/v1/meta`, `/healthz` and the Telegram bot service. Do not change `uchiha-builder.com`, `demo.uchiha-builder.com`, other projects or the global Cloudflare zone.
5. Do not expose RouterOS passwords, Telegram bot tokens, database connection strings or migration credentials in the repository or Telegram messages.

Web rollback artifact on VPS: `/opt/uchiha-radius/backups/v183-stage-before-live-20260923T105256Z.tar.gz`.
Nginx rollback copy: `/opt/uchiha-radius/backups/uchiha-radius-nginx-before-v183-telegram-redirect.conf`.

## 2026-09-23: self-service V1-83 Site Agent enrollment

- Authenticated **tenant owner only**: POST `/api/v1/radius/credential` with `reason` (10–500 chars), explicit `confirmation` (`ISSUE` for first issue, `ROTATE` for an existing key), and idempotency key. Active tenant and write-enabled subscription required. Other tenant admins/operators/viewers receive 403.
- Dedicated random key per tenant; encrypted in database and returned only by the sensitive POST with `Cache-Control: no-store`. Never delivered over Telegram, never logged as audit data or stored in the browser's local/session storage. Treat the one-time display as sensitive and close it after copying to local Site Agent config.
- Rotating invalidates the old HMAC signing key immediately, marks prior RADIUS nodes offline without destroying their historical heartbeat timestamps, and resets current integration heartbeat status. An authorized tenant owner must reconfigure the local agent before heartbeat can resume.
- `GET /api/v1/radius/overview` now has safe, secret-free `credentialConfigured`, `agentConnected`, `agentsTotal`, `agentsOnline` and `agentsDegraded`. Connection requires a **signed heartbeat within 45 seconds** from a healthy/degraded node; merely issuing a key or creating a device is not enough.
- The approved V1-83 UI displays issuer controls only to the tenant owner. The Telegram bot exposes the live heartbeat state and opens the secure WebApp for key issuance; it never sends the secret as a chat message.
- **Live Nginx exception** in `/etc/nginx/conf.d/uchiha-radius.conf`: POST `/connectors/radius/*` routes to V1-83 loopback `127.0.0.1:8794`; older `/api/connectors/radius/*` stays with V101 `127.0.0.1:8792`. This fixed the previous public HTTP 405 that prevented remotely hosted V1-83 agents from pairing.
- Test gates: 104 API tests (103 pass, one pre-existing skip), 21 Telegram Python tests, checked frontend syntax and verified locked V1-83 reference SHA. A simulated signed agent heartbeat/rotation passes; **no real MikroTik or real customer network was paired**.
