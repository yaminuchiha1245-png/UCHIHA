# UCHIHA Control Center Team API

Small Node.js service for the native Control Center team login flow.

## Scope

This phase intentionally implements only the team-authentication surface required by the native APK:

- personal username/password login
- opaque server-side sessions
- Owner / Developer / Support roles
- owner-only team creation and account updates
- server-returned capability list

It does **not** duplicate project deployment, DNS, GitHub, or VPS execution. Those remain in the existing guarded Control Center backend and will be connected through adapters in later phases.

## Security behavior

- Passwords are stored only as `scrypt` hashes with per-password random salt.
- Session tokens are random 256-bit values; only SHA-256 hashes of those tokens are stored server-side.
- Passwords and tokens are never written to the audit records.
- Persistent auth data is written atomically and the file is restricted to mode `0600` where supported.
- Login attempts are rate-limited per remote address.
- The service binds to `127.0.0.1` by default. Put it behind the existing HTTPS reverse proxy; do not expose the plain HTTP port publicly.

## Owner bootstrap

The first Owner account is created only when no active Owner exists and both variables are present:

- `UCHIHA_TEAM_OWNER_USERNAME`
- `UCHIHA_TEAM_OWNER_PASSWORD_HASH`

Optional display name:

- `UCHIHA_TEAM_OWNER_DISPLAY_NAME`

Do not commit any of these values to GitHub. Keep them in the protected server environment.

## Run

```bash
cd control-center/team-api
npm test
node server.js
```

Default endpoint is `127.0.0.1:8091`.
