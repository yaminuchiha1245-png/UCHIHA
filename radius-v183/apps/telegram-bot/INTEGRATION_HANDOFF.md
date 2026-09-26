# UCHIHA RADIUS V1-83 — Telegram merge handoff

Branch: radius-v183/telegram-simplify. Base: radius-v183-telegram-integration @ 7f460c4. Changes are limited to radius-v183/apps/telegram-bot. Do not restart or deploy the production bot from this branch.

## UI and privileges
The full-width first button opens the V1-83 Mini App dashboard. Primary native actions: add MikroTik, add subscriber, view subscribers, and invoice collection. Old owner-only management and operations remain in the platform-owner advanced menu. Provider members receive a separate role-filtered advanced menu; unlinked accounts see Telegram pairing instructions only.

## API contracts for the backend executor
- POST /api/v1/auth/telegram with fresh signed Telegram initData, GET /api/v1/auth/me returning tenantId, tenantName, role and canWrite. Existing single-use /auth/telegram-link/claim pairing stays in place. Every provider API call runs under that member's own session and server-selected tenant; never reuse the platform owner API.
- GET /devices, /devices/connection-diagnostics, POST /devices with name, host, apiPort=8729 and connectionMethod=agent. The bot checks duplicate host within the member's tenant before draft and again before confirmed create; server-side uniqueness and permissions remain authoritative. Registration is not proof of physical connectivity. The selected deviceId is handed to connect-mikrotik and site-agent WebApp routes without granting access.
- GET /subscribers?limit=7&offset=N, GET /subscribers?q=username&limit=20, GET /subscribers/:id, POST /subscribers with fullName and username, and an Idempotency-Key. The bot collects no subscriber passwords. The web and bot must use the same tenant-backed records and API.
- GET /invoices?limit=7&offset=N returning id, number, subscriberName, amountMinor, paidMinor, currency, status and pagination.total. POST /invoices/:id/payments uses amountMinor, method=cash, reason and Idempotency-Key, only after explicit confirmation and a fresh balance check. Verify backend permission policy for owner/admin/collector with canWrite=true.
- Native write roles: owner/admin for routers; owner/admin/operator for subscribers; owner/admin/collector for cash payments. Revalidate the server-issued role and tenant at confirmation; API must enforce this independently.

## Web and Telegram integration
Allowlisted WebApp URLs are rooted at https://radius.uchiha-builder.com/v183/. Stage-test dashboard, subscribers, invoices, mikrotik, site-agent, connect-mikrotik with selected deviceId, plans, sessions, reports, sites, support and Telegram pairing. The global bot menu button opens V1-83, never v101.
The welcome screen shows sender name, username and Telegram ID. The profile screen uses getUserProfilePhotos when available, falling back to the bundled assets/profile-default.png when absent or blocked. No permanent user-photo cache or external avatar service.

## Test and launch gate
Run python3 -m unittest discover -s apps/telegram-bot -p 'test_*.py' -v from radius-v183. The 58 local tests at handoff use mocked Telegram and tenant-scoped API responses. They cover the owner/provider menus, links, permissions and revocation, router duplicate checks, subscriber drafts and idempotent replay, payment overpayment prevention, and photo fallback.
Before production merge, run backend tests after API executor changes and validate one authorized staging account in a real Telegram Mini App. Physical MikroTik pairing, TLS/login verification, PPPoE/Hotspot AAA, and real cash receipt were not proven by these mocked tests. No changes to the production bot, service or live API were made from this branch.

## Follow-up: safe staging of the merged bot (2026-09-26)
The already merged PR #79 changed the Git checkout, **not** the running service. Read-only inspection found the production service still executes `/opt/uchiha-radius/telegram-v183/v183_screens.py`, and that directory currently lacks the new `v183_member_workflows.py` and `assets/profile-default.png`. Never copy only the old three Python files: the merged bot imports the new workflow module and needs the avatar asset.

