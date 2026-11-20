# UCHIHA Telegram Control Center

A Telegram bot + Telegram Mini App for the same real UCHIHA Control Center environment.

## Included

- Real Hostfiley VPS status, RAM, disk, load and Docker services.
- PostgreSQL state and detected database identity.
- Nginx-discovered domains, TLS state, redirects and authoritative DNS nameservers.
- Real report history collected by the host status service.
- Project registry, approvals and tamper-evident audit log.
- Project secret management from the Mini App.
- Guarded Docker container restart controls and sanitized container logs.
- Nginx reload with configuration validation.
- PostgreSQL statistics plus protected on-demand backups.
- Live operations center inside both Telegram messages and the Mini App.
- Automatic health alerts for server/container/database/SSL and high disk/RAM conditions.

## Secrets security

Telegram messages never reveal stored secret values. The bot shows key names and configured state only. The Mini App can add or replace a value in write-only mode and can delete a key. Values are persisted in the server-side Control Center project secret store with mode 0600.

## Authorization

The bot accepts only configured admin Telegram IDs. The Mini App validates Telegram `initData` using the Bot API token and rejects non-admin users.

For first-time setup, an optional one-time claim flow can be enabled by storing the SHA-256 of a claim code in `TELEGRAM_CLAIM_CODE_HASH`. Once an admin is claimed, further claims are rejected.

## Production paths

- Mini App: `https://panel.uchiha-builder.com/telegram-control/`
- API: `127.0.0.1:8790` behind Nginx
- State: `/var/lib/uchiha-telegram-control`
- Project secrets: Control Center Docker data volume
- Environment: `/etc/uchiha-telegram-control.env`

The API service may run before the Bot token is configured; it returns 401 for dashboard requests until valid Telegram initData is available. The bot service should only be enabled after a real Bot API token is configured.

## Operations safety

High-impact actions require an explicit confirmation and use fixed allowlisted operations. The Telegram control plane intentionally does not expose an arbitrary shell/terminal. Container logs are sanitized for common token/password/secret patterns before display. Database backups remain on the VPS under the Telegram Control Center state directory with restricted permissions.


## Project business manager

The Telegram bot is the primary management surface and includes a persistent project catalog for apps, websites, bots, bundles and services.

Each managed project can store:
- Client name, repository, branch, domain and linked runtime components.
- Monthly fee, currency, due day, payment history and overdue state.
- One-time expiry timer with automatic runtime stop.
- Version/update history, including imported GitHub commit history when available.
- Docker or systemd runtime links validated against services that actually exist on the VPS.

Telegram project controls:
- Start/stop linked projects with explicit confirmation.
- Record the current month's payment.
- Browse apps, websites, bots and complete project bundles.
- Manage billing, timers, runtime links, project metadata, secrets and version history from Telegram bot buttons and short guided prompts.

The watcher checks every minute for project expiry timers and sends Telegram notifications when a timed stop executes. Monthly overdue reminders are also sent only when the billing state changes.

APK-only projects that do not yet have a server runtime or entitlement endpoint remain visible as unlinked. They are not falsely reported as remotely stoppable until an actual backend/runtime is connected.

## Analytics-only Mini App

The Mini App is read-only and is used only for advanced interactive statistics: infrastructure health, project status, finance, alerts, domains, backups and activity. All operational mutations stay inside Telegram bot buttons.


## ☁️ Cloud Services & Apps (Telegram, opt-in)

This integration is **monitoring-only**: it does not pause a project, stop orders, write to a cloud provider, upgrade a plan, change billing, or remove remote resources. It reuses the existing project catalog, protected secret store, admin checks, bot, API service, and 60-second watcher. Data is stored locally at `/var/lib/uchiha-telegram-control/cloud-usage.sqlite3` with filesystem mode 0600. Records are periodically trimmed after 93 days.

### Setup and permissions

