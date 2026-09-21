#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RADIUS_DIR="${SOURCE_DIR}"
ETC_DIR="/etc/uchiha-radius"
STATE_DIR="/var/lib/uchiha-radius"
RELEASE_ROOT="/opt/uchiha-radius/releases"
CURRENT_LINK="/opt/uchiha-radius/current"
ENV_FILE="${ETC_DIR}/connector.env"
SERVICE_NAME="uchiha-radius"
PORT="8792"
DISPATCHER_PORT="8791"

[[ "${EUID}" -eq 0 ]] || { echo "Run as root." >&2; exit 2; }

if ss -ltnH "sport = :${PORT}" 2>/dev/null | grep -q .; then
  if ! systemctl is-active --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
    echo "Port ${PORT} is already occupied by another process." >&2
    exit 3
  fi
fi

install -d -m 0755 /opt/uchiha-radius "${RELEASE_ROOT}"
install -d -m 0700 -o uchiha-radius -g uchiha-radius "${STATE_DIR}" "${STATE_DIR}/backups"
install -d -m 0750 -o root -g uchiha-radius "${ETC_DIR}"

secret_file() {
  local path="$1"
  local bytes="${2:-48}"
  if [[ ! -s "$path" ]]; then
    python3 - "$bytes" >"$path" <<'PY'
import secrets, sys
size=max(24,int(sys.argv[1]))
print(secrets.token_urlsafe(size))
PY
  fi
  chmod 0600 "$path"
}

secret_file "${ETC_DIR}/v37-gateway-hmac.secret" 48
secret_file "${ETC_DIR}/dispatcher.token" 48
secret_file "${ETC_DIR}/radius-probe.secret" 32
secret_file "${ETC_DIR}/bootstrap-owner-password" 24

if [[ ! -s "${ETC_DIR}/credential.key" ]]; then
  python3 - <<'PY' >"${ETC_DIR}/credential.key"
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode())
PY
fi
chmod 0640 "${ETC_DIR}/credential.key"
chown root:uchiha-radius "${ETC_DIR}/credential.key"

python3 "${RADIUS_DIR}/UCHIHA-RADIUS-v101-Backend-v37-deploy.py" \
  --source-dir "${RADIUS_DIR}" \
  --release-root "${RELEASE_ROOT}" \
  --current-link "${CURRENT_LINK}" \
  --env-file "/nonexistent/uchiha-radius-env" \
  --skip-systemctl --skip-smoke >/tmp/uchiha-radius-central-stage.json

if [[ -f "${ENV_FILE}" ]]; then
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  cp -a "${ENV_FILE}" "${ENV_FILE}.before-central-${stamp}"
  chmod 0600 "${ENV_FILE}.before-central-${stamp}"
fi

python3 - "${RADIUS_DIR}" "${ENV_FILE}" "${ETC_DIR}" "${PORT}" "${DISPATCHER_PORT}" <<'PY'
from pathlib import Path
import json, sys

source=Path(sys.argv[1])
env_path=Path(sys.argv[2])
etc=Path(sys.argv[3])
port=sys.argv[4]
dispatcher_port=sys.argv[5]

manifest=next(source.glob("UCHIHA-RADIUS-v101-Backend-v37-RELEASE*.json"))
data=json.loads(manifest.read_text(encoding="utf-8"))
integrity_name=data["integrityManifest"]
integrity_sha=data["integrityManifestSha256"]

def secret(name):
    return (etc/name).read_text(encoding="utf-8").strip()

template=(source/"RADIUS-A-Connector-Backend-v37-production.env.template").read_text(encoding="utf-8")
values={}
comments=[]
for raw in template.splitlines():
    line=raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        comments.append(raw)
        continue
    key,value=raw.split("=",1)
    values[key.strip()]=value.strip()