From the merged V1-83 checkout, build a separate, credential-free bundle before any deployment:

```sh
python3 apps/telegram-bot/stage_bundle.py --output /tmp/uchiha-v183-bot-review
python3 apps/telegram-bot/stage_bundle.py --verify /tmp/uchiha-v183-bot-review
python3 -m unittest discover -s apps/telegram-bot -p 'test_*.py' -q
```

`stage_bundle.py` copies only five explicit runtime files; builds atomically to a new directory; validates every SHA-256 digest; imports the entire bot offline; rejects missing files, mutated bundles and the live bot path. It does not read bot tokens, overwrite an existing destination, configure Telegram, send API requests or restart services. Staging requires a previously unused output path each time. Following this hardening, **70 Python bot/staging/source-contract regression tests** pass locally. Four additional read-only source contract tests verify that every static bot WebApp route exists in the V1-83 web runtime, device deep links require an authenticated tenant-owned device, shared subscriber/payment/router API paths remain defined, and collectors cannot access sessions. One role-visibility fix prevents collectors from seeing the sessions shortcut, for which the backend grants no `session:read` permission. Keep the bot production restart and signed Telegram Mini App/live-router tests in the integration/release executor's hands.

### Latest combined-source QA (no deployment)
In a separate disposable Git worktree, combined bot hardening `2458cd7` with the UI executor's updated `8c0bf5d` and backend executor's updated `6137bf5`, without merge conflicts. Results on that exact combined tree: **70/70 bot Python tests, 10/10 UI tests, 25/25 focused backend/API tests**, and `node scripts/build-provider-v183.mjs server` produced a compiled release-style Mini App with the expected device deep links. An earlier, broader API suite on the preceding backend revision also passed **39/39**; do not describe that older run as a test of the newest backend commit. Test host runs Node v22.23.2, while the package declares Node >=24, so repeat release checks under Node 24 before approval. PostgreSQL migrations 016/017 need disposable DB verification; real signed Telegram app flow, router hardware, AAA and financial transactions remain unverified. No live bot files, production database or service were changed.

### Read-only post-deploy parity check (2026-09-26)
Use `python3 apps/telegram-bot/audit_live_bundle.py --bundle /tmp/uchiha-v183-bot-review` to compare the five allowlisted, verified staging files against `/opt/uchiha-radius/telegram-v183`. It only hashes those Python files and the bundled avatar. It deliberately never opens service environment files, extracts credentials, calls Telegram, copies files or restarts production. Structured JSON returns `match` (exit 0), `drift` (exit 1), or `invalid_bundle` (exit 2). A symlinked/missing deployment component fails closed. Six offline tests cover matching files, drift, missing files, unsafe symlinks and exit codes.

A first read-only audit after another executor's initial bot restart found 4/5 runtime files matched: live still exposed the sessions shortcut to collectors. During this QA pass another executor synchronized that remaining file. The latest direct audit returned **5/5 exact SHA-256 matches**; the collector shortcut fix is thus now present on disk in production. The bot workstream did not restart or modify production. A disk hash match does not establish real Telegram, router hardware, PPPoE/Hotspot or RADIUS accounting success.

### Isolated GitHub CI for the bot PR
The bot-only PR now includes `.github/workflows/radius-v183-telegram-bot.yml`. On pull requests targeting `radius-v183-telegram-integration` that touch bot, relevant Mini App, API route, contract or build files, it uses Python 3.10 and Node 24, `npm ci`, the entire offline bot regression suite (currently 76 tests), supported Mini App route tests, the V1-83 server bundle compiler and the credential-free five-file staging and offline live-parity auditor. It runs with read-only repository permissions and does not read production credentials, contact Telegram or restart the live service. A green result validates code and an isolated release bundle only; separately verify signed Telegram sessions, a real authorized MikroTik, live accounting, and production Node/runtime before release. Backend's dedicated workflow is responsible for PostgreSQL migrations, RLS and destructive tests against its disposable CI database.
