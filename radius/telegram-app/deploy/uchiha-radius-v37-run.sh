#!/usr/bin/env bash
set -euo pipefail

BACKEND="${UCHIHA_RADIUS_V37_BACKEND:-/opt/uchiha-radius/current/RADIUS-A-Connector-Backend-v37.py}"
HMAC_FILE="${UCHIHA_CONNECTOR_GATEWAY_HMAC_SECRET_FILE:-/etc/uchiha-radius/v37-gateway-hmac.secret}"
MIKROTIK_TOKEN_FILE="${UCHIHA_MIKROTIK_TOKEN_FILE:-/etc/uchiha-radius/dispatcher.token}"

[[ -r "$BACKEND" ]] || { echo "Backend v37 is not readable" >&2; exit 78; }
[[ -r "$HMAC_FILE" ]] || { echo "Gateway HMAC secret file is not readable" >&2; exit 78; }
[[ -r "$MIKROTIK_TOKEN_FILE" ]] || { echo "MikroTik dispatcher token file is not readable" >&2; exit 78; }

export UCHIHA_CONNECTOR_GATEWAY_HMAC_SECRET
UCHIHA_CONNECTOR_GATEWAY_HMAC_SECRET="$(tr -d '\r\n' <"$HMAC_FILE")"
export UCHIHA_MIKROTIK_TOKEN
UCHIHA_MIKROTIK_TOKEN="$(tr -d '\r\n' <"$MIKROTIK_TOKEN_FILE")"

[[ ${#UCHIHA_CONNECTOR_GATEWAY_HMAC_SECRET} -ge 24 ]] || {
  echo "Gateway HMAC secret is too short" >&2
  exit 78
}
[[ ${#UCHIHA_MIKROTIK_TOKEN} -ge 24 ]] || {
  echo "Dispatcher token is too short" >&2
  exit 78
}

exec /usr/bin/python3 -S -B "$BACKEND" "$@"
