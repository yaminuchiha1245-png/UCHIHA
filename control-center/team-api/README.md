# UCHIHA Control Center Team API

Small Node.js service for the native Control Center team login, project-read surface and guarded external connections.

## Scope

The service currently provides:

- personal username/password login
- secure first-run Owner creation from the APK
- opaque server-side sessions
- Owner / Developer / Support roles
- owner-only team creation and account updates
- server-returned capability list
- read-only project list/details from the existing Control Center live registry
- encrypted workspace GitHub connection
- safe repository listing and project-to-repository binding
- guarded SSH password connection for public VPS hosts
- encrypted VPS credential storage and project-to-server binding

It does **not** duplicate deployment, DNS, or the production executor. Those remain in the existing guarded Control Center backend and will be connected through guarded adapters in later phases.

## Security behavior

- Passwords are stored only as `scrypt` hashes with per-password random salt.
- Session tokens are random 256-bit values; only SHA-256 hashes of those tokens are stored server-side.
- Passwords and tokens are never written to audit records or returned after connection.
- GitHub tokens and VPS passwords are encrypted at rest with AES-256-GCM using a server-only master key.
- Persistent auth, vault and connection metadata are written atomically and restricted to mode `0600` where supported.
- Login and first-run setup attempts are rate-limited per remote address.
- Project registry and GitHub repository responses are allow-listed/sanitized before being returned to the APK.
- GitHub network calls are fixed to `api.github.com`; user input cannot select an arbitrary API host.
- VPS connections reject localhost, `.local`, private, link-local, carrier-grade NAT and documentation/reserved targets.
- VPS hostnames are resolved before SSH and must resolve only to public addresses.
- First SSH connection captures the server host-key fingerprint; later tests require the same fingerprint and stop if it changes.
- The SSH connector does not expose an arbitrary terminal. Its verification command is fixed and only confirms that the authenticated session can execute normally.
- The service binds to `127.0.0.1` by default. Put it behind the existing HTTPS reverse proxy; do not expose the plain HTTP port publicly.

## First-run Owner setup

The preferred mobile flow does not ship a default username or password.

When the auth store has no users, the APK checks:

- `GET /api/mobile/setup`

If `needsOwner=true`, the app shows the one-time Owner wizard. The server must have a one-time setup-code hash configured:

```text
UCHIHA_TEAM_SETUP_CODE_HASH=<sha256-of-one-time-setup-code>
```

The user enters the one-time setup code, display name, username and password in the APK. The app sends them over HTTPS to:

- `POST /api/mobile/setup/owner`

The server compares only the SHA-256 hash of the setup code, creates the first Owner with a `scrypt` password hash, returns a normal session, and permanently closes first-run setup because the auth store is no longer empty. The setup code and Owner password are never stored in the APK.

The older environment bootstrap remains supported for controlled server provisioning. It creates the first Owner only when the auth store is still empty and both variables are present:

- `UCHIHA_TEAM_OWNER_USERNAME`
- `UCHIHA_TEAM_OWNER_PASSWORD_HASH`

Optional display name:

- `UCHIHA_TEAM_OWNER_DISPLAY_NAME`

Do not commit setup codes, password hashes, Vault keys or credentials to GitHub. Keep them only in protected server configuration.

## Live project registry

Point the Team API at the same `state.json` used by the running Control Center v6:

```text
UCHIHA_CONTROL_STATE_PATH=/absolute/path/to/control-center/data/state.json
```

The Team API reads this registry only. It does not need or receive the production Owner browser session/cookie. The mobile endpoints are:

- `GET /api/mobile/projects`
- `GET /api/mobile/projects/:id`

The APK caches the sanitized project list locally per signed-in team member so the last synchronized workspace can still be viewed offline.

## Connection Vault

Configure a random 32-byte master key on the server only. It may be supplied as base64url or 64-character hex:

```text
UCHIHA_VAULT_MASTER_KEY=<server-only-32-byte-key>
UCHIHA_CONNECTION_VAULT=/protected/path/connection-vault.json
UCHIHA_CONNECTION_STORE=/protected/path/connections.json
```

### GitHub

The Owner enters the GitHub token once through the APK over HTTPS. The backend validates it against GitHub before encrypting it. The token is never returned to the APK after that request.

Endpoints:

- `GET /api/mobile/connections/github`
- `POST /api/mobile/connections/github` — Owner only
- `DELETE /api/mobile/connections/github` — Owner only
- `GET /api/mobile/github/repos`
- `GET /api/mobile/projects/:id/github`
- `POST /api/mobile/projects/:id/github` — Owner only

Project binding selects the repository's default branch automatically. Only non-archived repositories with write/admin permission can be bound.

### VPS / SSH

The Owner can enter a public VPS host, SSH port, username and password from the APK. UCHIHA verifies SSH first and stores the password in the encrypted Vault only after a successful connection.

Endpoints:

- `GET /api/mobile/servers`
- `POST /api/mobile/servers` — test, save and optionally bind a VPS
- `GET /api/mobile/projects/:id/server`
- `POST /api/mobile/projects/:id/server`
- `POST /api/mobile/servers/:id/test`
- `DELETE /api/mobile/servers/:id`

Server metadata returned to the APK contains only the label, host, port, username, host-key fingerprint and verification timestamps. The password is never returned.

## Run

```bash
cd control-center/team-api
npm install --omit=optional --ignore-scripts
npm test
node server.js
```

Default endpoint is `127.0.0.1:8091`.
