#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
ENV_FILE="${UCHIHA_ENV_FILE:-$ROOT_DIR/.env}"
[[ -r "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }

env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
APP_HOST="$(env_value APP_HOST)"
BASE_DOMAIN="$(env_value BASE_DOMAIN)"
BASE_URL="https://$APP_HOST"
PUBLIC_RELEASE="2026.08.14.2"
LATEST_MIGRATION="046_active_bot_provisioning_guard"

check() {
  local url="$1" expected="${2:-200}" code
  code="$(curl -LfsS -o /tmp/uchiha-smoke-body --max-time 25 -w '%{http_code}' "$url")"
  [[ "$code" == "$expected" ]] || { echo "$url returned HTTP $code" >&2; cat /tmp/uchiha-smoke-body >&2; exit 1; }
  printf 'PASS %s -> %s\n' "$url" "$code"
}

for path in /ready / /create-store /login /account /services /payment-methods /contact /uchiha-api /platform-admin /store/demo; do
  check "$BASE_URL$path"
done

HOME_HEADERS="$(mktemp)"
HOME_BODY="$(mktemp)"
BUILDER_BODY="$(mktemp)"
ACCOUNT_BODY="$(mktemp)"
ADMIN_BODY="$(mktemp)"
READY_BODY="$(mktemp)"
trap 'rm -f "$HOME_HEADERS" "$HOME_BODY" "$BUILDER_BODY" "$ACCOUNT_BODY" "$ADMIN_BODY" "$READY_BODY" /tmp/uchiha-smoke-body /tmp/uchiha-demo-host' EXIT
curl -LfsS --max-time 25 -D "$HOME_HEADERS" "$BASE_URL/?release=$PUBLIC_RELEASE" -o "$HOME_BODY"
HOME_HTML="$(cat "$HOME_BODY")"

grep -qi '^cache-control:.*no-store' "$HOME_HEADERS" || { echo "Homepage is not protected by Cache-Control: no-store" >&2; cat "$HOME_HEADERS" >&2; exit 1; }
grep -q '<title>UCHIHA Platform — v41 Final Demo</title>' <<<"$HOME_HTML" || { echo "Homepage is not the approved v41 document" >&2; exit 1; }
grep -q '<div class="app" id="app">' <<<"$HOME_HTML" || { echo "Homepage is missing the v41 application shell" >&2; exit 1; }
grep -q '<main id="main"></main>' <<<"$HOME_HTML" || { echo "Homepage is missing the v41 main view" >&2; exit 1; }
grep -q 'id="bootLoader"' <<<"$HOME_HTML" || { echo "Homepage is missing the v41 boot loader" >&2; exit 1; }
grep -q 'function render()' <<<"$HOME_HTML" || { echo "Homepage is missing the v41 runtime" >&2; exit 1; }
printf 'PASS exact UCHIHA Platform v41 homepage\n'

curl -LfsS --max-time 25 "$BASE_URL/create-store?release=$PUBLIC_RELEASE" -o "$BUILDER_BODY"
grep -q "launch-payment-method-guard.js?v=$PUBLIC_RELEASE" "$BUILDER_BODY" || { echo "Activation payment compatibility guard is not injected" >&2; exit 1; }
printf 'PASS activation payment compatibility guard\n'

curl -LfsS --max-time 25 "$BASE_URL/account?release=$PUBLIC_RELEASE" -o "$ACCOUNT_BODY"
grep -q "account-renewals.css?v=$PUBLIC_RELEASE" "$ACCOUNT_BODY" || { echo "Account renewal styles are not injected" >&2; exit 1; }
grep -q "account-renewals.js?v=$PUBLIC_RELEASE" "$ACCOUNT_BODY" || { echo "Account renewal runtime is not injected" >&2; exit 1; }
printf 'PASS account renewal launch assets\n'

curl -LfsS --max-time 25 "$BASE_URL/platform-admin?release=$PUBLIC_RELEASE" -o "$ADMIN_BODY"
grep -q "launch-admin-renewals.js?v=$PUBLIC_RELEASE" "$ADMIN_BODY" || { echo "Admin renewal review runtime is not injected" >&2; exit 1; }
printf 'PASS admin renewal launch asset\n'

curl -LfsS --max-time 25 "$BASE_URL/ready" -o "$READY_BODY"
python3 - "$READY_BODY" "$LATEST_MIGRATION" <<'PY'
import json,sys
path,latest=sys.argv[1:]
with open(path,'r',encoding='utf-8') as handle:
    data=json.load(handle)
if data.get('persistent') is not True:
    raise SystemExit('readiness is not persistent PostgreSQL')
if data.get('latestMigrationVersion') != latest:
    raise SystemExit(f"latest migration mismatch: {data.get('latestMigrationVersion')!r}")
if data.get('latestMigrationApplied') is not True:
    raise SystemExit('latest migration is not applied')
if int(data.get('migrationCount',0)) < 46:
    raise SystemExit('migration count is below launch baseline')
PY
printf 'PASS readiness reports latest migration %s\n' "$LATEST_MIGRATION"

DEMO_HOST="demo.$BASE_DOMAIN"
DEMO_CODE="$(curl -LfsS -o /tmp/uchiha-demo-host --max-time 30 -w '%{http_code}' "https://$DEMO_HOST/")"
[[ "$DEMO_CODE" == "200" ]] || { echo "$DEMO_HOST returned HTTP $DEMO_CODE" >&2; cat /tmp/uchiha-demo-host >&2; exit 1; }
grep -qi '<html' /tmp/uchiha-demo-host || { echo "Demo subdomain did not return HTML" >&2; exit 1; }
printf 'PASS https://%s/ -> 200 (canonical /store/demo)\n' "$DEMO_HOST"

docker inspect -f '{{.State.Health.Status}}' uchiha-postgres | grep -qx healthy
docker inspect -f '{{.State.Health.Status}}' uchiha-api | grep -qx healthy
docker inspect -f '{{.State.Running}}' uchiha-worker | grep -qx true
printf 'PASS containers healthy/running\n'