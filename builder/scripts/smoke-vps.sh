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

for path in /ready / /create-store /login /account /services /payment-methods /orders /contact /uchiha-api /platform-admin /store/demo; do
  check "$BASE_URL$path"
done

HOME_HEADERS="$(mktemp)"
HOME_BODY="$(mktemp)"
SERVICES_BODY="$(mktemp)"
PAYMENT_METHODS_BODY="$(mktemp)"
ORDERS_BODY="$(mktemp)"
PORTAL_BODY="$(mktemp)"
READY_BODY="$(mktemp)"
RESPONSIVE_BODY="$(mktemp)"
BRIDGE_BODY="$(mktemp)"
STORE_BODY="$(mktemp)"
trap 'rm -f "$HOME_HEADERS" "$HOME_BODY" "$SERVICES_BODY" "$PAYMENT_METHODS_BODY" "$ORDERS_BODY" "$PORTAL_BODY" "$READY_BODY" "$RESPONSIVE_BODY" "$BRIDGE_BODY" "$STORE_BODY"' EXIT

curl -LfsS --max-time 25 -D "$HOME_HEADERS" "$BASE_URL/?release=$PUBLIC_RELEASE" -o "$HOME_BODY"
HOME_HTML="$(cat "$HOME_BODY")"
grep -qi '^cache-control:.*no-store' "$HOME_HEADERS" || { echo "Homepage is not protected by Cache-Control: no-store" >&2; exit 1; }
grep -q '<title>UCHIHA Platform</title>' <<<"$HOME_HTML" || { echo "Homepage does not expose the production UCHIHA title" >&2; exit 1; }
! grep -q '<title>UCHIHA Platform — v41 Final Demo</title>' <<<"$HOME_HTML" || { echo "Homepage still exposes the v41 demo title" >&2; exit 1; }
grep -q '<div class="app" id="app">' <<<"$HOME_HTML" || { echo "Homepage is missing the v41 application shell" >&2; exit 1; }
grep -q 'function render()' <<<"$HOME_HTML" || { echo "Homepage is missing the v41 visual runtime" >&2; exit 1; }
grep -q "v41-responsive.css?v=$PUBLIC_RELEASE" <<<"$HOME_HTML" || { echo "Homepage is missing v41 responsive CSS" >&2; exit 1; }
grep -q "v41-production-bridge.js?v=$PUBLIC_RELEASE" <<<"$HOME_HTML" || { echo "Homepage is missing v41 production bridge" >&2; exit 1; }

curl -LfsS --max-time 25 "$BASE_URL/assets/v41-responsive.css?v=$PUBLIC_RELEASE" -o "$RESPONSIVE_BODY"
curl -LfsS --max-time 25 "$BASE_URL/assets/v41-production-bridge.js?v=$PUBLIC_RELEASE" -o "$BRIDGE_BODY"
grep -q 'max-width:none!important' "$RESPONSIVE_BODY" || { echo "Responsive layer still limits the v41 shell" >&2; exit 1; }
grep -q '@media (min-width:1100px)' "$RESPONSIVE_BODY" || { echo "Responsive layer is missing desktop breakpoints" >&2; exit 1; }
for token in 'uchiha-platform-v19-demo' '"/create-store"' '"/platform-admin"' '/api/public/portal' '/api/platform/account' '/api/platform/orders' '/api/public/service-requests' 'idempotency-key' 'syncProductionBanners'; do
  grep -q "$token" "$BRIDGE_BODY" || { echo "Production bridge missing contract: $token" >&2; exit 1; }
done
printf 'PASS production-routed full-screen responsive UCHIHA Platform v41 homepage\n'

for spec in "/services:$SERVICES_BODY" "/payment-methods:$PAYMENT_METHODS_BODY" "/orders:$ORDERS_BODY"; do
  route="${spec%%:*}"
  output="${spec#*:}"
  curl -LfsS --max-time 25 "$BASE_URL$route?release=$PUBLIC_RELEASE" -o "$output"
  grep -q '<div class="app" id="app">' "$output" || { echo "$route is not served by the approved v41 shell" >&2; exit 1; }
  grep -q 'function render()' "$output" || { echo "$route is missing the v41 runtime" >&2; exit 1; }
  grep -q "v41-production-bridge.js?v=$PUBLIC_RELEASE" "$output" || { echo "$route is missing production synchronization" >&2; exit 1; }
done
printf 'PASS services, payment methods and orders are unified on the v41 shell\n'

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
printf 'PASS live portal exposes synchronized services/payment/banner/contact collections\n'

curl -LfsS --max-time 25 "$BASE_URL/store/demo?release=$PUBLIC_RELEASE" -o "$STORE_BODY"
grep -q "store-desktop-responsive.css?v=$PUBLIC_RELEASE" "$STORE_BODY" || { echo "Storefront desktop responsive layer is not injected" >&2; exit 1; }
! grep -q '2026.08.11.2' "$STORE_BODY" || { echo "Storefront exposes stale runtime assets" >&2; exit 1; }
printf 'PASS desktop responsive storefront layer and current runtime assets\n'

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

printf 'PASS root production deployment acceptance gate\n'
