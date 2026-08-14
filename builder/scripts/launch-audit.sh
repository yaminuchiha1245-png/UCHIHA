#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
REPO_DIR="${UCHIHA_REPO_DIR:-$ROOT_DIR/repo}"
ENV_FILE="${UCHIHA_ENV_FILE:-$ROOT_DIR/.env}"
POSTGRES_CONTAINER="${UCHIHA_POSTGRES_CONTAINER:-uchiha-postgres}"
LATEST_MIGRATION="040_tenant_bot_connection_guard"
PUBLIC_RELEASE="2026.08.14.1"
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

for path in / /login /create-store /account /services /payment-methods /contact /showcase /uchiha-api /platform-admin /store/demo /ready; do
  body="$(mktemp)"; code="$(http_code "$BASE_URL$path" "$body")"
  [[ "$code" == 200 ]] && pass "$path -> 200" || fail "$path -> HTTP $code"
  rm -f "$body"
done

home_html="$(fetch_text "$BASE_URL/?release=$PUBLIC_RELEASE")"
grep -q '<title>UCHIHA Platform — v41 Final Demo</title>' <<<"$home_html" && pass "production root is exact v41" || fail "production root is not approved v41"
grep -q '<div class="app" id="app">' <<<"$home_html" && pass "v41 app shell is present" || fail "v41 app shell is missing"
grep -q 'id="bootLoader"' <<<"$home_html" && pass "v41 boot loader is present" || fail "v41 boot loader is missing"
grep -q 'function render()' <<<"$home_html" && pass "v41 runtime is present" || fail "v41 runtime is missing"

demo_body="$(mktemp)"; demo_code="$(http_code "https://$DEMO_HOST/" "$demo_body")"
[[ "$demo_code" == 200 ]] && pass "$DEMO_HOST -> 200" || fail "$DEMO_HOST -> HTTP $demo_code"
rm -f "$demo_body"

ready="$(fetch_text "$BASE_URL/ready")"
python3 - "$ready" "$LATEST_MIGRATION" <<'PY' && pass "persistent PostgreSQL readiness and latest schema are healthy" || fail "readiness/schema is degraded"
import json,sys
raw,latest=sys.argv[1:]
try: d=json.loads(raw)
except Exception: raise SystemExit(1)
ok=(d.get('persistent') is True and d.get('latestMigrationVersion') == latest and d.get('latestMigrationApplied') is True and int(d.get('migrationCount',0)) >= 40)
raise SystemExit(0 if ok else 1)
PY

builder_html="$(fetch_text "$BASE_URL/create-store?release=$PUBLIC_RELEASE")"
account_html="$(fetch_text "$BASE_URL/account?release=$PUBLIC_RELEASE")"
admin_html="$(fetch_text "$BASE_URL/platform-admin?release=$PUBLIC_RELEASE")"
customer_js="$(fetch_text "$BASE_URL/assets/launch-builder-sales.js?v=$PUBLIC_RELEASE")"
admin_js="$(fetch_text "$BASE_URL/assets/launch-admin-sales.js?v=$PUBLIC_RELEASE")"
renewal_js="$(fetch_text "$BASE_URL/assets/account-renewals.js?v=$PUBLIC_RELEASE")"
admin_renewal_js="$(fetch_text "$BASE_URL/assets/launch-admin-renewals.js?v=$PUBLIC_RELEASE")"
grep -q 'launch-builder-sales.js' <<<"$builder_html" && pass "customer activation UI is injected" || fail "customer activation UI is missing"
grep -q 'launch-admin-sales.js' <<<"$admin_html" && pass "admin sales UI is injected" || fail "admin sales UI is missing"
grep -q 'account-renewals.js' <<<"$account_html" && pass "customer renewal UI is injected" || fail "customer renewal UI is missing"
grep -q 'launch-admin-renewals.js' <<<"$admin_html" && pass "admin renewal UI is injected" || fail "admin renewal UI is missing"
grep -q '/api/subscription-requests' <<<"$customer_js" && pass "customer activation runtime is current" || fail "customer activation runtime is missing"
grep -q '/api/platform/subscription-requests' <<<"$admin_js" && pass "admin activation review runtime is current" || fail "admin activation review runtime is missing"
grep -q '/api/subscription-renewals/' <<<"$renewal_js" && pass "customer renewal runtime is current" || fail "customer renewal runtime is missing"
grep -q '/api/platform/subscription-renewals/' <<<"$admin_renewal_js" && pass "admin renewal runtime is current" || fail "admin renewal runtime is missing"

