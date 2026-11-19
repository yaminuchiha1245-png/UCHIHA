#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
REPO_DIR="${UCHIHA_REPO_DIR:-$ROOT_DIR/repo}"
ENV_FILE="${UCHIHA_ENV_FILE:-$ROOT_DIR/.env}"
[[ -r "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }
[[ -d "$REPO_DIR/.git" ]] || { echo "Missing repository at $REPO_DIR" >&2; exit 1; }

env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
APP_HOST="$(env_value APP_HOST)"
BASE_DOMAIN="$(env_value BASE_DOMAIN)"
BASE_URL="https://$APP_HOST"
PUBLIC_RELEASE="2026.08.14.3"
THEME_RELEASE="2026.08.15.1"
LATEST_MIGRATION="050_subscription_review_revalidation_guard"
EXPECTED_RELEASE_SHA="$(git -C "$REPO_DIR" rev-parse HEAD)"
[[ "$EXPECTED_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Repository HEAD is not a valid release SHA" >&2; exit 1; }

check() {
  local url="$1" expected="${2:-200}" code body
  body="$(mktemp)"
  code="$(curl -LsS -o "$body" --max-time 25 -w '%{http_code}' "$url" 2>/dev/null || printf '000')"
  if [[ "$code" != "$expected" ]]; then
    echo "$url returned HTTP $code" >&2
    cat "$body" >&2 || true
    rm -f "$body"
    exit 1
  fi
  rm -f "$body"
  printf 'PASS %s -> %s\n' "$url" "$code"
}

schedule_autodeploy_timer_self_heal() {
  local unit="uchiha-autodeploy-reenable-$(date -u +%s)-$$"
  if command -v systemd-run >/dev/null 2>&1; then
    systemd-run --quiet --unit="$unit" --on-active=20s \
      /bin/systemctl enable --now uchiha-autodeploy.timer >/dev/null 2>&1 || true
  else
    nohup bash -c 'sleep 20; systemctl enable --now uchiha-autodeploy.timer >/dev/null 2>&1 || true' \
      >/dev/null 2>&1 </dev/null &
  fi
}

for path in /ready / /create-store /login /account /services /payment-methods /orders /contact /uchiha-api /platform-admin /store/demo /store/demo/support-chat; do
  check "$BASE_URL$path"
done

HOME_HEADERS="$(mktemp)"
HOME_BODY="$(mktemp)"
SERVICES_BODY="$(mktemp)"
PAYMENT_METHODS_BODY="$(mktemp)"
ORDERS_BODY="$(mktemp)"
ACCOUNT_BODY="$(mktemp)"
BUILDER_BODY="$(mktemp)"
PORTAL_BODY="$(mktemp)"
READY_BODY="$(mktemp)"
STORE_BODY="$(mktemp)"
trap 'rm -f "$HOME_HEADERS" "$HOME_BODY" "$SERVICES_BODY" "$PAYMENT_METHODS_BODY" "$ORDERS_BODY" "$ACCOUNT_BODY" "$BUILDER_BODY" "$PORTAL_BODY" "$READY_BODY" "$STORE_BODY"' EXIT

curl -LfsS --max-time 25 -D "$HOME_HEADERS" "$BASE_URL/?release=$PUBLIC_RELEASE" -o "$HOME_BODY"
HOME_HTML="$(cat "$HOME_BODY")"
grep -qi '^cache-control:.*no-store' "$HOME_HEADERS" || { echo "Homepage is not protected by Cache-Control: no-store" >&2; exit 1; }
grep -q '<title>UCHIHA Builder</title>' <<<"$HOME_HTML" || { echo "Homepage does not expose UCHIHA Builder" >&2; exit 1; }
grep -q 'class="uchiha-v5"' <<<"$HOME_HTML" || { echo "Homepage is missing the production platform-v5 shell" >&2; exit 1; }
grep -q "platform-v5.css?v=$PUBLIC_RELEASE" <<<"$HOME_HTML" || { echo "Homepage is missing platform-v5 CSS" >&2; exit 1; }
grep -q "platform-v5.js?v=$PUBLIC_RELEASE" <<<"$HOME_HTML" || { echo "Homepage is missing platform-v5 runtime" >&2; exit 1; }
! grep -qi 'v41 Final Demo' <<<"$HOME_HTML" || { echo "Homepage still exposes the v41 demo title" >&2; exit 1; }
! grep -q 'v41-production-bridge' <<<"$HOME_HTML" || { echo "Homepage still injects the v41 production bridge" >&2; exit 1; }
! grep -q 'data-v41-production-pending' <<<"$HOME_HTML" || { echo "Homepage still carries v41 account state" >&2; exit 1; }
printf 'PASS UCHIHA Builder production homepage is active\n'

for spec in "/services:$SERVICES_BODY" "/payment-methods:$PAYMENT_METHODS_BODY" "/orders:$ORDERS_BODY"; do
  route="${spec%%:*}"
  output="${spec#*:}"
  curl -LfsS --max-time 25 "$BASE_URL$route?release=$PUBLIC_RELEASE" -o "$output"
  grep -q '<title>UCHIHA Builder</title>' "$output" || { echo "$route is not served by UCHIHA Builder" >&2; exit 1; }
  grep -q 'class="uchiha-v5"' "$output" || { echo "$route is missing the platform-v5 shell" >&2; exit 1; }
  grep -q "platform-v5.js?v=$PUBLIC_RELEASE" "$output" || { echo "$route is missing the production platform runtime" >&2; exit 1; }
  ! grep -q 'v41-production-bridge' "$output" || { echo "$route still injects v41" >&2; exit 1; }
done
printf 'PASS services, payment methods and orders are unified on the Builder shell\n'

curl -LfsS --max-time 25 "$BASE_URL/account?release=$PUBLIC_RELEASE" -o "$ACCOUNT_BODY"
grep -q "account-renewals.js?v=$PUBLIC_RELEASE" "$ACCOUNT_BODY" || { echo "Account renewal runtime is missing" >&2; exit 1; }
curl -LfsS --max-time 25 "$BASE_URL/create-store?release=$PUBLIC_RELEASE" -o "$BUILDER_BODY"
grep -q "platform-v5-builder.js?v=$PUBLIC_RELEASE" "$BUILDER_BODY" || { echo "Create-store wizard runtime is missing" >&2; exit 1; }
printf 'PASS account renewals and create-store wizard remain operational\n'

curl -LfsS --max-time 25 "$BASE_URL/api/public/portal" -o "$PORTAL_BODY"
python3 - "$PORTAL_BODY" <<'PY'
import json,sys
with open(sys.argv[1], 'r', encoding='utf-8') as handle:
    data=json.load(handle)
for key in ('services','paymentMethods','banners','contacts'):
    if not isinstance(data.get(key), list):
        raise SystemExit(f'portal field {key} is not a list')
if not data.get('services'):
    raise SystemExit('production portal exposes no services')
PY
printf 'PASS live portal exposes synchronized production collections\n'
# Production service submissions remain server-authoritative through /api/public/service-requests.

curl -LfsS --max-time 25 "$BASE_URL/store/demo?release=$PUBLIC_RELEASE" -o "$STORE_BODY"
grep -q "store-desktop-responsive.css?v=$PUBLIC_RELEASE" "$STORE_BODY" || { echo "Storefront desktop responsive layer is not injected" >&2; exit 1; }
THEME_JS="$(curl -LfsS --max-time 25 "$BASE_URL/assets/theme.js?v=$THEME_RELEASE")"
RECOVERY_JS="$(curl -LfsS --max-time 25 "$BASE_URL/assets/runtime-recovery.js?v=$PUBLIC_RELEASE")"
grep -q "var ASSET_VERSION = \"$THEME_RELEASE\"" <<<"$THEME_JS" || { echo "Storefront theme runtime is not on the current theme release" >&2; exit 1; }
grep -q "const RELEASE_VERSION = \"$PUBLIC_RELEASE\"" <<<"$RECOVERY_JS" || { echo "Runtime recovery cache owner is not on the current public release" >&2; exit 1; }
printf 'PASS storefront compatibility release owners are current\n'

curl -LfsS --max-time 25 "$BASE_URL/ready" -o "$READY_BODY"
python3 - "$READY_BODY" "$LATEST_MIGRATION" "$EXPECTED_RELEASE_SHA" <<'PY'
import json,sys
path,latest,expected_release=sys.argv[1:]
with open(path,'r',encoding='utf-8') as handle:
    data=json.load(handle)
if data.get('persistent') is not True:
    raise SystemExit('readiness is not persistent PostgreSQL')
if data.get('latestMigrationVersion') != latest:
    raise SystemExit(f"latest migration mismatch: {data.get('latestMigrationVersion')!r}")
if data.get('latestMigrationApplied') is not True:
    raise SystemExit('latest migration is not applied')
if int(data.get('migrationCount',0)) < 50:
    raise SystemExit('migration count is below launch baseline')
if data.get('releaseSha') != expected_release:
    raise SystemExit(f"live release mismatch: expected {expected_release}, got {data.get('releaseSha')!r}")
PY
printf 'PASS readiness reports latest migration %s\n' "$LATEST_MIGRATION"
printf 'PASS live release SHA matches repository HEAD %s\n' "$EXPECTED_RELEASE_SHA"

bash "$REPO_DIR/builder/scripts/deployment-data-integrity.sh"

docker inspect -f '{{.State.Health.Status}}' uchiha-postgres | grep -qx healthy
docker inspect -f '{{.State.Health.Status}}' uchiha-api | grep -qx healthy
docker inspect -f '{{.State.Running}}' uchiha-worker | grep -qx true
printf 'PASS containers healthy/running\n'

DEMO_HOST="demo.$BASE_DOMAIN"
if demo_code="$(curl -LsS -o /tmp/uchiha-demo-host --max-time 12 -w '%{http_code}' "https://$DEMO_HOST/" 2>/dev/null)" && [[ "$demo_code" == "200" ]]; then
  printf 'PASS optional demo host https://%s/ -> 200\n' "$DEMO_HOST"
else
  printf 'WARN optional demo host %s is not currently reachable; root deployment remains valid\n' "$DEMO_HOST" >&2
fi
rm -f /tmp/uchiha-demo-host

schedule_autodeploy_timer_self_heal
printf 'PASS autonomous VPS polling self-heal scheduled\n'
printf 'PASS root UCHIHA Builder production deployment acceptance gate\n'
