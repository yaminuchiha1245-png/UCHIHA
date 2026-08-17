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
UI_RELEASE="v60"
V60_RUNTIME="/platform-v60.js?v=60.0.0"
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

for path in /ready / /create-store /login /account /services /payment-methods /orders /contact /uchiha-api /platform-admin /store/demo /store/demo/support-chat; do
  check "$BASE_URL$path"
done

HOME_HEADERS="$(mktemp)"
HOME_BODY="$(mktemp)"
SERVICES_HEADERS="$(mktemp)"
SERVICES_BODY="$(mktemp)"
PAYMENT_HEADERS="$(mktemp)"
PAYMENT_METHODS_BODY="$(mktemp)"
ORDERS_HEADERS="$(mktemp)"
ORDERS_BODY="$(mktemp)"
ACCOUNT_BODY="$(mktemp)"
BUILDER_BODY="$(mktemp)"
PORTAL_BODY="$(mktemp)"
READY_BODY="$(mktemp)"
STORE_BODY="$(mktemp)"
trap 'rm -f "$HOME_HEADERS" "$HOME_BODY" "$SERVICES_HEADERS" "$SERVICES_BODY" "$PAYMENT_HEADERS" "$PAYMENT_METHODS_BODY" "$ORDERS_HEADERS" "$ORDERS_BODY" "$ACCOUNT_BODY" "$BUILDER_BODY" "$PORTAL_BODY" "$READY_BODY" "$STORE_BODY"' EXIT

curl -LfsS --max-time 25 -D "$HOME_HEADERS" "$BASE_URL/?release=$UI_RELEASE" -o "$HOME_BODY"
HOME_HTML="$(cat "$HOME_BODY")"
grep -qi '^cache-control:.*no-store' "$HOME_HEADERS" || { echo "Homepage is not protected by Cache-Control: no-store" >&2; exit 1; }
grep -qi '^x-uchiha-ui-release:.*v60' "$HOME_HEADERS" || { echo "Homepage does not advertise V60" >&2; exit 1; }
grep -q '<title>UCHIHA Builder</title>' <<<"$HOME_HTML" || { echo "Homepage does not expose UCHIHA Builder" >&2; exit 1; }
grep -q 'name="uchiha-release" content="V60-VPS-2026.08.17"' <<<"$HOME_HTML" || { echo "Homepage is missing the V60 release marker" >&2; exit 1; }
grep -q '/platform-v60.js?v=60.0.0' <<<"$HOME_HTML" || { echo "Homepage is missing the V60 runtime" >&2; exit 1; }
! grep -q 'platform-v5.js?v=' <<<"$HOME_HTML" || { echo "Homepage still serves platform-v5 as the primary runtime" >&2; exit 1; }
! grep -qi 'v41 Final Demo' <<<"$HOME_HTML" || { echo "Homepage still exposes the v41 demo title" >&2; exit 1; }
printf 'PASS UCHIHA Builder V60 production homepage is active\n'

for spec in "/services:$SERVICES_HEADERS:$SERVICES_BODY" "/payment-methods:$PAYMENT_HEADERS:$PAYMENT_METHODS_BODY" "/orders:$ORDERS_HEADERS:$ORDERS_BODY"; do
  route="${spec%%:*}"; rest="${spec#*:}"; headers="${rest%%:*}"; output="${rest#*:}"
  curl -LfsS --max-time 25 -D "$headers" "$BASE_URL$route?release=$UI_RELEASE" -o "$output"
  grep -qi '^x-uchiha-ui-release:.*v60' "$headers" || { echo "$route is not marked as V60" >&2; exit 1; }
  grep -q '<title>UCHIHA Builder</title>' "$output" || { echo "$route is not served by UCHIHA Builder" >&2; exit 1; }
  grep -q '/platform-v60.js?v=60.0.0' "$output" || { echo "$route is missing the V60 runtime" >&2; exit 1; }
done
printf 'PASS services, payment methods and orders use the V60 shell\n'

# Operational Builder surfaces stay on their proven UI until V60 has full feature parity.
curl -LfsS --max-time 25 "$BASE_URL/account?release=$PUBLIC_RELEASE" -o "$ACCOUNT_BODY"
grep -q "account-renewals.js?v=$PUBLIC_RELEASE" "$ACCOUNT_BODY" || { echo "Account renewal runtime was lost during the V60 swap" >&2; exit 1; }
curl -LfsS --max-time 25 "$BASE_URL/create-store?release=$PUBLIC_RELEASE" -o "$BUILDER_BODY"
grep -q "platform-v5-builder.js?v=$PUBLIC_RELEASE" "$BUILDER_BODY" || { echo "Create-store wizard runtime was lost during the V60 swap" >&2; exit 1; }
printf 'PASS account renewals and create-store wizard remain operational\n'

V60_JS_HEADERS="$(mktemp)"; trap 'rm -f "$HOME_HEADERS" "$HOME_BODY" "$SERVICES_HEADERS" "$SERVICES_BODY" "$PAYMENT_HEADERS" "$PAYMENT_METHODS_BODY" "$ORDERS_HEADERS" "$ORDERS_BODY" "$ACCOUNT_BODY" "$BUILDER_BODY" "$PORTAL_BODY" "$READY_BODY" "$STORE_BODY" "$V60_JS_HEADERS"' EXIT
curl -LfsS --max-time 25 -D "$V60_JS_HEADERS" "$BASE_URL$V60_RUNTIME" -o /dev/null
grep -qi '^x-uchiha-ui-release:.*v60' "$V60_JS_HEADERS" || { echo "V60 runtime endpoint is missing release header" >&2; exit 1; }
grep -qi '^cache-control:.*immutable' "$V60_JS_HEADERS" || { echo "V60 runtime is missing immutable cache policy" >&2; exit 1; }
printf 'PASS V60 runtime endpoint is live\n'

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

curl -LfsS --max-time 25 "$BASE_URL/store/demo?release=$PUBLIC_RELEASE" -o "$STORE_BODY"
grep -q "store-desktop-responsive.css?v=$PUBLIC_RELEASE" "$STORE_BODY" || { echo "Storefront desktop responsive layer is not injected" >&2; exit 1; }
THEME_JS="$(curl -LfsS --max-time 25 "$BASE_URL/assets/theme.js?v=$PUBLIC_RELEASE")"
RECOVERY_JS="$(curl -LfsS --max-time 25 "$BASE_URL/assets/runtime-recovery.js?v=$PUBLIC_RELEASE")"
grep -q "var ASSET_VERSION = \"$PUBLIC_RELEASE\"" <<<"$THEME_JS" || { echo "Storefront theme runtime is not on the current legacy asset release" >&2; exit 1; }
grep -q "const RELEASE_VERSION = \"$PUBLIC_RELEASE\"" <<<"$RECOVERY_JS" || { echo "Runtime recovery cache owner is not on the current legacy asset release" >&2; exit 1; }
printf 'PASS storefront compatibility assets remain current\n'

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

printf 'PASS root UCHIHA Builder V60 production deployment acceptance gate\n'
