#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
REPO_DIR="${UCHIHA_REPO_DIR:-$ROOT_DIR/repo}"
ENV_FILE="${UCHIHA_ENV_FILE:-$ROOT_DIR/.env}"
POSTGRES_CONTAINER="${UCHIHA_POSTGRES_CONTAINER:-uchiha-postgres}"
LATEST_MIGRATION="050_subscription_review_revalidation_guard"
SHOWCASE_TENANT_ID="00000000-0000-4000-8000-000000000101"
PUBLIC_RELEASE="2026.08.14.3"
FAILURES=0
WARNINGS=0

pass(){ printf 'PASS %s\n' "$*"; }
warn(){ printf 'WARN %s\n' "$*" >&2; WARNINGS=$((WARNINGS+1)); }
fail(){ printf 'FAIL %s\n' "$*" >&2; FAILURES=$((FAILURES+1)); }

[[ -r "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }
[[ -d "$REPO_DIR/.git" ]] || { echo "Missing repository at $REPO_DIR" >&2; exit 1; }
value(){ { grep -E "^$1=" "$ENV_FILE" 2>/dev/null || true; } | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
APP_HOST="$(value APP_HOST)"
BASE_DOMAIN="$(value BASE_DOMAIN)"
POSTGRES_USER="$(value POSTGRES_USER)"
POSTGRES_DB="$(value POSTGRES_DB)"
POSTGRES_PASSWORD="$(value POSTGRES_PASSWORD)"
BASE_URL="https://$APP_HOST"
DEMO_HOST="demo.$BASE_DOMAIN"

[[ -n "$APP_HOST" && -n "$BASE_DOMAIN" ]] || fail "APP_HOST or BASE_DOMAIN is missing"
[[ -n "$POSTGRES_USER" && -n "$POSTGRES_DB" && -n "$POSTGRES_PASSWORD" ]] || fail "PostgreSQL environment is incomplete"

http_code(){ curl -LsS --max-time 15 -o "$2" -w '%{http_code}' "$1" 2>/dev/null || printf '000'; }
fetch_text(){ curl -LsSf --max-time 15 "$1" 2>/dev/null || true; }

root_ip="$(getent ahostsv4 "$APP_HOST" 2>/dev/null | awk 'NR==1{print $1}')"
demo_ip="$(getent ahostsv4 "$DEMO_HOST" 2>/dev/null | awk 'NR==1{print $1}')"
[[ -n "$root_ip" ]] && pass "$APP_HOST resolves to $root_ip" || fail "$APP_HOST does not resolve"
[[ -n "$demo_ip" ]] && pass "$DEMO_HOST resolves to $demo_ip" || fail "wildcard DNS does not resolve demo"
[[ -n "$root_ip" && "$root_ip" == "$demo_ip" ]] && pass "root and wildcard DNS match" || fail "root and wildcard DNS differ"

headers="$(curl -sSI --max-time 15 "$BASE_URL/" 2>/dev/null || true)"
grep -qi '^strict-transport-security:' <<<"$headers" && pass "HSTS is enabled" || fail "HSTS is missing"
grep -qi '^content-security-policy:' <<<"$headers" && pass "CSP is enabled" || fail "CSP is missing"
grep -qi '^x-content-type-options: *nosniff' <<<"$headers" && pass "nosniff is enabled" || fail "nosniff is missing"
grep -qi '^cache-control:.*no-store' <<<"$headers" && pass "homepage caching is disabled" || fail "homepage is cacheable"
grep -qi '^x-uchiha-release: *2026\.08\.14\.3' <<<"$headers" && pass "HTTP release header matches RC2" || fail "HTTP release header is stale"

for path in / /login /register /create-store /account /services /payment-methods /contact /showcase /uchiha-api /platform-admin /store/demo /store/demo/support-chat /ready; do
  body="$(mktemp)"; code="$(http_code "$BASE_URL$path" "$body")"
  [[ "$code" == 200 ]] && pass "$path -> 200" || fail "$path -> HTTP $code"
  rm -f "$body"
done

home_html="$(fetch_text "$BASE_URL/?release=$PUBLIC_RELEASE")"
responsive_css="$(fetch_text "$BASE_URL/assets/v41-responsive.css?v=$PUBLIC_RELEASE")"
bridge_js="$(fetch_text "$BASE_URL/assets/v41-production-bridge.js?v=$PUBLIC_RELEASE")"
grep -q '<title>UCHIHA Platform</title>' <<<"$home_html" && pass "production root exposes UCHIHA production title" || fail "production root title is not production-ready"
! grep -q '<title>UCHIHA Platform — v41 Final Demo</title>' <<<"$home_html" && pass "production root no longer exposes demo browser title" || fail "production root still exposes demo browser title"
grep -q '<div class="app" id="app">' <<<"$home_html" && pass "v41 app shell is present" || fail "v41 app shell is missing"
grep -q 'id="bootLoader"' <<<"$home_html" && pass "v41 boot loader is present" || fail "v41 boot loader is missing"
grep -q 'function render()' <<<"$home_html" && pass "v41 visual runtime is present" || fail "v41 visual runtime is missing"
grep -q 'window.__UCHIHA_V41_RUNTIME__=Object.freeze' <<<"$home_html" && pass "v41 private production runtime adapter is injected" || fail "v41 private production runtime adapter is missing"
grep -q 'persistDemoState=function(){}' <<<"$home_html" && pass "v41 demo persistence is disabled in production" || fail "v41 demo persistence remains active"
grep -q 'chatUnreadCount=function(){return 0}' <<<"$home_html" && pass "v41 seeded demo chat is disabled" || fail "v41 seeded demo chat remains active"
grep -q "v41-responsive.css?v=$PUBLIC_RELEASE" <<<"$home_html" && pass "v41 responsive production layer is injected" || fail "v41 responsive production layer is missing"
grep -q "v41-production-bridge.js?v=$PUBLIC_RELEASE" <<<"$home_html" && pass "v41 production routing bridge is injected" || fail "v41 production routing bridge is missing"
grep -q 'max-width:none!important' <<<"$responsive_css" && grep -q '@media (min-width:1100px)' <<<"$responsive_css" && pass "v41 is full-screen and desktop responsive" || fail "v41 responsive CSS is stale or incomplete"
grep -q 'uchiha-platform-v19-demo' <<<"$bridge_js" && grep -q '"/create-store"' <<<"$bridge_js" && grep -q '"/platform-admin"' <<<"$bridge_js" && pass "v41 demo transactions are bridged to real production routes" || fail "v41 production bridge is stale or incomplete"
grep -q 'window.__UCHIHA_V41_RUNTIME__' <<<"$bridge_js" && grep -q '/api/platform/account' <<<"$bridge_js" && grep -q '/api/platform/orders' <<<"$bridge_js" && pass "v41 account and orders use the private production adapter" || fail "v41 production account hydration is missing"
grep -q '/api/public/portal' <<<"$bridge_js" && grep -q 'contact?.status !== "active"' <<<"$bridge_js" && pass "v41 contact buttons use active production portal contacts" || fail "v41 production contacts are stale"
grep -q '/api/auth/logout' <<<"$bridge_js" && grep -q '/api/me' <<<"$bridge_js" && grep -q 'x-csrf-token' <<<"$bridge_js" && pass "v41 logout is server-authoritative" || fail "v41 logout is still local-only"
grep -q 'link.href = "/assets/manifest.webmanifest"' <<<"$bridge_js" && grep -q 'navigator.serviceWorker' <<<"$bridge_js" && pass "v41 production PWA registration is present" || fail "v41 production PWA registration is incomplete"
grep -q '".cat>i{display:none!important}"' <<<"$bridge_js" && pass "v41 hard-coded demo catalog counts are hidden" || fail "v41 hard-coded demo catalog counts remain visible"

store_html="$(fetch_text "$BASE_URL/store/demo?release=$PUBLIC_RELEASE")"
store_responsive_css="$(fetch_text "$BASE_URL/assets/store-desktop-responsive.css?v=$PUBLIC_RELEASE")"
grep -q "store-desktop-responsive.css?v=$PUBLIC_RELEASE" <<<"$store_html" && pass "storefront desktop layer is injected" || fail "storefront desktop layer is missing"
! grep -q '2026.08.11.2' <<<"$store_html" && pass "storefront does not expose stale runtime asset versions" || fail "storefront exposes stale runtime asset versions"
grep -q -- '--reference-page-width:1360px' <<<"$store_responsive_css" && grep -q 'grid-template-columns:repeat(5,minmax(0,1fr))' <<<"$store_responsive_css" && pass "storefront is desktop responsive" || fail "storefront desktop responsive CSS is incomplete"

support_html="$(fetch_text "$BASE_URL/store/demo/support-chat?release=$PUBLIC_RELEASE")"
support_js="$(fetch_text "$BASE_URL/assets/support.js?v=$PUBLIC_RELEASE")"
grep -q 'support-chat-v2.css' <<<"$support_html" && grep -q 'type="file"' <<<"$support_html" && pass "support chat exposes attachment controls" || fail "support chat attachment UI is missing"
grep -q '/support-v2' <<<"$support_js" && grep -q 'unreadCount' <<<"$support_js" && grep -q 'attachmentPayload' <<<"$support_js" && pass "support chat UI uses v2 API, unread state and attachments" || fail "support chat v2 client is stale"

demo_body="$(mktemp)"; demo_code="$(http_code "https://$DEMO_HOST/" "$demo_body")"
[[ "$demo_code" == 200 ]] && pass "$DEMO_HOST -> 200" || fail "$DEMO_HOST -> HTTP $demo_code"
rm -f "$demo_body"

ready="$(fetch_text "$BASE_URL/ready")"
python3 - "$ready" "$LATEST_MIGRATION" <<'PY' && pass "persistent PostgreSQL readiness and latest schema are healthy" || fail "readiness/schema is degraded"
import json,sys
raw,latest=sys.argv[1:]
try: d=json.loads(raw)
except Exception: raise SystemExit(1)
ok=(d.get('persistent') is True and d.get('latestMigrationVersion') == latest and d.get('latestMigrationApplied') is True and int(d.get('migrationCount',0)) >= 50)
raise SystemExit(0 if ok else 1)
PY

builder_html="$(fetch_text "$BASE_URL/create-store?release=$PUBLIC_RELEASE")"
account_html="$(fetch_text "$BASE_URL/account?release=$PUBLIC_RELEASE")"
admin_html="$(fetch_text "$BASE_URL/platform-admin?release=$PUBLIC_RELEASE")"
payment_guard_js="$(fetch_text "$BASE_URL/assets/launch-payment-method-guard.js?v=$PUBLIC_RELEASE")"
renewal_js="$(fetch_text "$BASE_URL/assets/account-renewals.js?v=$PUBLIC_RELEASE")"
admin_sales_js="$(fetch_text "$BASE_URL/assets/launch-admin-sales.js?v=$PUBLIC_RELEASE")"
grep -q "launch-payment-method-guard.js?v=$PUBLIC_RELEASE" <<<"$builder_html" && pass "activation payment guard is injected" || fail "activation payment guard is missing"
grep -q "account-renewals.js?v=$PUBLIC_RELEASE" <<<"$account_html" && pass "customer renewal UI is injected" || fail "customer renewal UI is missing"
grep -q "launch-admin-sales.js?v=$PUBLIC_RELEASE" <<<"$admin_html" && pass "admin subscription sales UI is injected" || fail "admin subscription sales UI is missing"
grep -q "launch-admin-renewals.js?v=$PUBLIC_RELEASE" <<<"$admin_html" && pass "admin renewal review UI is injected" || fail "admin renewal review UI is missing"
grep -q 'minimumAmountMinor' <<<"$payment_guard_js" && grep -q 'maximumAmountMinor' <<<"$payment_guard_js" && pass "activation payment limits are enforced in UI" || fail "activation payment UI limits are stale"
grep -q 'minimumAmountMinor' <<<"$renewal_js" && grep -q 'maximumAmountMinor' <<<"$renewal_js" && pass "renewal payment limits are enforced in UI" || fail "renewal payment UI limits are stale"
grep -q '/api/platform/subscription-offer' <<<"$admin_sales_js" && pass "subscription offer is editable from platform admin" || fail "subscription offer admin editor is stale"

for endpoint in /api/subscription-status /api/subscription-offer /api/platform/subscription-requests /api/subscription-renewals /api/platform/subscription-renewals /api/public/stores/demo/support-v2; do
  body="$(mktemp)"; code="$(http_code "$BASE_URL$endpoint" "$body")"
  [[ "$code" == 401 ]] && pass "$endpoint rejects anonymous access" || fail "$endpoint anonymous HTTP is $code"
  rm -f "$body"
done

if docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
  dbq(){ docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "$1"; }
  admin_count="$(dbq "SELECT count(*) FROM platform_users WHERE is_platform_admin=TRUE AND status='active';" 2>/dev/null || echo 0)"
  offer_count="$(dbq "SELECT count(*) FROM subscription_offers WHERE sale_enabled=TRUE AND renewal_enabled=TRUE AND price_minor>0 AND renewal_price_minor>0 AND duration_count>0;" 2>/dev/null || echo 0)"
  ecommerce_service_count="$(dbq "SELECT count(*) FROM platform_services WHERE service_key='ecommerce-store' AND tenant_id IS NULL AND store_id IS NULL AND status='active';" 2>/dev/null || echo 0)"
  payment_count="$(dbq "SELECT count(*) FROM platform_payment_methods WHERE tenant_id IS NULL AND store_id IS NULL AND status='active' AND (account_identifier IS NOT NULL OR qr_data IS NOT NULL OR qr_image_url IS NOT NULL);" 2>/dev/null || echo 0)"
  demo_payment_count="$(dbq "SELECT count(*) FROM payment_methods pm JOIN stores s ON s.id=pm.store_id WHERE s.slug='demo' AND pm.status='active';" 2>/dev/null || echo 0)"
  failed_jobs="$(dbq "SELECT count(*) FROM provisioning_jobs WHERE status='failed' AND stage <> 'subscription_expired';" 2>/dev/null || echo 0)"
  latest_migration_count="$(dbq "SELECT count(*) FROM schema_migrations WHERE version='$LATEST_MIGRATION';" 2>/dev/null || echo 0)"
  payment_ref_index_count="$(dbq "SELECT count(*) FROM pg_indexes WHERE schemaname=current_schema() AND indexname='ux_subscription_payment_reference_live';" 2>/dev/null || echo 0)"
  support_attachment_table_count="$(dbq "SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='support_attachments';" 2>/dev/null || echo 0)"
  support_read_columns_count="$(dbq "SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='support_threads' AND column_name IN ('customer_last_read_at','staff_last_read_at');" 2>/dev/null || echo 0)"
  support_attachment_rls="$(dbq "SELECT CASE WHEN relrowsecurity THEN 1 ELSE 0 END FROM pg_class WHERE oid=to_regclass('support_attachments');" 2>/dev/null || echo 0)"
  subscription_binding_trigger_count="$(dbq "SELECT count(*) FROM pg_trigger WHERE tgname='trg_uchiha_lock_subscription_tenant_binding' AND tgenabled <> 'D';" 2>/dev/null || echo 0)"
  subscription_review_trigger_count="$(dbq "SELECT count(*) FROM pg_trigger WHERE tgname='trg_uchiha_revalidate_subscription_request_completion' AND tgenabled <> 'D';" 2>/dev/null || echo 0)"
  public_store_violations="$(dbq "SELECT count(*) FROM stores s JOIN tenants t ON t.id=s.tenant_id WHERE s.status IN ('active','ready') AND t.status <> 'active';" 2>/dev/null || echo 999)"
  bot_violations="$(dbq "SELECT count(*) FROM bot_connections bc JOIN tenants t ON t.id=bc.tenant_id WHERE bc.status='active' AND t.status <> 'active' AND NOT (t.status='connecting_bots' AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id=t.id AND s.status IN ('trial','active') AND s.ends_at>NOW()) AND EXISTS (SELECT 1 FROM provisioning_jobs j WHERE j.tenant_id=t.id AND j.store_id=bc.store_id AND j.job_type IN ('connect_bots','publish_store') AND j.status='running' AND j.claim_token IS NOT NULL AND j.lease_expires_at>NOW()));" 2>/dev/null || echo 999)"
  expired_subscription_violations="$(dbq "SELECT count(*) FROM subscriptions WHERE tenant_id IS NOT NULL AND status IN ('trial','active','past_due') AND ends_at <= NOW();" 2>/dev/null || echo 999)"
  active_tenant_without_subscription="$(dbq "SELECT count(*) FROM tenants t WHERE t.status='active' AND t.id <> '$SHOWCASE_TENANT_ID'::uuid AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id=t.id AND s.status IN ('trial','active') AND s.ends_at>NOW());" 2>/dev/null || echo 999)"
  duplicate_payment_references="$(dbq "SELECT count(*) FROM (SELECT metadata->>'paymentMethodId' AS method_id, lower(btrim(metadata->>'paymentReference')) AS reference FROM service_requests WHERE metadata->>'requestType' IN ('subscription_activation','subscription_renewal') AND COALESCE(metadata->>'paymentReference','')<>'' AND status NOT IN ('cancelled','rejected') GROUP BY 1,2 HAVING count(*)>1) d;" 2>/dev/null || echo 999)"
  subscription_payment_mismatches="$(dbq "SELECT count(*) FROM service_requests sr WHERE sr.metadata->>'requestType' IN ('subscription_activation','subscription_renewal') AND sr.status NOT IN ('completed','cancelled','rejected') AND (COALESCE(sr.metadata->>'amountMinor','') !~ '^[0-9]+$' OR NOT EXISTS (SELECT 1 FROM platform_payment_methods pm WHERE pm.id::text=sr.metadata->>'paymentMethodId' AND pm.tenant_id IS NULL AND pm.store_id IS NULL AND pm.status='active' AND (pm.account_identifier IS NOT NULL OR pm.qr_data IS NOT NULL OR pm.qr_image_url IS NOT NULL) AND upper(COALESCE(pm.currency,''))=upper(COALESCE(sr.metadata->>'currency','')) AND (pm.minimum_amount_minor IS NULL OR (CASE WHEN COALESCE(sr.metadata->>'amountMinor','') ~ '^[0-9]+$' THEN (sr.metadata->>'amountMinor')::bigint ELSE -1 END)>=pm.minimum_amount_minor) AND (pm.maximum_amount_minor IS NULL OR (CASE WHEN COALESCE(sr.metadata->>'amountMinor','') ~ '^[0-9]+$' THEN (sr.metadata->>'amountMinor')::bigint ELSE -1 END)<=pm.maximum_amount_minor)));" 2>/dev/null || echo 999)"

  [[ "$admin_count" =~ ^[1-9][0-9]*$ ]] && pass "active platform admin exists" || fail "no active platform admin"
  [[ "$offer_count" =~ ^[1-9][0-9]*$ ]] && pass "paid sellable and renewable offer exists" || fail "configure a paid sellable offer with renewal enabled"
  [[ "$ecommerce_service_count" =~ ^[1-9][0-9]*$ ]] && pass "ecommerce-store platform service exists" || fail "ecommerce-store platform service is missing"
  [[ "$payment_count" =~ ^[1-9][0-9]*$ ]] && pass "configured platform payment method exists" || fail "configure an active platform payment method"
  [[ "$demo_payment_count" == 0 ]] && pass "demo has no active real payment methods" || fail "demo has active payment methods"
  [[ "$latest_migration_count" == 1 ]] && pass "latest migration $LATEST_MIGRATION is applied" || fail "latest migration $LATEST_MIGRATION is missing"
  [[ "$payment_ref_index_count" == 1 ]] && pass "subscription payment references are race-safe unique" || fail "subscription payment reference unique index is missing"
  [[ "$support_attachment_table_count" == 1 ]] && pass "support attachment storage exists" || fail "support_attachments table is missing"
  [[ "$support_read_columns_count" == 2 ]] && pass "support customer/staff read state is present" || fail "support read-state columns are missing"
  [[ "$support_attachment_rls" == 1 ]] && pass "support attachments have tenant RLS enabled" || fail "support attachment RLS is disabled"
  [[ "$subscription_binding_trigger_count" == 1 ]] && pass "subscription tenant binding is immutable" || fail "subscription tenant binding trigger is missing"
  [[ "$subscription_review_trigger_count" == 1 ]] && pass "subscription payment approval is revalidated" || fail "subscription payment approval revalidation trigger is missing"
  [[ "$public_store_violations" == 0 ]] && pass "no public store belongs to an inactive tenant" || fail "$public_store_violations public stores violate tenant state"
  [[ "$bot_violations" == 0 ]] && pass "active bots are limited to active tenants or live leased provisioning" || fail "$bot_violations bot connections violate tenant/provisioning state"
  [[ "$expired_subscription_violations" == 0 ]] && pass "no expired subscription remains transaction-active" || fail "$expired_subscription_violations expired subscriptions remain active"
  [[ "$active_tenant_without_subscription" == 0 ]] && pass "every real active tenant has a live subscription" || fail "$active_tenant_without_subscription active tenants have no live subscription"
  [[ "$duplicate_payment_references" == 0 ]] && pass "no duplicated live subscription payment references" || fail "$duplicate_payment_references duplicated payment references require review"
  [[ "$subscription_payment_mismatches" == 0 ]] && pass "all pending subscription proofs match current payment currency and limits" || fail "$subscription_payment_mismatches pending subscription requests have stale or incompatible payment methods"
  [[ "$failed_jobs" == 0 ]] && pass "no failed provisioning jobs" || warn "$failed_jobs provisioning jobs require review"
else
  fail "PostgreSQL container is unavailable"
fi

for container in uchiha-postgres uchiha-api; do
  health="$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || true)"
  [[ "$health" == healthy ]] && pass "$container is healthy" || fail "$container health is ${health:-missing}"
done
for container in uchiha-worker uchiha-caddy; do
  running="$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || true)"
  [[ "$running" == true ]] && pass "$container is running" || fail "$container is not running"
done

systemctl is-active --quiet uchiha-backup.timer 2>/dev/null && pass "backup timer is active" || fail "backup timer is inactive"
latest_backup="$(find /var/backups/uchiha -maxdepth 1 -type f -name 'uchiha-*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2-)"
[[ -n "$latest_backup" ]] && pass "backup exists: $latest_backup" || fail "no PostgreSQL backup found"

branch="$(git -C "$REPO_DIR" branch --show-current)"
current="$(git -C "$REPO_DIR" rev-parse HEAD)"
remote="$(git -C "$REPO_DIR" rev-parse origin/builder/v1-platform 2>/dev/null || true)"
[[ "$branch" == builder/v1-platform ]] && pass "deployment branch is builder/v1-platform" || fail "deployment branch is $branch"
[[ -n "$remote" && "$current" == "$remote" ]] && pass "VPS SHA matches origin: $current" || fail "VPS SHA $current differs from origin ${remote:-unknown}"

if (( FAILURES > 0 )); then
  printf '\nLAUNCH BLOCKED: %d failure(s), %d warning(s).\n' "$FAILURES" "$WARNINGS" >&2
  exit 1
fi
printf '\nLAUNCH READY: 0 failures, %d warning(s).\n' "$WARNINGS"
