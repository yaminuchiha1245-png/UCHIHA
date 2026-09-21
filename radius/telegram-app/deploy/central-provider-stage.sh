#!/usr/bin/env bash
set -euo pipefail

RADIUS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="${RADIUS_DIR}/telegram-app"
INSTALL_DIR="/opt/uchiha-radius/telegram-app"
ETC_DIR="/etc/uchiha-radius"
STATE_DIR="/var/lib/uchiha-radius"

[[ "${EUID}" -eq 0 ]] || { echo "Run as root." >&2; exit 2; }

install -d -m 0755 "${INSTALL_DIR}" "${INSTALL_DIR}/web" "${INSTALL_DIR}/dist"
install -d -m 0700 -o uchiha-radius -g uchiha-radius "${STATE_DIR}"
install -d -m 0750 -o root -g uchiha-radius "${ETC_DIR}"

for src in "${APP_DIR}"/*.py; do
  install -m 0644 "$src" "${INSTALL_DIR}/$(basename "$src")"
done
install -m 0644 "${APP_DIR}/web/telegram-runtime-v101.js" "${INSTALL_DIR}/web/telegram-runtime-v101.js"

python3 "${APP_DIR}/build_telegram_webapp.py" \
  --source "${RADIUS_DIR}/RADIUS-A-Master-v101.html" \
  --runtime "${APP_DIR}/web/telegram-runtime-v101.js" \
  --output "${INSTALL_DIR}/dist/index.html" >/tmp/uchiha-radius-telegram-build.json

if [[ ! -s "${ETC_DIR}/credential.key" ]]; then
  python3 - <<'PY' >"${ETC_DIR}/credential.key"
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode())
PY
fi
chown uchiha-radius:uchiha-radius "${ETC_DIR}/credential.key"
chmod 0600 "${ETC_DIR}/credential.key"

if [[ ! -s "${ETC_DIR}/provider-csrf.secret" ]]; then
  python3 - <<'PY' >"${ETC_DIR}/provider-csrf.secret"
import secrets
print(secrets.token_urlsafe(48))
PY
fi
chmod 0600 "${ETC_DIR}/provider-csrf.secret"

if [[ ! -s "${ETC_DIR}/v37-gateway-hmac.secret" ]]; then
  echo "Missing v37 HMAC secret; run central-stage-install.sh first." >&2
  exit 3
fi
if [[ ! -s "${ETC_DIR}/dispatcher.token" ]]; then
  echo "Missing dispatcher token; run central-stage-install.sh first." >&2
  exit 3
fi

python3 - "${ETC_DIR}/provider.env" "${ETC_DIR}" <<'PY'
from pathlib import Path
import sys

env_path=Path(sys.argv[1])
etc=Path(sys.argv[2])
previous={}
if env_path.exists():
    for raw in env_path.read_text(errors="ignore").splitlines():
        line=raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key,value=raw.split("=",1)
        previous[key.strip()]=value.strip()

token=previous.get("TELEGRAM_BOT_TOKEN","")
owner=previous.get("UCHIHA_RADIUS_OWNER_TELEGRAM_ID","")
name=previous.get("UCHIHA_RADIUS_DEFAULT_PROVIDER_NAME","UCHIHA Provider")
code=previous.get("UCHIHA_RADIUS_DEFAULT_PROVIDER_CODE","UCHIHA")

csrf=(etc/"provider-csrf.secret").read_text().strip()
content=f"""# UCHIHA RADIUS central Telegram provider runtime
TELEGRAM_BOT_TOKEN={token}
UCHIHA_RADIUS_OWNER_TELEGRAM_ID={owner}
UCHIHA_RADIUS_DEFAULT_PROVIDER_NAME={name}
UCHIHA_RADIUS_DEFAULT_PROVIDER_CODE={code}
UCHIHA_RADIUS_PROVIDER_DB=/var/lib/uchiha-radius/provider.sqlite3
UCHIHA_RADIUS_PROVIDER_BIND=127.0.0.1
UCHIHA_RADIUS_PROVIDER_PORT=8788
UCHIHA_RADIUS_PUBLIC_ORIGIN=https://radius.uchiha-builder.com
UCHIHA_RADIUS_TELEGRAM_WEBAPP_URL=https://radius.uchiha-builder.com/telegram/
UCHIHA_RADIUS_TELEGRAM_AUTH_MAX_AGE=900
UCHIHA_RADIUS_SESSION_TTL=28800
UCHIHA_RADIUS_CREDENTIAL_KEY_FILE=/etc/uchiha-radius/credential.key
UCHIHA_RADIUS_PROVIDER_CSRF_SECRET={csrf}
UCHIHA_RADIUS_V37_BASE_URL=http://127.0.0.1:8792
UCHIHA_RADIUS_V37_HMAC_KEY_ID=telegram-provider
UCHIHA_RADIUS_V37_HMAC_SECRET_FILE=/etc/uchiha-radius/v37-gateway-hmac.secret
"""
env_path.write_text(content)
PY
chown root:root "${ETC_DIR}/provider.env"
chmod 0600 "${ETC_DIR}/provider.env"

DISPATCHER_TOKEN="$(cat "${ETC_DIR}/dispatcher.token")"
umask 077
cat >"${ETC_DIR}/dispatcher.env" <<EOF
UCHIHA_DISPATCHER_BIND=127.0.0.1
UCHIHA_DISPATCHER_PORT=8791
UCHIHA_DISPATCHER_WAIT_SECONDS=10
UCHIHA_DISPATCHER_V37_TOKEN=${DISPATCHER_TOKEN}
UCHIHA_RADIUS_PROVIDER_DB=/var/lib/uchiha-radius/provider.sqlite3
EOF
chmod 0600 "${ETC_DIR}/dispatcher.env"

install -m 0644 "${APP_DIR}/deploy/uchiha-radius-provider.service" /etc/systemd/system/
install -m 0644 "${APP_DIR}/deploy/uchiha-radius-telegram-bot.service" /etc/systemd/system/
install -m 0644 "${APP_DIR}/deploy/uchiha-radius-mikrotik-dispatcher.service" /etc/systemd/system/
systemctl daemon-reload

systemctl enable uchiha-radius-provider.service uchiha-radius-mikrotik-dispatcher.service
systemctl restart uchiha-radius-provider.service
systemctl restart uchiha-radius-mikrotik-dispatcher.service

TOKEN_PRESENT="$(python3 - <<'PY'
from pathlib import Path
vals={}
for raw in Path('/etc/uchiha-radius/provider.env').read_text().splitlines():
    line=raw.strip()
    if line and not line.startswith('#') and '=' in line:
        k,v=line.split('=',1); vals[k]=v
token=vals.get('TELEGRAM_BOT_TOKEN','').strip()
owner=vals.get('UCHIHA_RADIUS_OWNER_TELEGRAM_ID','').strip()
print('1' if token and owner.isdigit() and int(owner)>0 else '0')
PY
)"

if [[ "${TOKEN_PRESENT}" == "1" ]]; then
  systemctl enable uchiha-radius-telegram-bot.service
  systemctl restart uchiha-radius-telegram-bot.service
else
  systemctl disable uchiha-radius-telegram-bot.service >/dev/null 2>&1 || true
  systemctl stop uchiha-radius-telegram-bot.service >/dev/null 2>&1 || true
fi

sleep 1
systemctl is-active --quiet uchiha-radius-provider.service
systemctl is-active --quiet uchiha-radius-mikrotik-dispatcher.service
curl -fsS --max-time 3 http://127.0.0.1:8788/healthz >/tmp/uchiha-radius-provider-health.json

PYTHONPATH="${INSTALL_DIR}" python3 - <<'PY'
from v37_gateway import V37Gateway
g=V37Gateway.from_secret_file(
    "http://127.0.0.1:8792",
    key_id="telegram-provider",
    secret_file="/etc/uchiha-radius/v37-gateway-hmac.secret",
    public_host="radius.uchiha-builder.com",
)
r=g.request("GET","/api/connectors/radius/health",actor="central-stage-check",role="owner")
if r.status != 200 or r.json().get("ok") is not True:
    raise SystemExit("v37 gateway health check failed")
print("provider_api=active")
print("dispatcher=active")
print("v37_gateway=healthy")
PY

if [[ "${TOKEN_PRESENT}" == "1" ]]; then
  echo "telegram_bot=active"
else
  echo "telegram_bot=waiting-for-token-and-owner-id"
fi
echo "telegram_webapp=staged"