1. From the bot choose **☁️ إدارة الخدمات السحابية والتطبيقات → ربط مشروع**. Select a project from the existing registry, then select Supabase, Firebase, or another backend and enter its actual **project ID** (not its secret).
2. For **Supabase**, place a restricted Management API access token under `SUPABASE_MGMT_TOKEN` in that project's existing protected secret store. This is a server-side credential; never include it in source control or client APK. The monitor reads the official Supabase Management API project metadata and API request count. The returned count's exact billing period is not documented; it is labeled **provider-window** and must **not** be compared to monthly free allowances.
2a. **Optional actual Supabase PostgreSQL size:** enter a restricted read-only PostgreSQL monitoring connection string in the protected project secret `SUPABASE_MONITOR_DSN` and install a pinned/tested `psycopg` or `psycopg2` driver in the Telegram service environment. The code uses TLS `verify-full`, `default_transaction_read_only=on`, a 3-second statement timeout and a 4-second connect timeout, then runs **only** `SELECT pg_database_size(current_database())`. Do not use the application write user if a read-only monitoring user can be created. This measures **PostgreSQL database bytes**, not disk/WAL, Storage egress or a billing period total. If the driver, protected DSN, or connection is missing, this metric remains unavailable.
3. For **Firebase**, configure Google Cloud Application Default Credentials for the service account on the VPS (e.g. `GOOGLE_APPLICATION_CREDENTIALS` points to a root-readable protected credentials file). Give it only **Monitoring Viewer** on the chosen Google Cloud project, never Editor or Owner. Install the maintained `google-auth` package in the API/bot/watcher Python runtime, pinned to a tested version. The monitor reads official Cloud Monitoring time-series, including Firestore document reads/writes/deletes, database storage, RTDB monthly outbound bytes, native RTDB quota gauges, and live database connections when published by the provider. Missing metrics show as unavailable.
4. **Other provider** can be linked for registry/heartbeat monitoring. No API metrics are invented. A future official adapter must be reviewed and integrated for its other metrics.
5. Adjust limits only where metric units and time windows match. A manually entered limit is identified as **manual**, not as a verified provider allowance. Where the provider supplies a compatible native quota gauge, that measured limit takes precedence.
6. **Cost** is a separately entered fixed monthly operational cost only. This is a partial figure; absent an authoritative billing export/pricing contract, **variable cost, final provider bills, and company-wide true COGS are unavailable**. Never interpret zero configured fixed cost as zero actual operating cost.

### Device and synchronization telemetry

The existing Telegram control API now accepts an opt-in signed heartbeat at `POST /api/cloud/heartbeat`. It requires a per-project `CLOUD_HEARTBEAT_KEY` secret in the same project vault. This API is not usable until the existing Nginx route is explicitly enabled for that path and a trusted application backend is instrumented; do not expose other control API routes without the usual Telegram initData check.

**Security warning:** never put `CLOUD_HEARTBEAT_KEY` into a distributed APK, browser bundle, or Mini App. Clients authenticate to their own backend; that trusted backend signs the heartbeat server-side. A shared key inside public clients is extractable and not safe. If a project lacks a trusted backend, leave device counting unavailable rather than weakening authentication. Use a dedicated TLS-protected, rate-limited reverse-proxy location for the heartbeat path.

The body must be UTF-8 JSON of up to 2 KiB:
```json
{"projectId":"client-app","deviceId":"stable-installation-id","sync":"ok"}
```
Use header `X-Uchiha-Cloud-Timestamp` as current Unix time in seconds and `X-Uchiha-Cloud-Signature` as lowercase hex HMAC-SHA256 over `timestamp + "." + exact_raw_body_bytes`, using this project's key. The server accepts a maximum ±5-minute clock skew. Never embed an administrative Supabase PAT or Google service-account credential in the app. Send no personal data. A unique per-installation identifier should be pseudonymous and random, not the phone number, IMSI, or hardware device ID.

Sample heartbeat every ~5 minutes when the app is active or after a completed sync; status `error` is for an actual detected synchronization error. The bot shows **distinct heartbeats in the past 15 minutes**, not all installed APKs or database socket connections. Until an instrumented app submits valid signed heartbeats, device count and last sync are **unavailable**.

### Monitoring and alerts

- The existing watcher samples at most 2 due cloud links per invocation, with a 15-minute cooldown per link. Manual refresh overrides that cooldown. It does not issue remote writes or autoscale/stop actions.
- Threshold alerts at 70%, 85%, and 95% are issued only when a compatible measured usage value and known limit are both fresh. Supabase's undocumented aggregation window is excluded from monthly threshold calculations.
- The existing watcher fingerprint prevents repeating unchanged alert sets every minute. Sync failures from signed heartbeats alert through the same mechanism.
- Telegram daily/30-day reports show sample minima, maxima, count and provenance, **not fabricated cumulative billing-cycle totals**.
- 401/403/429, missing permissions, absent metrics, and unavailable providers appear as error/unavailable states rather than synthetic zeros.
- Cloud API sampling failure must never block existing server alert handling or store operations.

### Production release checklist

- Review the draft PR, pass GitHub Actions Python syntax and offline regression tests, then deploy **only** the Telegram control bot/API/watcher files with the existing deployment procedure and rollback snapshot.
- Verify local `/health`, bot `/cloud`, an authorized cloud-link flow, a credentialed read-only manual refresh, a 70% test alert using a controlled test project, and a signed test heartbeat.
- Activate permissions and monitoring gradually; confirm no extra queries are made from any customer storefront. Roll back the control components if they misbehave. No automatic server rollout is included in this PR.
- Project usage/allowance and billed cost can be **organization-scoped** and shared among multiple apps in one provider project. Do not sum a single organization invoice once per app.
