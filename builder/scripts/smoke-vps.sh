#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
ENV_FILE="${UCHIHA_ENV_FILE:-$ROOT_DIR/.env}"
[[ -r "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }

env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
APP_HOST="$(env_value APP_HOST)"
BASE_DOMAIN="$(env_value BASE_DOMAIN)"
BASE_URL="https://$APP_HOST"

check() {
  local url="$1" expected="${2:-200}" code
  code="$(curl -fsS -o /tmp/uchiha-smoke-body --max-time 25 -w '%{http_code}' "$url")"
  [[ "$code" == "$expected" ]] || { echo "$url returned HTTP $code" >&2; cat /tmp/uchiha-smoke-body >&2; exit 1; }
  printf 'PASS %s -> %s\n' "$url" "$code"
}

for path in /ready / /create-store /login /account /services /payment-methods /contact /uchiha-api /platform-admin /store/demo; do
  check "$BASE_URL$path"
done

HOME_HTML="$(curl -fsS --max-time 25 "$BASE_URL/")"
DEMO_SCRIPT="$(curl -fsS --max-time 25 "$BASE_URL/assets/preview-banner.js")"
grep -q '/assets/preview-banner.js' <<<"$HOME_HTML" || { echo "Homepage does not load demo-link script" >&2; exit 1; }
grep -q '/store/demo' <<<"$DEMO_SCRIPT" || { echo "Demo button script does not target /store/demo" >&2; exit 1; }
printf 'PASS demo button target\n'

DEMO_HOST="demo.$BASE_DOMAIN"
DEMO_CODE="$(curl -fsS -o /tmp/uchiha-demo-host --max-time 30 -w '%{http_code}' "https://$DEMO_HOST/")"
[[ "$DEMO_CODE" == "200" ]] || { echo "$DEMO_HOST returned HTTP $DEMO_CODE" >&2; cat /tmp/uchiha-demo-host >&2; exit 1; }
grep -qi '<html' /tmp/uchiha-demo-host || { echo "Demo subdomain did not return HTML" >&2; exit 1; }
printf 'PASS https://%s/ -> 200\n' "$DEMO_HOST"

docker inspect -f '{{.State.Health.Status}}' uchiha-postgres | grep -qx healthy
docker inspect -f '{{.State.Health.Status}}' uchiha-api | grep -qx healthy
docker inspect -f '{{.State.Running}}' uchiha-worker | grep -qx true
printf 'PASS containers healthy/running\n'
