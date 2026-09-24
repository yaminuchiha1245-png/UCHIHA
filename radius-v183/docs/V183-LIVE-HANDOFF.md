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

## 2026-09-24: provider router probes and member-linked Telegram buttons

- Every registered provider device stays pending until an on-site agent (using that tenant's unique credential) probes its configured RouterOS host through verified API-SSL and successfully reads `/system/identity/print`. Signed heartbeats carry only device IDs, exact hosts and online/offline status; RouterOS passwords and certificates never leave the site.
- The API accepts signed router probe results **only for the same tenant and exact registered host**. Failed probe marks `error`, successful probe marks `online`; client lists turn stale online results offline after 60 seconds. Forged devices of another provider cannot be activated by a different provider's key. Previously registered demo device rows are neither deleted nor falsely shown online.
- When an owner/admin registers a MikroTik, the actual V1-83 WebApp asks for the verified TLS port (8729 by default), displays the returned `dev_...` ID and offers a Site Agent setup shortcut. The NAS page shows the true server-side state and each device ID. Operator/viewer shortcut buttons are read-only.
- Each existing authenticated network member can pair a Telegram account via an authenticated one-time `POST /api/v1/auth/telegram-link` code (15-minute TTL) generated in the same V1-83 WebApp. The user sends `/link <code>` privately to the official bot. The bot submits a fresh Telegram HMAC in `POST /api/v1/auth/telegram-link/claim`; the API consumes the code atomically and binds the existing user identity, never auto-creates membership. Different providers retain separate databases/tenant scopes. There is no shared platform-owner session for ordinary users.
- New schema: `014_telegram_self_link.sql`, table `telegram_link_challenges` containing **only salted/domain-separated SHA256 digests**, expiration and single-use marker. Runtime table access uses RLS tenant isolation; platform role handles verified claims with separate policy.
- Known release blocker: a real MikroTik has not been installed, paired and verified on the user's actual network. The API and user-facing flows can be tested without claiming live customer service; real payments/APK validation remain separate release gates.

## 2026-09-24: safely correct the two existing pending router records

- Existing per-provider devices remain intact. In the NAS screen, owner/admin users may edit the displayed device name, reachable host and local RouterOS API-SSL port (normally 8729), then supply an audit reason. Updating a device endpoint resets its stale online marker to pending and clears old heartbeat time; only a new signed agent TLS probe can restore the online state.
- Registering the same host and port twice within a tenant, or editing one device to collide with another, now returns a validation error instead of silently creating another misleading NAS row. Other tenants may independently use identical private IP ranges without interference. No automatic deletion or destructive merging of the two previous records.
- Accounting records now associate NAS traffic with the recorded device without marking its *management connection* online. RouterOS online status is reserved for a current authenticated, TLS-verified on-site router probe.

## 2026-09-24: authenticated Telegram Mini App installation and tenant scope

- Migration `015_telegram_tenant_scope.sql` adds nullable `telegram_accounts.tenant_id`. New one-time links store the exact provider selected by the signed-in member. Existing platform-owner Telegram links remain compatible until explicitly relinked.
- The verified Telegram login returns the linked tenant ID to **both the bot and the Mini App**. The bot sets its tenant header before `/auth/me`; the Mini App overrides stale browser tenant storage before the initial request. Linked sessions cannot switch to a second provider using a forged `x-tenant-id`.
- When production installation binding is enabled, a Telegram-linked member receives a writable Mini App installation only if that **same user in that same tenant** still has an active original redeemed installation. Otherwise the new Telegram session stays read-only and activation rules are not bypassed.
- Telegram-derived installations carry an internal `telegramDerived` marker and no independent activation code. A blocked or revoked original installation immediately blocks Telegram-derived sessions too; unlinking Telegram invalidates all its issued tokens on the next request. This preserves tenant and subscription isolation without sharing an installation ID or original activation code over chat.
- The unlinked-user bot now explains how to issue the 15-minute, single-use `/link` code from the **existing authenticated website**. It uses an ordinary website URL, not a prematurely authorized Mini App button.
- Safe per-provider `GET /api/v1/radius/agent-setup` templates can be copied/downloaded by the network owner/admin; they include existing registered device IDs and placeholder local-only secrets, never real MikroTik credentials or signing keys. Old routers on unencrypted API port must be corrected to trusted API-SSL before signed online verification can succeed.
- Regression gates include Telegram cross-device activation, linked-tenant selection, primary-installation revocation, one-time claim replay, tenant-isolated signed RouterOS probes, and original locked V1-83 visual source integrity. Actual user equipment remains unverified until Site Agent is installed in the provider's own network.
## 2026-09-24: local Site Agent Linux bundle

- A reproducible, secret-free on-site Linux bundle is built with `bash scripts/build-site-agent-bundle.sh`, published as `/v183/downloads/uchiha-site-agent-v183.tar.gz` with its SHA-256 manifest. The provider RADIUS screen now links this download beside the existing per-tenant configuration templates.
- The installer requires system-wide Node.js 24/npm and systemd on an always-on Linux host **inside that provider's LAN**. `bash install.sh --check` performs a non-destructive preflight, while `sudo bash install.sh` sets up a dedicated `uchiha-agent` Unix account and a locked-down service without starting it or replacing existing private settings.
- All real router credentials, trusted CA certificates and one-time provider signing keys stay in the provider's private `/etc/uchiha-radius` files. `sudo bash /opt/uchiha-radius-agent/check-and-start.sh` rejects missing local secrets/placeholders, verifies each configured router over TLS using an authenticated identity command, and only then starts the systemd service.
- The bundle contains the local agent, contracts, FreeRADIUS snippets and setup docs; it **does not** install or configure subscriber AAA automatically. FreeRADIUS requires separate operator-reviewed configuration and real network tests. A public VPS cannot reach a customer's private MikroTik IP without an authorized on-site agent or secure network route.
## 2026-09-24: true per-provider MikroTik screens inside Telegram

- Linked ISP owners and admins can now use the `📡 MikroTik بالأزرار` Telegram menu to read their own paginated device list, inspect a specific registered device, submit a new encrypted-API-SSL 8729 registration or correct an old device's name, host and management port **directly in Telegram**. The existing owner's platform administration keyboard remains separate.
- Native operations use each person's own signed Telegram-linked V1-83 session and the server-selected tenant ID. Every click and draft submission checks current membership and role; `collector` cannot inspect router records, `viewer` cannot write, and `owner/admin` can write only if their actual subscription and installation allow it.
- Native writes require one-time preview and confirmation, a 10-minute confirmation TTL, per-member pending state and stable API idempotency keys. Replayed confirmations, a different Telegram user's buttons, editing another tenant's device, an endpoint changed since draft creation or changed permissions cannot silently modify a device.
- Telegram never requests or accepts a MikroTik password in these workflows; encrypted API-SSL credentials remain on each provider's local Site Agent. Device registration stays `pending` until the server has received a recent signed local probe with exact device ID, host and port. The status screen only displays real API-reported counts and agent health.
- Regression coverage includes linked members' native buttons, true online/offline counts, role revocation, cross-user confirmation isolation, replay protection, safe legacy port edits, refused malformed drafts, and unchanged platform-owner controls.
## 2026-09-24: real integration status instead of locked preview samples

- The original V1-83 HTML design and placement remain byte-for-byte locked, while the live runtime overrides the Integrations page and its details dialogs after authenticated API hydration. The old `radius-primary.atlas.example` and `3 sample NAS` illustrative values are not rendered in live mode.
- `INT-MIKROTIK` shows the scoped `GET /radius/overview` verified online device count and the tenant's real device total (for example 0/2 NAS); merely saved devices remain unverified. A signed Site Agent heartbeat without actual RouterOS TLS probes does not count as a connected MikroTik.
- The RADIUS card distinguishes a signed agent heartbeat from accepted AAA records in the last 24 hours. Telegram notifications show successful delivery only after an actual recorded successful send. Management-bot pairing is a separate capability; the billing card does not imply a paid gateway from manual invoice records.
- When an authorized source cannot be read, the card shows unavailable rather than invented zeros or simulated success. Details display escaped server-provided names/errors and actual timestamps. Registration and service configuration actions route to the existing tenant-scoped pages.
- Regression tests render the production integration overlay with real response shapes, missing API results, stale unsigned/failed delivery, partial registration and hostile metadata; locked V1-83 source and optimized static build gates remain active.

## 2026-09-25: multi-network device diagnostics and alternate agent deployment

- A read-only `GET /api/v1/devices/connection-diagnostics` reports each tenant's verified online state and actionable configuration issues, notably legacy duplicates within one site, non-SSL 8728 registration, absent or stale site-scoped agent heartbeats, and suspicious dotted-.0 addresses. It never claims remote network reachability from a saved IP.
- Devices with identical management addresses can be registered at DIFFERENT tenant sites. A tenant-signed RouterOS heartbeat may update a device only when its declared site matches the device's registered site. Legacy same-site duplicate IP/port registrations are never counted as verified online, even with a signed heartbeat.
- Correcting an existing device's site/IP/port resets verification. Name-only fixes remain possible for legacy duplicates. Site-specific read-only `GET /api/v1/radius/agent-setup?siteId=...` exports only that site's routers and config with the matching `RADIUS_AGENT_SITE_ID`; `siteId=unassigned` is supported to review unassigned records.
- The mobile-first NAS screen displays tenant-scoped diagnostics and supports assigning/editing a site for an existing or newly registered device. The Site Agent wizard selects the target site when more than one network is configured, and prevents ambiguous same-site templates from being mistaken for ready-to-run configurations.
- A reproducible secret-free Linux Site Agent release now also includes `Dockerfile`, `compose.yaml` and `DOCKER-README.md`. Docker inside a provider's LAN or on an authorized VPN-connected host runs the same outbound HTTPS agent with per-site isolation. Neither path opens management ports publicly. Cloud direct MikroTik login is explicitly UNSUPPORTED, not a fake connection button.
- Neither a new Docker image nor the public VPS can prove a real customer's router is reachable without operator-owned on-site computer/VPN access, correct management addresses, trusted TLS certificates and a successful local RouterOS login. No live user router credentials were created or collected.
