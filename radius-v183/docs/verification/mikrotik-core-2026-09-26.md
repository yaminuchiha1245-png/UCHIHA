# V1-83 backend handoff to integration: 2026-09-26
Branch: radius-v183/mikrotik-core; base radius-v183-telegram-integration @ 7f460c4.
Development worktree: /opt/uchiha-radius/worktrees/mikrotik-core-v183/radius-v183

## Verified scope
- Secure RouterOS TLS API-SSL and HTTPS REST paths remain based on latest base branch.
- Authenticated identity is required before storing credentials or marking direct online.
- Register/verify rejects an intervening device update and retires same-site duplicates.
- No cross-tenant updates to registered devices or subscriber access profiles.
- Router endpoint writes use tenant/site-scoped PostgreSQL advisory locks and normalized
  host comparisons; stale online status is cleared when management credentials change.
- New routers default to encrypted API-SSL port 8729; legacy records are preserved.
- Independent MB/GB daily limits, down/up Mbps and explicit USD/SYP/TRY quotes.
- Read-only management readiness differs from signed RADIUS AAA/accounting evidence.
- Configured overlay speeds/quotas enter signed FreeRADIUS directory and quota enforcement.
- Invoices only use explicit prices in the tenant's currency; no implicit FX.
- Subscriber password rotation triggers a signed-agent directory refresh job.
- Existing account /api/v1/auth/me and web/Telegram Mini App API share scoped sessions.
- Sanitized subscriber update audit: no saved RADIUS ciphertext in before/after logs.

## Automated results on an isolated worktree
- Previous full npm test before this additional hardening: 183 passed, 0 failed, 1 skipped.
- Additional device-hardening regression tests: 4/4 passed after the changes.
- RouterOS direct subset: 14/14 passed.
- Provider workflow subset: 7/7 passed.
- Newly added profile/billing tests: 5/5 passed.
- Newly added stale-handshake/duplicate-registration tests: 3/3 passed.
- git diff --check passed before staging.
- [GitHub Actions run #36203178314](https://github.com/yaminuchiha1245-png/UCHIHA/actions/runs/36203178314) passed on Node.js 24 / PostgreSQL 16: full npm test, migrations 001–017, live schema default 8729, RLS test, and the destructive JavaScript PostgreSQL integration against a disposable CI database.
- freeradius -XC against already installed host config exited 0.

## Verified database evidence and outstanding release gates
- No authorized customer MikroTik router/TLS credentials or test NAS were supplied.
- Live RouterOS connection, subscriber radtest, PPPoE, Hotspot and NAS accounting
  MUST be proven by the deployer in a separate authorized lab before production.
- Verified PostgreSQL migrations 001 through 016 and runtime-grants.sql on a separate
  disposable PostgreSQL 16 container bound to localhost only. The new SQL RLS test passed:
  tenant A/B isolation, blocked cross-tenant writes and foreign keys, platform reads,
  backup read-only privileges. The fixtures were rolled back.
- The later cloud CI run independently applied migration 017 and passed its
  destructive PostgreSQL integration test. The earlier disposable VPS database was stopped.
- npm run check failed on unrelated owner-mobile generated missing assets:
  src/native-auth.js and src/capacitor-core.js. Do not edit UI in this branch.
- The default VPS Node v22.23.2 is below the declared >=24 engine requirement;
  a separate Node 24 runtime exists, and the isolated GitHub backend CI used Node 24.
- Do not deploy or run migration on production during integration review.

## Migration checklist
1. Merge reviewed branch after conflict check against concurrently developed UI/bot branches.
2. Apply PostgreSQL migrations 016 and 017 with the dedicated migrator; update
   runtime-grants.sql, then run infra/postgres/tests/016_subscriber_access_profiles_rls.sql
   against a disposable database only.
3. Cloud CI passed the full npm suite and destructive PG integration. Re-run the
   checks on the final combined merge commit, not on the production VPS.
4. Prepare owner-mobile native artifacts and rerun npm run check on Node >=24.
5. Commission private LAN/VPN/Site Agent; bind only approved router addresses.
6. Prove TLS CA, login identity, FreeRADIUS authentication and subscriber accounting.
7. Roll out via the designated release operator; no direct production changes here.
