# V1-83 MikroTik core: API contract
Branch: radius-v183/mikrotik-core. No UI changes or production deployment.

## Shared web and Telegram Mini App authentication
POST /api/v1/auth/telegram verifies Telegram initData; its bearer session uses
the same subscriber API as the web application. All tenant-scoped API requests
require Authorization: Bearer, validated X-Tenant-Id, and the configured
X-Installation-Id on production-bound sessions. Writes require Idempotency-Key
(8–128 characters). No tenant IDs from arbitrary request bodies are trusted.
GET /api/v1/auth/me returns verified user.id, displayName, avatarUrl, email,
tenantId, tenantName, tenantCurrency, memberships, role, permissions, canWrite.
An avatar is only present when the identity provider supplies it.

## Subscriber API
GET /api/v1/subscribers; GET /api/v1/subscribers/:id;
POST /api/v1/subscribers; PATCH /api/v1/subscribers/:id;
PUT /api/v1/subscribers/:id/credential; existing suspend, activate, renew.
POST body requires username and fullName; phone, planId, radiusPassword,
policyId, ipPoolId and advanced fields remain backwards compatible.
Optional accessProfile example:
{"speedDownMbps":55,"speedUpMbps":12,"dailyQuota":{"amount":2,"unit":"GB"},
"priceCurrency":"SYP","prices":{"USD":"12.50","SYP":"120000","TRY":"650.00"}}
priceCurrency is USD/SYP/TRY and its independent price is mandatory; all
prices are exact decimal strings. No automatic exchange rate. MB/GB mean
1,000,000 / 1,000,000,000 bytes. Absent/null dailyQuota inherits the plan.
PATCH accessProfile:null removes all overrides without deleting the plan.

## Billing policy
Balances and invoices remain in provider tenantCurrency. A subscriber quote
can generate an invoice only when prices includes that exact tenantCurrency.
Missing tenant-currency quote: scheduled billing skips the subscriber;
manual invoice requires an explicitly entered amountMinor in tenant currency.
No implicit FX or fallback to unrelated original plan amount; subscribers
without an accessProfile retain original plan-price billing.

## MikroTik / AAA state
GET /api/v1/devices/direct-capabilities;
GET /api/v1/devices/connection-diagnostics.
POST /api/v1/devices registers pending only. POST /:id/direct-preflight
checks network and verified TLS, NOT login. POST /:id/direct-connect
tests real authenticated RouterOS identity over API-SSL/HTTPS REST then
atomically stores encrypted credentials; stale concurrent tests get 409.
POST /:id/verify-direct rechecks and demotes same-site duplicate online
claims, not those belonging to unrelated tenants or other sites.
POST /:id/radius-readiness reads RouterOS RADIUS, PPPoE AAA and Hotspot
settings; its separate FreeRADIUS flag comes from server configuration.
GET /api/v1/radius/aaa-evidence?deviceId=dev_... reads HMAC-signed
accept/reject and accounting records; ambiguous NAS matches fail closed.
Verified management and configured AAA do not prove end-to-end access.

## Site Agent and release gates
Only explicit approved VPN CIDRs or tenant-local Site Agent can reach private
management IPs. TLS CA and identity are mandatory, with DNS pinning and
no insecure 8728 fallback. Issue signed Site Agent credential via owner-only
POST /api/v1/radius/credential over HTTPS; keep router passwords solely
in protected agent configuration, never in Telegram chat.
Agent outgoing connector paths: /connectors/radius/:tenantSlug/* use per-tenant
HMAC with nonce and timestamps. See infra/freeradius/README.md.
PostgreSQL migration 016_subscriber_access_profiles.sql requires
infra/postgres/runtime-grants.sql afterwards; never apply it to live DB
Migration 017 sets API-SSL port 8729 for new routers without modifying historical values; endpoint writes use tenant/site scoped transaction locks.
from this development branch. Existing PG integration test TRUNCATEs tables:
execute only against disposable test DB. Run freeradius -XC then actual
authorized lab radtest, PPPoE, Hotspot and accounting before promotion.
