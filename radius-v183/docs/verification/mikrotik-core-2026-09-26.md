# V1-83 backend handoff to integration: 2026-09-26
Branch: radius-v183/mikrotik-core; base radius-v183-telegram-integration @ 7f460c4.
Development worktree: /opt/uchiha-radius/worktrees/mikrotik-core-v183/radius-v183

## Verified scope
- Secure RouterOS TLS API-SSL and HTTPS REST paths remain based on latest base branch.
- Authenticated identity is required before storing credentials or marking direct online.
- Register/verify rejects an intervening device update and retires same-site duplicates.
- No cross-tenant updates to registered devices or subscriber access profiles.
- Independent MB/GB daily limits, down/up Mbps and explicit USD/SYP/TRY quotes.
- Read-only management readiness differs from signed RADIUS AAA/accounting evidence.
- Configured overlay speeds/quotas enter signed FreeRADIUS directory and quota enforcement.
- Invoices only use explicit prices in the tenant's currency; no implicit FX.
- Subscriber password rotation triggers a signed-agent directory refresh job.
- Existing account /api/v1/auth/me and web/Telegram Mini App API share scoped sessions.
- Sanitized subscriber update audit: no saved RADIUS ciphertext in before/after logs.

## Automated results on an isolated worktree
- Final full npm test: 183 passed, 0 failed, 1 skipped (PostgreSQL destructive integration).
- RouterOS direct subset: 14/14 passed.
- Provider workflow subset: 7/7 passed.
- Newly added profile/billing tests: 5/5 passed.
- Newly added stale-handshake/duplicate-registration tests: 3/3 passed.
- git diff --check passed before staging.
- freeradius -XC against already installed host config exited 0.

## Explicitly unverified / blockers
- No authorized customer MikroTik router/TLS credentials or test NAS were supplied.
- Live RouterOS connection, subscriber radtest, PPPoE, Hotspot and NAS accounting
  MUST be proven by the deployer in a separate authorized lab before production.
- PostgreSQL migration / RLS destructive test was NOT run: the existing PG test
  TRUNCATEs multiple tables and there is no approved disposable test database.
- npm run check failed on unrelated owner-mobile generated missing assets:
  src/native-auth.js and src/capacitor-core.js. Do not edit UI in this branch.
- Server node v22.23.2 is below declared >=24 engine requirement.
- Do not deploy or run migration on production during integration review.

## Migration checklist
1. Merge reviewed branch after conflict check against concurrently developed UI/bot branches.
2. Run PostgreSQL migration 016 with dedicated migrator; then runtime-grants.sql.
3. Run npm test and destructive PG integration only against disposable isolated PG.
4. Prepare owner-mobile native artifacts and rerun npm run check on Node >=24.
5. Commission private LAN/VPN/Site Agent; bind only approved router addresses.
6. Prove TLS CA, login identity, FreeRADIUS authentication and subscriber accounting.
7. Roll out via the designated release operator; no direct production changes here.
