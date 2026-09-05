# UCHIHA Control Center Team API

Small Node.js service for the native Control Center team login and safe project-read surface.

## Scope

The service provides only what the native APK needs now:

- personal username/password login
- opaque server-side sessions
- Owner / Developer / Support roles
- owner-only team creation and account updates
- server-returned capability list
- read-only project list/details from the existing Control Center live registry

It does **not** duplicate project deployment, DNS, GitHub, VPS, or executor logic. Those remain in the existing guarded Control Center backend and will be connected through guarded adapters in later phases.

## Security behavior

- Passwords are stored only as `scrypt` hashes with per-password random salt.
- Session tokens are random 256-bit values; only SHA-256 hashes of those tokens are stored server-side.
- Passwords and tokens are never written to audit records.
- Persistent auth data is written atomically and the file is restricted to mode `0600` where supported.
- Login attempts are rate-limited per remote address.
- Project registry responses are allow-listed/sanitized before being returned to the APK; unknown fields and secrets do not pass through.
- The service binds to `127.0.0.1` by default. Put it behind the existing HTTPS reverse proxy; do not expose the plain HTTP port publicly.

## Owner bootstrap

The first Owner account is created only when no active Owner exists and both variables are present:

- `UCHIHA_TEAM_OWNER_USERNAME`
- `UCHIHA_TEAM_OWNER_PASSWORD_HASH`

Optional display name:

- `UCHIHA_TEAM_OWNER_DISPLAY_NAME`

Do not commit any of these values to GitHub. Keep them in the protected server environment.

## Live project registry

Point the Team API at the same `state.json` used by the running Control Center v6:

```text
UCHIHA_CONTROL_STATE_PATH=/absolute/path/to/control-center/data/state.json
```

The Team API reads this registry only. It does not need or receive the production Owner browser session/cookie. The mobile endpoints are:

- `GET /api/mobile/projects`
- `GET /api/mobile/projects/:id`

The APK caches the sanitized project list locally per signed-in team member so the last synced workspace can still be viewed offline.

## Run

```bash
cd control-center/team-api
npm test
node server.js
```

Default endpoint is `127.0.0.1:8091`.
