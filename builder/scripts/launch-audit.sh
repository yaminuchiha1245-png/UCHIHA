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
CONFIG_PENDING=0

pass(){ printf 'PASS %s\n' "$*"; }
warn(){ printf 'WARN %s\n' "$*" >&2; WARNINGS=$((WARNINGS+1)); }
fail(){ printf 'FAIL %s\n' "$*" >&2; FAILURES=$((FAILURES+1)); }
config_pending(){ printf 'CONFIG %s\n' "$*" >&2; CONFIG_PENDING=$((CONFIG_PENDING+1)); }

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
if [[ -n "$demo_ip" ]]; then
  pass "$DEMO_HOST resolves to $demo_ip"
  [[ -n "$root_ip" && "$root_ip" == "$demo_ip" ]] && pass "root and wildcard DNS match" || config_pending "demo/wildcard DNS differs from production root"
else
  config_pending "optional demo/wildcard DNS is not configured"
fi

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
grep -q 'window.__UCHIHA_V41_RUNTIME__=Object.freeze' <<<"$home_html" && pass "v41 private production runtime adapter is injected" || fail "v41 private production runtime adapter is missing"
grep -q 'persistDemoState=function(){}' <<<"$home_html" && pass "v41 demo persistence is disabled" || fail "v41 demo persistence remains active"
grep -q 'chatUnreadCount=function(){return 0}' <<<"$home_html" && pass "v41 seeded demo chat is disabled" || fail "v41 seeded demo chat remains active"
grep -q "v41-responsive.css?v=$PUBLIC_RELEASE" <<<"$home_html" && pass "v41 responsive layer is injected" || fail "v41 responsive layer is missing"
grep -q "v41-production-bridge.js?v=$PUBLIC_RELEASE" <<<"$home_html" && pass "v41 production bridge is injected" || fail "v41 production bridge is missing"
grep -q 'max-width:none!important' <<<"$responsive_css" && grep -q '@media (min-width:1100px)' <<<"$responsive_css" && pass "v41 is full-screen and desktop responsive" || fail "v41 responsive CSS is stale"
for token in '/api/public/portal' '/api/platform/account' '/api/platform/orders' '/api/public/service-requests' '/api/auth/logout' 'x-csrf-token' 'syncProductionBanners'; do
  grep -q "$token" <<<"$bridge_js" || fail "v41 production bridge is missing $token"
done
grep -q '".cat>i{display:none!important}"' <<<"$bridge_js" && pass "hard-coded demo service counts are hidden" || fail "hard-coded demo service counts remain visible"

support_html="$(fetch_text "$BASE_URL/store/demo/support-chat?release=$PUBLIC_RELEASE")"
support_js="$(fetch_text "$BASE_URL/assets/support.js?v=$PUBLIC_RELEASE")"
grep -q 'support-chat-v2.css' <<<"$support_html" && grep -q 'type="file"' <<<"$support_html" && pass "support chat attachment UI is present" || fail "support chat attachment UI is missing"
grep -q '/support-v2' <<<"$support_js" && grep -q 'unreadCount' <<<"$support_js" && grep -q 'attachmentPayload' <<<"$support_js" && pass "support chat v2 client is active" || fail "support chat v2 client is stale"

if demo_code="$(curl -LsS -o /tmp/uchiha-launch-demo --max-time 12 -w '%{http_code}' "https://$DEMO_HOST/" 2>/dev/null)" && [[ "$demo_code" == 200 ]]; then
  pass "$DEMO_HOST -> 200"
else
  config_pending "optional demo subdomain is not currently reachable"
fi
rm -f /tmp/uchiha-launch-demo

ready="$(fetch_text "$BASE_URL/ready")"
python3 - "$ready" "$LATEST_MIGRATION" "$(git -C "$REPO_DIR" rev-parse HEAD)" <<'PY' && pass "persistent PostgreSQL readiness, latest schema and exact release SHA are healthy" || fail "readiness/schema/release is degraded"
import json,sys
raw,latest,expected=sys.argv[1:]
try: d=json.loads(raw)
except Exception: raise SystemExit(1)
ok=(d.get('persistent') is True and d.get('latestMigrationVersion') == latest and d.get('latestMigrationApplied') is True and int(d.get('migrationCount',0)) >= 50 and d.get('releaseSha') == expected)
raise SystemExit(0 if ok else 1)
PY