for endpoint in /api/subscription-status /api/platform/subscription-requests /api/subscription-renewals /api/platform/subscription-renewals; do
  body="$(mktemp)"; code="$(http_code "$BASE_URL$endpoint" "$body")"
  [[ "$code" == 401 ]] && pass "$endpoint rejects anonymous access" || fail "$endpoint anonymous HTTP is $code"
  rm -f "$body"
done

if docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
  dbq(){ docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "$1"; }
  admin_count="$(dbq "SELECT count(*) FROM platform_users WHERE is_platform_admin=TRUE AND status='active';" 2>/dev/null || echo 0)"
  offer_count="$(dbq "SELECT count(*) FROM subscription_offers WHERE sale_enabled=TRUE AND renewal_enabled=TRUE AND price_minor>0 AND renewal_price_minor>0 AND duration_count>0;" 2>/dev/null || echo 0)"
  payment_count="$(dbq "SELECT count(*) FROM platform_payment_methods WHERE tenant_id IS NULL AND store_id IS NULL AND status='active' AND (account_identifier IS NOT NULL OR qr_data IS NOT NULL OR qr_image_url IS NOT NULL);" 2>/dev/null || echo 0)"
  demo_payment_count="$(dbq "SELECT count(*) FROM payment_methods pm JOIN stores s ON s.id=pm.store_id WHERE s.slug='demo' AND pm.status='active';" 2>/dev/null || echo 0)"
  failed_jobs="$(dbq "SELECT count(*) FROM provisioning_jobs WHERE status='failed' AND stage <> 'subscription_expired';" 2>/dev/null || echo 0)"
  latest_migration_count="$(dbq "SELECT count(*) FROM schema_migrations WHERE version='$LATEST_MIGRATION';" 2>/dev/null || echo 0)"
  public_store_violations="$(dbq "SELECT count(*) FROM stores s JOIN tenants t ON t.id=s.tenant_id WHERE s.status IN ('active','ready') AND t.status <> 'active';" 2>/dev/null || echo 999)"
  bot_violations="$(dbq "SELECT count(*) FROM bot_connections bc JOIN tenants t ON t.id=bc.tenant_id WHERE bc.status='active' AND t.status <> 'active';" 2>/dev/null || echo 999)"
  expired_subscription_violations="$(dbq "SELECT count(*) FROM subscriptions WHERE tenant_id IS NOT NULL AND status IN ('trial','active','past_due') AND ends_at <= NOW();" 2>/dev/null || echo 999)"
  [[ "$admin_count" =~ ^[1-9][0-9]*$ ]] && pass "active platform admin exists" || fail "no active platform admin"
  [[ "$offer_count" =~ ^[1-9][0-9]*$ ]] && pass "paid sellable and renewable offer exists" || fail "configure a paid sellable offer with renewal enabled"
  [[ "$payment_count" =~ ^[1-9][0-9]*$ ]] && pass "configured platform payment method exists" || fail "configure an active platform payment method"
  [[ "$demo_payment_count" == 0 ]] && pass "demo has no active real payment methods" || fail "demo has active payment methods"
  [[ "$latest_migration_count" == 1 ]] && pass "latest migration $LATEST_MIGRATION is applied" || fail "latest migration $LATEST_MIGRATION is missing"
  [[ "$public_store_violations" == 0 ]] && pass "no public store belongs to an inactive tenant" || fail "$public_store_violations public stores violate tenant state"
  [[ "$bot_violations" == 0 ]] && pass "no active bot belongs to an inactive tenant" || fail "$bot_violations bot connections violate tenant state"
  [[ "$expired_subscription_violations" == 0 ]] && pass "no expired subscription remains transaction-active" || fail "$expired_subscription_violations expired subscriptions remain active"
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