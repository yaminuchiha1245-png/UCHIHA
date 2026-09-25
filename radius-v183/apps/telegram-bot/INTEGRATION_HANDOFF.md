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