subscription_offer_body="$(mktemp)"
subscription_offer_code="$(http_code "$BASE_URL/api/subscription-offer" "$subscription_offer_body")"
if [[ "$subscription_offer_code" == 200 ]]; then
  python3 - "$subscription_offer_body" <<'PY' && pass "/api/subscription-offer remains a public read-only sales endpoint" || fail "/api/subscription-offer returned invalid JSON"
import json,sys
with open(sys.argv[1], 'r', encoding='utf-8') as handle:
    payload=json.load(handle)
if 'offer' not in payload:
    raise SystemExit(1)
PY
else
  fail "/api/subscription-offer public HTTP is $subscription_offer_code"
fi
rm -f "$subscription_offer_body"

for endpoint in /api/subscription-status /api/platform/subscription-requests /api/subscription-renewals /api/platform/subscription-renewals /api/public/stores/demo/support-v2; do
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
  latest_migration_count="$(dbq "SELECT count(*) FROM schema_migrations WHERE version='$LATEST_MIGRATION';" 2>/dev/null || echo 0)"
  payment_ref_index_count="$(dbq "SELECT count(*) FROM pg_indexes WHERE schemaname=current_schema() AND indexname='ux_subscription_payment_reference_live';" 2>/dev/null || echo 0)"
  support_attachment_table_count="$(dbq "SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='support_attachments';" 2>/dev/null || echo 0)"
  support_read_columns_count="$(dbq "SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='support_threads' AND column_name IN ('customer_last_read_at','staff_last_read_at');" 2>/dev/null || echo 0)"
  support_attachment_rls="$(dbq "SELECT CASE WHEN relrowsecurity THEN 1 ELSE 0 END FROM pg_class WHERE oid=to_regclass('support_attachments');" 2>/dev/null || echo 0)"
  subscription_binding_trigger_count="$(dbq "SELECT count(*) FROM pg_trigger WHERE tgname='trg_uchiha_lock_subscription_tenant_binding' AND tgenabled <> 'D';" 2>/dev/null || echo 0)"
  subscription_review_trigger_count="$(dbq "SELECT count(*) FROM pg_trigger WHERE tgname='trg_uchiha_revalidate_subscription_request_completion' AND tgenabled <> 'D';" 2>/dev/null || echo 0)"
  public_store_violations="$(dbq "SELECT count(*) FROM stores s JOIN tenants t ON t.id=s.tenant_id WHERE s.status IN ('active','ready') AND t.status <> 'active';" 2>/dev/null || echo 999)"
  expired_subscription_violations="$(dbq "SELECT count(*) FROM subscriptions WHERE tenant_id IS NOT NULL AND status IN ('trial','active','past_due') AND ends_at <= NOW();" 2>/dev/null || echo 999)"
  active_tenant_without_subscription="$(dbq "SELECT count(*) FROM tenants t WHERE t.status='active' AND t.id <> '$SHOWCASE_TENANT_ID'::uuid AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id=t.id AND s.status IN ('trial','active') AND s.ends_at>NOW());" 2>/dev/null || echo 999)"
  duplicate_payment_references="$(dbq "SELECT count(*) FROM (SELECT metadata->>'paymentMethodId' AS method_id, lower(btrim(metadata->>'paymentReference')) AS reference FROM service_requests WHERE metadata->>'requestType' IN ('subscription_activation','subscription_renewal') AND COALESCE(metadata->>'paymentReference','')<>'' AND status NOT IN ('cancelled','rejected') GROUP BY 1,2 HAVING count(*)>1) d;" 2>/dev/null || echo 999)"
  subscription_payment_mismatches="$(dbq "SELECT count(*) FROM service_requests sr WHERE sr.metadata->>'requestType' IN ('subscription_activation','subscription_renewal') AND sr.status NOT IN ('completed','cancelled','rejected') AND (COALESCE(sr.metadata->>'amountMinor','') !~ '^[0-9]+$' OR NOT EXISTS (SELECT 1 FROM platform_payment_methods pm WHERE pm.id::text=sr.metadata->>'paymentMethodId' AND pm.tenant_id IS NULL AND pm.store_id IS NULL AND pm.status='active' AND (pm.account_identifier IS NOT NULL OR pm.qr_data IS NOT NULL OR pm.qr_image_url IS NOT NULL) AND upper(COALESCE(pm.currency,''))=upper(COALESCE(sr.metadata->>'currency',''))));" 2>/dev/null || echo 999)"
  failed_jobs="$(dbq "SELECT count(*) FROM provisioning_jobs WHERE status='failed' AND stage <> 'subscription_expired';" 2>/dev/null || echo 0)"

  [[ "$admin_count" =~ ^[1-9][0-9]*$ ]] && pass "active platform admin exists" || config_pending "create or reactivate a platform administrator"
  [[ "$offer_count" =~ ^[1-9][0-9]*$ ]] && pass "paid sellable and renewable offer exists" || config_pending "configure a paid sellable subscription offer"
  [[ "$payment_count" =~ ^[1-9][0-9]*$ ]] && pass "configured platform payment method exists" || config_pending "configure an active real platform payment method"
  [[ "$ecommerce_service_count" =~ ^[1-9][0-9]*$ ]] && pass "ecommerce-store platform service exists" || fail "ecommerce-store platform service is missing"
  [[ "$demo_payment_count" == 0 ]] && pass "demo has no active real payment methods" || fail "demo has active payment methods"
  [[ "$latest_migration_count" == 1 ]] && pass "latest migration $LATEST_MIGRATION is applied" || fail "latest migration $LATEST_MIGRATION is missing"
  [[ "$payment_ref_index_count" == 1 ]] && pass "subscription payment references are race-safe unique" || fail "subscription payment reference unique index is missing"
  [[ "$support_attachment_table_count" == 1 ]] && pass "support attachment storage exists" || fail "support_attachments table is missing"
  [[ "$support_read_columns_count" == 2 ]] && pass "support customer/staff read state is present" || fail "support read-state columns are missing"
  [[ "$support_attachment_rls" == 1 ]] && pass "support attachment RLS is enabled" || fail "support attachment RLS is disabled"
  [[ "$subscription_binding_trigger_count" == 1 ]] && pass "subscription tenant binding is immutable" || fail "subscription tenant binding trigger is missing"
  [[ "$subscription_review_trigger_count" == 1 ]] && pass "subscription payment approval is revalidated" || fail "subscription payment approval revalidation trigger is missing"
  [[ "$public_store_violations" == 0 ]] && pass "no public store belongs to an inactive tenant" || fail "$public_store_violations public stores violate tenant state"
  [[ "$expired_subscription_violations" == 0 ]] && pass "no expired subscription remains transaction-active" || fail "$expired_subscription_violations expired subscriptions remain active"
  [[ "$active_tenant_without_subscription" == 0 ]] && pass "every real active tenant has a live subscription" || fail "$active_tenant_without_subscription active tenants have no live subscription"
  [[ "$duplicate_payment_references" == 0 ]] && pass "no duplicated live subscription payment references" || fail "$duplicate_payment_references duplicated payment references require review"
  [[ "$subscription_payment_mismatches" == 0 ]] && pass "pending subscription proofs match active payment configuration" || fail "$subscription_payment_mismatches pending subscription requests have stale payment configuration"
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
  printf '\nLAUNCH BLOCKED: %d hard failure(s), %d owner-config item(s), %d warning(s).\n' "$FAILURES" "$CONFIG_PENDING" "$WARNINGS" >&2
  exit 1
fi
if (( CONFIG_PENDING > 0 )); then
  printf '\nDEPLOYMENT READY: 0 technical/security failures.\n'
  printf 'LAUNCH CONFIG PENDING: %d owner configuration item(s), %d warning(s).\n' "$CONFIG_PENDING" "$WARNINGS" >&2
  exit 0
fi
printf '\nLAUNCH READY: 0 failures, %d warning(s).\n' "$WARNINGS"
