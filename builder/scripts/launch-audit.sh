#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
REPO_DIR="${UCHIHA_REPO_DIR:-$ROOT_DIR/repo}"
ENV_FILE="${UCHIHA_ENV_FILE:-$ROOT_DIR/.env}"
POSTGRES_CONTAINER="${UCHIHA_POSTGRES_CONTAINER:-uchiha-postgres}"
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

for path in / /login /create-store /account /services /payment-methods /contact /showcase /uchiha-api /platform-admin /store/demo /ready; do
  body="$(mktemp)"; code="$(http_code "$BASE_URL$path" "$body")"
  [[ "$code" == 200 ]] && pass "$path -> 200" || fail "$path -> HTTP $code"
  rm -f "$body"
done

demo_body="$(mktemp)"; demo_code="$(http_code "https://$DEMO_HOST/" "$demo_body")"
[[ "$demo_code" == 200 ]] && pass "$DEMO_HOST -> 200" || fail "$DEMO_HOST -> HTTP $demo_code"
rm -f "$demo_body"

ready="$(fetch_text "$BASE_URL/ready")"
python3 - "$ready" <<'PY' && pass "persistent PostgreSQL readiness is healthy" || fail "readiness is degraded"
import json,sys
try: d=json.loads(sys.argv[1])
except Exception: raise SystemExit(1)
raise SystemExit(0 if d.get('persistent') is True and int(d.get('migrationCount',0)) >= 22 else 1)
PY

builder_html="$(fetch_text "$BASE_URL/create-store")"
admin_html="$(fetch_text "$BASE_URL/platform-admin")"
customer_js="$(fetch_text "$BASE_URL/assets/launch-builder-sales.js")"
admin_js="$(fetch_text "$BASE_URL/assets/launch-admin-sales.js")"
grep -q 'launch-builder-sales.js' <<<"$builder_html" && pass "customer activation UI is injected" || fail "customer activation UI is missing"
grep -q 'launch-admin-sales.js' <<<"$admin_html" && pass "admin sales UI is injected" || fail "admin sales UI is missing"
grep -q '/api/subscription-requests' <<<"$customer_js" && pass "customer activation runtime is current" || fail "customer activation runtime is missing"
grep -q '/api/platform/subscription-requests' <<<"$admin_js" && pass "admin review runtime is current" || fail "admin review runtime is missing"

for endpoint in /api/subscription-status /api/platform/subscription-requests; do
  body="$(mktemp)"; code="$(http_code "$BASE_URL$endpoint" "$body")"
  [[ "$code" == 401 ]] && pass "$endpoint rejects anonymous access" || fail "$endpoint anonymous HTTP is $code"
  rm -f "$body"
done

if docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
  dbq(){ docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "$1"; }
  admin_count="$(dbq "SELECT count(*) FROM platform_users WHERE is_platform_admin=TRUE AND status='active';" 2>/dev/null || echo 0)"
  offer_count="$(dbq "SELECT count(*) FROM subscription_offers WHERE sale_enabled=TRUE AND price_minor>0 AND duration_count>0;" 2>/dev/null || echo 0)"
  payment_count="$(dbq "SELECT count(*) FROM platform_payment_methods WHERE tenant_id IS NULL AND store_id IS NULL AND status='active' AND (account_identifier IS NOT NULL OR qr_data IS NOT NULL OR qr_image_url IS NOT NULL);" 2>/dev/null || echo 0)"
  demo_payment_count="$(dbq "SELECT count(*) FROM payment_methods pm JOIN stores s ON s.id=pm.store_id WHERE s.slug='demo' AND pm.status='active';" 2>/dev/null || echo 0)"
  failed_jobs="$(dbq "SELECT count(*) FROM provisioning_jobs WHERE status='failed';" 2>/dev/null || echo 0)"
  [[ "$admin_count" =~ ^[1-9][0-9]*$ ]] && pass "active platform admin exists" || fail "no active platform admin"
  [[ "$offer_count" =~ ^[1-9][0-9]*$ ]] && pass "paid sellable offer exists" || fail "configure a paid sellable offer"
  [[ "$payment_count" =~ ^[1-9][0-9]*$ ]] && pass "configured platform payment method exists" || fail "configure an active platform payment method"
  [[ "$demo_payment_count" == 0 ]] && pass "demo has no active real payment methods" || fail "demo has active payment methods"
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
