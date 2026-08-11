#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
ENV_FILE="${UCHIHA_ENV_FILE:-$ROOT_DIR/.env}"
[[ -r "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }

env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
APP_HOST="$(env_value APP_HOST)"
BASE_DOMAIN="$(env_value BASE_DOMAIN)"
BASE_URL="https://$APP_HOST"
PUBLIC_RELEASE="2026.08.11.2"

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
trap 'rm -f "$HOME_HEADERS" "$HOME_BODY" /tmp/uchiha-smoke-body /tmp/uchiha-demo-host /tmp/uchiha-platform-client /tmp/uchiha-recovery-client /tmp/uchiha-stability-client' EXIT
curl -LfsS --max-time 25 -D "$HOME_HEADERS" "$BASE_URL/?release=$PUBLIC_RELEASE" -o "$HOME_BODY"
HOME_HTML="$(cat "$HOME_BODY")"

grep -qi '^cache-control:.*no-store' "$HOME_HEADERS" || { echo "Homepage is not protected by Cache-Control: no-store" >&2; cat "$HOME_HEADERS" >&2; exit 1; }
grep -q 'data-v5-static-fallback' <<<"$HOME_HTML" || { echo "Homepage does not contain the no-JavaScript fallback shell" >&2; exit 1; }
grep -q "platform-v5.js?v=$PUBLIC_RELEASE" <<<"$HOME_HTML" || { echo "Homepage does not reference platform-v5.js release $PUBLIC_RELEASE" >&2; exit 1; }
grep -q "platform-v5-stability.js?v=$PUBLIC_RELEASE" <<<"$HOME_HTML" || { echo "Homepage does not reference stability release $PUBLIC_RELEASE" >&2; exit 1; }
grep -q "platform-v5-polish.js?v=$PUBLIC_RELEASE" <<<"$HOME_HTML" || { echo "Homepage does not reference polish release $PUBLIC_RELEASE" >&2; exit 1; }
grep -q "platform-v5-recovery.js?v=$PUBLIC_RELEASE" <<<"$HOME_HTML" || { echo "Homepage does not reference recovery release $PUBLIC_RELEASE" >&2; exit 1; }
STABILITY_POSITION="$(grep -bo "platform-v5-stability.js?v=$PUBLIC_RELEASE" <<<"$HOME_HTML" | head -n1 | cut -d: -f1)"
POLISH_POSITION="$(grep -bo "platform-v5-polish.js?v=$PUBLIC_RELEASE" <<<"$HOME_HTML" | head -n1 | cut -d: -f1)"
[[ -n "$STABILITY_POSITION" && -n "$POLISH_POSITION" && "$STABILITY_POSITION" -lt "$POLISH_POSITION" ]] || { echo "Stability guard does not load before polish" >&2; exit 1; }
if grep -q 'class="v5-loading"' <<<"$HOME_HTML"; then
  echo "Homepage still ships the blocking loading-only document" >&2
  exit 1
fi

curl -LfsS --max-time 25 "$BASE_URL/assets/platform-v5.js?v=$PUBLIC_RELEASE" -o /tmp/uchiha-platform-client
curl -LfsS --max-time 25 "$BASE_URL/assets/platform-v5-recovery.js?v=$PUBLIC_RELEASE" -o /tmp/uchiha-recovery-client
curl -LfsS --max-time 25 "$BASE_URL/assets/platform-v5-stability.js?v=$PUBLIC_RELEASE" -o /tmp/uchiha-stability-client
grep -q 'async function init' /tmp/uchiha-platform-client || { echo "Live platform client is invalid or stale" >&2; exit 1; }
grep -q 'data-v5-recovery' /tmp/uchiha-recovery-client || { echo "Live recovery client is invalid or stale" >&2; exit 1; }
grep -q 'data-stable-close-label' /tmp/uchiha-stability-client || { echo "Live stability guard is invalid or stale" >&2; exit 1; }
printf 'PASS stable public shell release %s\n' "$PUBLIC_RELEASE"

DEMO_SCRIPT="$(curl -LfsS --max-time 25 "$BASE_URL/assets/preview-banner.js?v=$PUBLIC_RELEASE")"
grep -q '/assets/preview-banner.js' <<<"$HOME_HTML" || { echo "Homepage does not load demo-link script" >&2; exit 1; }
grep -q '/store/demo' <<<"$DEMO_SCRIPT" || { echo "Demo button script does not target /store/demo" >&2; exit 1; }
printf 'PASS demo button target\n'

DEMO_HOST="demo.$BASE_DOMAIN"
DEMO_CODE="$(curl -LfsS -o /tmp/uchiha-demo-host --max-time 30 -w '%{http_code}' "https://$DEMO_HOST/")"
[[ "$DEMO_CODE" == "200" ]] || { echo "$DEMO_HOST returned HTTP $DEMO_CODE" >&2; cat /tmp/uchiha-demo-host >&2; exit 1; }
grep -qi '<html' /tmp/uchiha-demo-host || { echo "Demo subdomain did not return HTML" >&2; exit 1; }
printf 'PASS https://%s/ -> 200 (canonical /store/demo)\n' "$DEMO_HOST"

docker inspect -f '{{.State.Health.Status}}' uchiha-postgres | grep -qx healthy
docker inspect -f '{{.State.Health.Status}}' uchiha-api | grep -qx healthy
docker inspect -f '{{.State.Running}}' uchiha-worker | grep -qx true
printf 'PASS containers healthy/running\n'