values.update({
    "UCHIHA_CONNECTOR_HOST":"127.0.0.1",
    "UCHIHA_CONNECTOR_PORT":port,
    "UCHIHA_CONNECTOR_DB":"/var/lib/uchiha-radius/connector.sqlite3",
    "UCHIHA_CONNECTOR_ADAPTER":"production-live",
    "UCHIHA_CONNECTOR_ENABLE_LIVE":"1",
    "UCHIHA_CONNECTOR_LIVE_ACK":"I_UNDERSTAND_LIVE_NETWORK_COMMANDS",
    "UCHIHA_CONNECTOR_LIVE_DRIVER":"mikrotik-gateway",
    "UCHIHA_PRODUCTION_SITE":"UCHIHA-RADIUS-CENTRAL",
    "UCHIHA_CONNECTOR_AUTH_MODE":"hybrid",
    "UCHIHA_BOOTSTRAP_OWNER_PASSWORD_FILE":"/etc/uchiha-radius/bootstrap-owner-password",
    "UCHIHA_PUBLIC_HTTPS_REQUIRED":"1",
    "UCHIHA_TRUST_PROXY_HEADERS":"1",
    "UCHIHA_TRUSTED_PROXY_CIDRS":"127.0.0.1/32",
    "UCHIHA_REJECT_UNTRUSTED_PROXY_HEADERS":"1",
    "UCHIHA_COOKIE_SECURE":"1",
    "UCHIHA_CONNECTOR_GATEWAY_HMAC_SECRET":secret("v37-gateway-hmac.secret"),
    "UCHIHA_CONNECTOR_GATEWAY_HMAC_KEY_ID":"telegram-provider",
    "UCHIHA_CONNECTOR_GATEWAY_HMAC_PREVIOUS_SECRET":"",
    "UCHIHA_CONNECTOR_GATEWAY_HMAC_PREVIOUS_KEY_ID":"",
    "UCHIHA_GATEWAY_REQUIRE_HTTPS":"1",
    "UCHIHA_GATEWAY_LEGACY_KEY_AUTH":"0",
    "UCHIHA_RADIUS_HOST":"127.0.0.1",
    "UCHIHA_RADIUS_SECRET":secret("radius-probe.secret"),
    "UCHIHA_REQUIRE_CONNECTIVITY_PREFLIGHT":"0",
    "UCHIHA_MIKROTIK_BASE_URL":f"http://127.0.0.1:{dispatcher_port}",
    "UCHIHA_MIKROTIK_TOKEN":secret("dispatcher.token"),
    "UCHIHA_CONNECTOR_ALLOW_INSECURE_MIKROTIK":"1",
    "UCHIHA_BACKUP_OFFHOST_ENABLE":"0",
    "UCHIHA_BACKUP_OFFHOST_GATEWAY_URL":"",
    "UCHIHA_BACKUP_OFFHOST_GATEWAY_TOKEN":"",
    "UCHIHA_BACKUP_OFFHOST_AUTO_REPLICATE":"0",
    "UCHIHA_RELEASE_INTEGRITY_REQUIRED":"1",
    "UCHIHA_RELEASE_INTEGRITY_MANIFEST":f"/opt/uchiha-radius/current/{integrity_name}",
    "UCHIHA_RELEASE_INTEGRITY_MANIFEST_SHA256":integrity_sha,
    "UCHIHA_LAUNCH_REQUIRE_HTTPS":"1",
    "UCHIHA_LAUNCH_REQUIRE_VERIFIED_BACKUP":"0",
    "UCHIHA_LAUNCH_REQUIRE_RECOVERY_DRILL":"0",
    "UCHIHA_LAUNCH_REQUIRE_OFFHOST_BACKUP":"0",
    "UCHIHA_LAUNCH_REQUIRE_POST_DEPLOY_VERIFICATION":"0",
    "UCHIHA_LAUNCH_REQUIRE_REMOTE_LOG_SHIPPING":"0",
    "UCHIHA_LAUNCH_REQUIRE_TELEGRAM":"0",
    "UCHIHA_LAUNCH_REQUIRE_VOUCHERS":"0",
    "UCHIHA_LAUNCH_REQUIRE_DIRECT_RADIUS":"0",
    "UCHIHA_TELEGRAM_ALERTS_ENABLED":"0",
    "UCHIHA_TELEGRAM_BOT_TOKEN":"",
    "UCHIHA_TELEGRAM_CHAT_ID":"",
    "UCHIHA_LOG_REMOTE_ENABLE":"0",
    "UCHIHA_LOG_REMOTE_URL":"",
    "UCHIHA_LOG_REMOTE_TOKEN":"",
    "UCHIHA_VOUCHER_PROVISION_ENABLE":"0",
    "UCHIHA_VOUCHER_GATEWAY_URL":"",
    "UCHIHA_VOUCHER_GATEWAY_TOKEN":"",
    "UCHIHA_RADIUS_COA_ENABLE":"0",
    "UCHIHA_RADIUS_COA_SECRET":"",
    "UCHIHA_RADIUS_COA_ALLOWED_HOSTS":"",
    "UCHIHA_SMOKE_BASE_URL":"https://radius.uchiha-builder.com",
})

if any("CHANGE_ME" in value for value in values.values()):
    bad=[key for key,value in values.items() if "CHANGE_ME" in value]
    raise SystemExit("unresolved production placeholders: "+",".join(bad))

out=[]
seen=set()
for raw in template.splitlines():
    line=raw.strip()
    if line and not line.startswith("#") and "=" in line:
        key=line.split("=",1)[0].strip()
        out.append(f"{key}={values[key]}")
        seen.add(key)
    else:
        out.append(raw)
for key,value in values.items():
    if key not in seen:
        out.append(f"{key}={value}")
env_path.write_text("\n".join(out)+"\n",encoding="utf-8")
PY

chmod 0600 "${ENV_FILE}"
chown root:root "${ENV_FILE}"

set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a
python3 -S -B "${CURRENT_LINK}/RADIUS-A-Connector-Backend-v37.py" --check-host >/tmp/uchiha-radius-central-host.json
python3 -S -B "${CURRENT_LINK}/RADIUS-A-Connector-Backend-v37.py" --check-config >/tmp/uchiha-radius-central-config.json

# Root-run preflight may create the advisory lock file. Hand runtime state back
# to the dedicated service account before systemd performs its own preflight.
find "${STATE_DIR}" -maxdepth 1 -type f \( -name 'connector.sqlite3' -o -name 'connector.sqlite3-*' -o -name 'connector.sqlite3.*' \) \
  -exec chown uchiha-radius:uchiha-radius {} +
find "${STATE_DIR}" -maxdepth 1 -type f \( -name 'connector.sqlite3' -o -name 'connector.sqlite3-*' -o -name 'connector.sqlite3.*' \) \
  -exec chmod 0600 {} +

install -m 0644 "${RADIUS_DIR}/uchiha-radius-v37.service" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"
systemctl restart "${SERVICE_NAME}.service"

sleep 1
systemctl is-active --quiet "${SERVICE_NAME}.service"
ss -ltnH "sport = :${PORT}" | grep -q .

python3 - <<'PY'
import json
from pathlib import Path
for name in ("host","config"):
    data=json.loads(Path(f"/tmp/uchiha-radius-central-{name}.json").read_text())
    print(name, "ok=", bool(data.get("ok", data.get("ready", False))), "blockers=", len(data.get("blockers") or []))
PY
echo "central_v37_port=${PORT}"
echo "central_v37_service=active"
