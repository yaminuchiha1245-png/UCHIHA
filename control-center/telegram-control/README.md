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
