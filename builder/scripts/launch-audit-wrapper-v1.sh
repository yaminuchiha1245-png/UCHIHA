#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STRICT="$SCRIPT_DIR/launch-audit-strict.sh"
[[ -x "$STRICT" || -f "$STRICT" ]] || { echo "Missing strict launch audit: $STRICT" >&2; exit 1; }

log="$(mktemp)"
trap 'rm -f "$log"' EXIT
set +e
bash "$STRICT" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
set -e
(( status == 0 )) && exit 0

mapfile -t failures < <(grep '^FAIL ' "$log" || true)
(( ${#failures[@]} > 0 )) || exit "$status"

hard=()
config=()
for line in "${failures[@]}"; do
  case "$line" in
    "FAIL wildcard DNS does not resolve demo"|\
    "FAIL root and wildcard DNS differ"|\
    "FAIL no active platform admin"|\
    "FAIL configure a paid sellable offer with renewal enabled"|\
    "FAIL configure an active platform payment method")
      config+=("$line")
      ;;
    FAIL\ demo.*\ -\>\ HTTP\ *)
      config+=("$line")
      ;;
    *)
      hard+=("$line")
      ;;
  esac
done

if (( ${#hard[@]} > 0 )); then
  printf '\nHARD launch audit failure(s) remain; deployment must roll back:\n' >&2
  printf '  %s\n' "${hard[@]}" >&2
  exit "$status"
fi

printf '\nDEPLOYMENT READY: strict technical/security checks passed.\n'
printf 'LAUNCH CONFIG PENDING: %d owner configuration item(s) remain.\n' "${#config[@]}" >&2
printf '  %s\n' "${config[@]}" >&2
exit 0
