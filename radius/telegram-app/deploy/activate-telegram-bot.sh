#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/etc/uchiha-radius/provider.env"
TOKEN_FILE=""
OWNER_ID=""
PUBLIC_HOST="${UCHIHA_RADIUS_PUBLIC_HOST:-radius.uchiha-builder.com}"

usage() {
  cat <<'EOF'
Activate the dedicated UCHIHA RADIUS Telegram bot.

Usage:
  activate-telegram-bot.sh --token-file PATH --owner-id TELEGRAM_ID

The token file is preferred so the bot token does not appear in shell history
or process arguments. The script validates the token with Telegram, writes only
the required values into the existing provider environment, restarts the
provider API and bot, and verifies the bot service.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token-file) TOKEN_FILE="$2"; shift 2;;
    --owner-id) OWNER_ID="$2"; shift 2;;
    --public-host) PUBLIC_HOST="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
done

[[ "${EUID}" -eq 0 ]] || { echo "Run as root." >&2; exit 2; }
[[ -f "${ENV_FILE}" ]] || { echo "Missing provider environment: ${ENV_FILE}" >&2; exit 3; }
[[ -n "${TOKEN_FILE}" && -s "${TOKEN_FILE}" ]] || { echo "A non-empty --token-file is required." >&2; exit 3; }
[[ "${OWNER_ID}" =~ ^[0-9]+$ && "${OWNER_ID}" -gt 0 ]] || { echo "A positive numeric --owner-id is required." >&2; exit 3; }

TOKEN="$(tr -d '\r\n' <"${TOKEN_FILE}")"
[[ "${TOKEN}" == *:* && ${#TOKEN} -ge 20 ]] || { echo "Telegram bot token format is invalid." >&2; exit 3; }

python3 - "${TOKEN}" <<'PY'
import json, sys, urllib.error, urllib.request
token=sys.argv[1]
try:
    with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/getMe",timeout=10) as response:
        data=json.load(response)
except Exception as exc:
    raise SystemExit(f"Telegram token validation failed: {type(exc).__name__}")
if data.get("ok") is not True or not (data.get("result") or {}).get("id"):
    raise SystemExit("Telegram token was rejected")
result=data["result"]
print("telegram_bot_valid=yes")
print("telegram_bot_username="+str(result.get("username") or ""))
PY

cp -a "${ENV_FILE}" "${ENV_FILE}.before-telegram-activation"
chmod 0600 "${ENV_FILE}.before-telegram-activation"

python3 - "${ENV_FILE}" "${TOKEN}" "${OWNER_ID}" "${PUBLIC_HOST}" <<'PY'
from pathlib import Path
import sys
path=Path(sys.argv[1])
token=sys.argv[2]
owner=sys.argv[3]
host=sys.argv[4]
lines=path.read_text(encoding="utf-8").splitlines()
updates={
    "TELEGRAM_BOT_TOKEN":token,
    "UCHIHA_RADIUS_OWNER_TELEGRAM_ID":owner,
    "UCHIHA_RADIUS_PUBLIC_ORIGIN":f"https://{host}",
    "UCHIHA_RADIUS_TELEGRAM_WEBAPP_URL":f"https://{host}/telegram/",
    "UCHIHA_RADIUS_SITE_AGENT_INSTALLER_URL":f"https://{host}/site-agent/install.sh",
}
out=[]
seen=set()
for raw in lines:
    stripped=raw.strip()
    if stripped and not stripped.startswith("#") and "=" in raw:
        key=raw.split("=",1)[0].strip()
        if key in updates:
            out.append(f"{key}={updates[key]}")
            seen.add(key)
            continue
    out.append(raw)
for key,value in updates.items():
    if key not in seen:
        out.append(f"{key}={value}")
path.write_text("\n".join(out)+"\n",encoding="utf-8")
PY

chown root:root "${ENV_FILE}"
chmod 0600 "${ENV_FILE}"

# Polling bots must not have an active webhook.
python3 - "${TOKEN}" <<'PY'
import json, sys, urllib.request
token=sys.argv[1]
request=urllib.request.Request(
    f"https://api.telegram.org/bot{token}/deleteWebhook",
    data=json.dumps({"drop_pending_updates":False}).encode(),
    headers={"Content-Type":"application/json"},
)
with urllib.request.urlopen(request,timeout=10) as response:
    data=json.load(response)
if data.get("ok") is not True:
    raise SystemExit("Could not clear Telegram webhook")
print("telegram_polling_mode=ready")
PY

systemctl enable uchiha-radius-provider.service uchiha-radius-telegram-bot.service
systemctl restart uchiha-radius-provider.service
systemctl restart uchiha-radius-telegram-bot.service
sleep 2

systemctl is-active --quiet uchiha-radius-provider.service
systemctl is-active --quiet uchiha-radius-telegram-bot.service

curl -fsS --max-time 4 http://127.0.0.1:8788/healthz >/tmp/uchiha-radius-provider-after-telegram.json

python3 - <<'PY'
from pathlib import Path
p=Path('/etc/uchiha-radius/provider.env')
vals={}
for raw in p.read_text(errors='ignore').splitlines():
    line=raw.strip()
    if line and not line.startswith('#') and '=' in line:
        k,v=line.split('=',1); vals[k]=v.strip()
assert vals.get('TELEGRAM_BOT_TOKEN')
assert vals.get('UCHIHA_RADIUS_OWNER_TELEGRAM_ID','').isdigit()
print("telegram_config=ready")
PY

echo "telegram_provider_api=active"
echo "telegram_bot_service=active"
echo "telegram_activation=complete"
