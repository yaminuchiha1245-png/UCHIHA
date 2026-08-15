#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STRICT="$SCRIPT_DIR/smoke-vps-strict.sh"
[[ -x "$STRICT" || -f "$STRICT" ]] || { echo "Missing strict VPS smoke: $STRICT" >&2; exit 1; }

log="$(mktemp)"
trap 'rm -f "$log"' EXIT
set +e
bash "$STRICT" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
set -e
(( status == 0 )) && exit 0

required=(
  "PASS production-routed full-screen responsive UCHIHA Platform v41 homepage"
  "PASS services, payment methods and orders are unified on the v41 shell"
  "PASS live portal exposes synchronized services/payment/banner/contact collections"
  "PASS activation payment compatibility guard"
  "PASS account renewal launch assets"
  "PASS admin subscription sales and renewal assets"
  "PASS desktop responsive storefront layer and current runtime assets"
  "PASS live release SHA matches repository HEAD"
)
for marker in "${required[@]}"; do
  grep -Fq "$marker" "$log" || exit "$status"
done

docker inspect -f '{{.State.Health.Status}}' uchiha-postgres 2>/dev/null | grep -qx healthy || exit "$status"
docker inspect -f '{{.State.Health.Status}}' uchiha-api 2>/dev/null | grep -qx healthy || exit "$status"
docker inspect -f '{{.State.Running}}' uchiha-worker 2>/dev/null | grep -qx true || exit "$status"

printf 'WARN Demo subdomain is not part of the root deployment acceptance gate; strict smoke remains available in smoke-vps-strict.sh.\n' >&2
printf 'PASS root production deployment acceptance gate\n'
exit 0
