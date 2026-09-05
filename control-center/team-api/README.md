# UCHIHA Control Center Team API

Small Node.js service for the native Control Center team login, project-read surface and guarded external connections.

## Scope

The service provides only what the native APK needs now:

- personal username/password login
- opaque server-side sessions
- Owner / Developer / Support roles
- owner-only team creation and account updates
- server-returned capability list
- read-only project list/details from the existing Control Center live registry
- encrypted workspace GitHub connection
- safe repository listing and project-to-repository binding

It does **not** duplicate project deployment, DNS, VPS, or executor logic. Those remain in the existing guarded Control Center backend and will be connected through guarded adapters in later phases.

## Security behavior

- Passwords are stored only as `scrypt` hashes with per-password random salt.
- Session tokens are random 256-bit values; only SHA-256 hashes of those tokens are stored server-side.
- Passwords and tokens are never written to audit records or returned after connection.
- GitHub tokens are encrypted at rest with AES-256-GCM using a server-only master key.
- Persistent auth, vault and connection metadata are written atomically and restricted to mode `0600` where supported.
- Login attempts are rate-limited per remote address.
- Project registry and GitHub repository responses are allow-listed/sanitized before being returned to the APK.
- GitHub network calls are fixed to `api.github.com`; user input cannot select an arbitrary API host.
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

The APK caches the sanitized project list locally per signed-in team member so the last synchronized workspace can still be viewed offline.

## GitHub Vault

Configure a random 32-byte master key on the server only. It may be supplied as base64url or 64-character hex:

```text
UCHIHA_VAULT_MASTER_KEY=<server-only-32-byte-key>
UCHIHA_CONNECTION_VAULT=/protected/path/connection-vault.json
UCHIHA_CONNECTION_STORE=/protected/path/connections.json
```

The Owner enters the GitHub token once through the APK over HTTPS. The backend validates it against GitHub before encrypting it. The token is never returned to the APK after that request.

GitHub mobile endpoints:

- `GET /api/mobile/connections/github`
- `POST /api/mobile/connections/github` — Owner only
- `DELETE /api/mobile/connections/github` — Owner only
- `GET /api/mobile/github/repos`
- `GET /api/mobile/projects/:id/github`
- `POST /api/mobile/projects/:id/github` — Owner only

Project binding selects the repository's default branch automatically. Only non-archived repositories with write/admin permission can be bound.

## Run

```bash
cd control-center/team-api
npm test
node server.js
```

Default endpoint is `127.0.0.1:8091`.
