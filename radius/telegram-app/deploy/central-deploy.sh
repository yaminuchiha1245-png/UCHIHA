#!/usr/bin/env bash
set -euo pipefail

PUBLIC_HOST="radius.uchiha-builder.com"
V37_PORT="8792"
PROVIDER_PORT="8788"
DISPATCHER_PORT="8791"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --public-host) PUBLIC_HOST="$2"; shift 2;;
    --v37-port) V37_PORT="$2"; shift 2;;
    --provider-port) PROVIDER_PORT="$2"; shift 2;;
    --dispatcher-port) DISPATCHER_PORT="$2"; shift 2;;
    -h|--help)
      echo "Usage: central-deploy.sh [--public-host HOST] [--v37-port PORT] [--provider-port PORT] [--dispatcher-port PORT]"
      exit 0;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
done

[[ "${EUID}" -eq 0 ]] || { echo "Run as root." >&2; exit 2; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$HERE/.." && pwd)"
RADIUS_DIR="$(cd "$APP_DIR/.." && pwd)"

CURRENT="/opt/uchiha-radius/current"
TELEGRAM="/opt/uchiha-radius/telegram-app"
ETC="/etc/uchiha-radius"
STATE="/var/lib/uchiha-radius"

if ! getent group uchiha-radius >/dev/null; then
  groupadd --system uchiha-radius
fi
if ! id uchiha-radius >/dev/null 2>&1; then
  useradd --system --gid uchiha-radius --home-dir "$STATE" --shell /usr/sbin/nologin uchiha-radius
fi

install -d -m 0755 "$CURRENT" "$TELEGRAM" "$TELEGRAM/web" "$TELEGRAM/dist"
install -d -m 0750 -o root -g uchiha-radius "$ETC"
install -d -m 0700 -o uchiha-radius -g uchiha-radius "$STATE" "$STATE/backups"

install -m 0644 "$RADIUS_DIR/RADIUS-A-Connector-Backend-v37.py" "$CURRENT/"
install -m 0644 "$RADIUS_DIR/RADIUS-A-Master-v101.html" "$CURRENT/"
install -m 0644 "$RADIUS_DIR/UCHIHA-RADIUS-v101-Backend-v37-INTEGRITY.json" "$CURRENT/"
install -m 0644 "$APP_DIR"/*.py "$TELEGRAM/"
install -m 0644 "$APP_DIR/web/telegram-runtime-v101.js" "$TELEGRAM/web/"

python3 "$APP_DIR/build_telegram_webapp.py"   --source "$CURRENT/RADIUS-A-Master-v101.html"   --runtime "$TELEGRAM/web/telegram-runtime-v101.js"   --output "$TELEGRAM/dist/index.html"

secret_file() {
  local path="$1"
  local kind="$2"
  if [[ ! -s "$path" ]]; then
    case "$kind" in
      fernet)
        python3 - <<'PY' >"$path"
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode())
PY
        ;;
      password)
        python3 - <<'PY' >"$path"
import secrets, string
alphabet=string.ascii_letters+string.digits+"-_"
print("".join(secrets.choice(alphabet) for _ in range(30)))
PY
        ;;
      *)
        python3 - <<'PY' >"$path"
import secrets
print(secrets.token_urlsafe(48))
PY
        ;;
    esac
  fi
  chown root:uchiha-radius "$path"
  chmod 0640 "$path"
}

secret_file "$ETC/credential.key" fernet
secret_file "$ETC/provider-csrf.secret" random
secret_file "$ETC/v37-gateway-hmac.secret" random
secret_file "$ETC/dispatcher.token" random
secret_file "$ETC/bootstrap-owner-password" password
secret_file "$ETC/radius-control.secret" random

CSRF_SECRET="$(tr -d '\r\n' <"$ETC/provider-csrf.secret")"
V37_HMAC="$(tr -d '\r\n' <"$ETC/v37-gateway-hmac.secret")"
DISPATCHER_TOKEN="$(tr -d '\r\n' <"$ETC/dispatcher.token")"
RADIUS_CONTROL_SECRET="$(tr -d '\r\n' <"$ETC/radius-control.secret")"
MANIFEST_SHA="$(sha256sum "$CURRENT/UCHIHA-RADIUS-v101-Backend-v37-INTEGRITY.json" | awk '{print $1}')"

# Preserve an already configured Telegram token/owner when rerunning this deployer.
OLD_BOT_TOKEN=""
OLD_OWNER_ID=""
if [[ -f "$ETC/provider.env" ]]; then
  OLD_BOT_TOKEN="$(awk -F= '$1=="TELEGRAM_BOT_TOKEN"{sub(/^[^=]*=/,""); print; exit}' "$ETC/provider.env" || true)"
  OLD_OWNER_ID="$(awk -F= '$1=="UCHIHA_RADIUS_OWNER_TELEGRAM_ID"{sub(/^[^=]*=/,""); print; exit}' "$ETC/provider.env" || true)"
fi

umask 077
cat >"$ETC/provider.env" <<EOF
TELEGRAM_BOT_TOKEN=$OLD_BOT_TOKEN
UCHIHA_RADIUS_OWNER_TELEGRAM_ID=$OLD_OWNER_ID
UCHIHA_RADIUS_DEFAULT_PROVIDER_NAME=UCHIHA Provider
UCHIHA_RADIUS_DEFAULT_PROVIDER_CODE=UCHIHA
UCHIHA_RADIUS_PROVIDER_DB=$STATE/provider.sqlite3
UCHIHA_RADIUS_PROVIDER_BIND=127.0.0.1
UCHIHA_RADIUS_PROVIDER_PORT=$PROVIDER_PORT
UCHIHA_RADIUS_PUBLIC_ORIGIN=https://$PUBLIC_HOST
UCHIHA_RADIUS_TELEGRAM_WEBAPP_URL=https://$PUBLIC_HOST/telegram/
UCHIHA_RADIUS_TELEGRAM_AUTH_MAX_AGE=900
UCHIHA_RADIUS_SESSION_TTL=28800
UCHIHA_RADIUS_CREDENTIAL_KEY_FILE=$ETC/credential.key
UCHIHA_RADIUS_PROVIDER_CSRF_SECRET=$CSRF_SECRET
UCHIHA_RADIUS_V37_BASE_URL=http://127.0.0.1:$V37_PORT
UCHIHA_RADIUS_V37_HMAC_KEY_ID=telegram-provider
UCHIHA_RADIUS_V37_HMAC_SECRET_FILE=$ETC/v37-gateway-hmac.secret
EOF

cat >"$ETC/dispatcher.env" <<EOF
UCHIHA_DISPATCHER_BIND=127.0.0.1
UCHIHA_DISPATCHER_PORT=$DISPATCHER_PORT
UCHIHA_DISPATCHER_WAIT_SECONDS=10
UCHIHA_DISPATCHER_V37_TOKEN=$DISPATCHER_TOKEN
UCHIHA_RADIUS_PROVIDER_DB=$STATE/provider.sqlite3
EOF

cat >"$ETC/connector.env" <<EOF
UCHIHA_CONNECTOR_HOST=127.0.0.1
UCHIHA_CONNECTOR_PORT=$V37_PORT
UCHIHA_CONNECTOR_DB=$STATE/connector.sqlite3
UCHIHA_CONNECTOR_ADAPTER=production-live
UCHIHA_CONNECTOR_ENABLE_LIVE=1
UCHIHA_CONNECTOR_LIVE_ACK=I_UNDERSTAND_LIVE_NETWORK_COMMANDS
UCHIHA_CONNECTOR_LIVE_DRIVER=mikrotik-gateway
UCHIHA_PRODUCTION_SITE=UCHIHA-RADIUS

UCHIHA_CONNECTOR_AUTH_MODE=hybrid
UCHIHA_BOOTSTRAP_OWNER_USERNAME=owner
UCHIHA_BOOTSTRAP_OWNER_PASSWORD_FILE=$ETC/bootstrap-owner-password
UCHIHA_OPERATOR_PASSWORD_MIN_LENGTH=12
UCHIHA_OPERATOR_SCRYPT_N_LOG2=14
UCHIHA_OPERATOR_LOGIN_FAILURE_LIMIT=5
UCHIHA_OPERATOR_LOGIN_FAILURE_WINDOW_SECONDS=300
UCHIHA_LAUNCH_REQUIRE_OPERATOR_SESSION=1

UCHIHA_INSTANCE_LOCK_REQUIRED=1
UCHIHA_INSTANCE_LOCK_PATH=$STATE/connector.sqlite3.instance.lock
UCHIHA_LAUNCH_REQUIRE_INSTANCE_LOCK=1
UCHIHA_HOST_PREFLIGHT_REQUIRED=1
UCHIHA_HOST_MIN_FREE_BYTES=536870912
UCHIHA_LAUNCH_REQUIRE_HOST_PREFLIGHT=1

UCHIHA_PUBLIC_HTTPS_REQUIRED=1
UCHIHA_TRUST_PROXY_HEADERS=1
UCHIHA_TRUSTED_PROXY_CIDRS=127.0.0.1/32
UCHIHA_REJECT_UNTRUSTED_PROXY_HEADERS=1
UCHIHA_COOKIE_SECURE=1
UCHIHA_HSTS_ENABLED=1
UCHIHA_HSTS_MAX_AGE=31536000
UCHIHA_HSTS_INCLUDE_SUBDOMAINS=0
UCHIHA_HSTS_PRELOAD=0

UCHIHA_CONNECTOR_GATEWAY_HMAC_SECRET=$V37_HMAC
UCHIHA_CONNECTOR_GATEWAY_HMAC_KEY_ID=telegram-provider
UCHIHA_CONNECTOR_GATEWAY_HMAC_PREVIOUS_SECRET=
UCHIHA_CONNECTOR_GATEWAY_HMAC_PREVIOUS_KEY_ID=
UCHIHA_CONNECTOR_GATEWAY_HMAC_MAX_SKEW=120
UCHIHA_CONNECTOR_GATEWAY_NONCE_RETENTION=600
UCHIHA_GATEWAY_REQUIRE_HTTPS=1
UCHIHA_GATEWAY_LEGACY_KEY_AUTH=0
UCHIHA_LAUNCH_REQUIRE_GATEWAY_HMAC=1

UCHIHA_EDGE_MAX_CONCURRENT_REQUESTS=128
UCHIHA_EDGE_SOCKET_TIMEOUT_SECONDS=15
UCHIHA_EDGE_GATEWAY_AUTH_FAILURE_LIMIT=30
UCHIHA_EDGE_GATEWAY_AUTH_FAILURE_WINDOW_SECONDS=60
UCHIHA_LAUNCH_REQUIRE_EDGE_PROTECTION=1

UCHIHA_RADIUS_HOST=127.0.0.1
UCHIHA_RADIUS_AUTH_PORT=1812
UCHIHA_RADIUS_ACCT_PORT=1813
UCHIHA_RADIUS_SECRET=$RADIUS_CONTROL_SECRET
UCHIHA_RADIUS_PROBE_MODE=dns-only
UCHIHA_REQUIRE_CONNECTIVITY_PREFLIGHT=0

UCHIHA_MIKROTIK_BASE_URL=http://127.0.0.1:$DISPATCHER_PORT
UCHIHA_MIKROTIK_TOKEN=$DISPATCHER_TOKEN
UCHIHA_CONNECTOR_ALLOW_INSECURE_MIKROTIK=1
UCHIHA_CONNECTOR_LIVE_TIMEOUT=12

UCHIHA_BACKUP_DIR=$STATE/backups
UCHIHA_BACKUP_RETENTION=12
UCHIHA_BACKUP_OFFHOST_ENABLE=0

UCHIHA_RELEASE_INTEGRITY_REQUIRED=1
UCHIHA_RELEASE_INTEGRITY_MANIFEST=$CURRENT/UCHIHA-RADIUS-v101-Backend-v37-INTEGRITY.json
UCHIHA_RELEASE_INTEGRITY_MANIFEST_SHA256=$MANIFEST_SHA
UCHIHA_LAUNCH_REQUIRE_RELEASE_INTEGRITY=1

UCHIHA_LAUNCH_REQUIRE_HTTPS=1
UCHIHA_LAUNCH_REQUIRE_VERIFIED_BACKUP=0
UCHIHA_LAUNCH_REQUIRE_RECOVERY_DRILL=0
UCHIHA_LAUNCH_REQUIRE_OFFHOST_BACKUP=0
UCHIHA_LAUNCH_REQUIRE_POST_DEPLOY_VERIFICATION=0
UCHIHA_LAUNCH_REQUIRE_REMOTE_LOG_SHIPPING=0
UCHIHA_LAUNCH_REQUIRE_TELEGRAM=0
UCHIHA_LAUNCH_REQUIRE_VOUCHERS=0
UCHIHA_LAUNCH_REQUIRE_DIRECT_RADIUS=0

UCHIHA_QUEUE_WORKER_ENABLED=1
UCHIHA_QUEUE_POLL_SECONDS=0.5
UCHIHA_QUEUE_MAX_ATTEMPTS=5
UCHIHA_GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS=30
UCHIHA_GRACEFUL_SHUTDOWN_POLL_SECONDS=0.1
UCHIHA_DRAIN_MAX_WAIT_SECONDS=30
UCHIHA_DRAIN_POLL_SECONDS=0.1
UCHIHA_MAINTENANCE_MODE=0

UCHIHA_ALERT_MONITOR_ENABLED=1
UCHIHA_ALERT_POLL_SECONDS=15
UCHIHA_METRICS_PUBLIC=0
UCHIHA_LOG_FORMAT=json
UCHIHA_LOG_LEVEL=INFO
UCHIHA_LOG_HTTP=1
UCHIHA_TELEGRAM_ALERTS_ENABLED=0
UCHIHA_LOG_REMOTE_ENABLE=0
UCHIHA_VOUCHER_PROVISION_ENABLE=0
UCHIHA_RADIUS_COA_ENABLE=0
EOF

chown root:uchiha-radius "$ETC/provider.env" "$ETC/dispatcher.env" "$ETC/connector.env"
chmod 0640 "$ETC/provider.env" "$ETC/dispatcher.env" "$ETC/connector.env"

install -m 0644 "$RADIUS_DIR/uchiha-radius-v37.service" /etc/systemd/system/uchiha-radius-v37.service
install -m 0644 "$HERE/uchiha-radius-provider.service" /etc/systemd/system/
install -m 0644 "$HERE/uchiha-radius-telegram-bot.service" /etc/systemd/system/
install -m 0644 "$HERE/uchiha-radius-mikrotik-dispatcher.service" /etc/systemd/system/

cat >"$ETC/nginx-radius.conf.pending" <<EOF
# Activate only after $PUBLIC_HOST resolves to this VPS and a TLS certificate exists.
location = /telegram { return 308 /telegram/; }
location /telegram/ {
    alias $TELEGRAM/dist/;
    try_files \$uri \$uri/ /telegram/index.html;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options "nosniff" always;
}
location = /telegram-assets/telegram-runtime-v101.js {
    alias $TELEGRAM/web/telegram-runtime-v101.js;
    add_header X-Content-Type-Options "nosniff" always;
}
location ^~ /telegram-api/ {
    proxy_pass http://127.0.0.1:$PROVIDER_PORT;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
}
location ^~ /api/radius-agent/ {
    proxy_pass http://127.0.0.1:$PROVIDER_PORT;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
}
EOF
chmod 0644 "$ETC/nginx-radius.conf.pending"

systemctl daemon-reload
systemctl enable uchiha-radius-mikrotik-dispatcher.service uchiha-radius-v37.service uchiha-radius-provider.service
systemctl restart uchiha-radius-mikrotik-dispatcher.service
systemctl restart uchiha-radius-v37.service
systemctl restart uchiha-radius-provider.service

# Bot stays disabled until a dedicated Telegram bot token + owner ID are configured.
if [[ -n "$OLD_BOT_TOKEN" && -n "$OLD_OWNER_ID" ]]; then
  systemctl enable uchiha-radius-telegram-bot.service
  systemctl restart uchiha-radius-telegram-bot.service
else
  systemctl disable uchiha-radius-telegram-bot.service >/dev/null 2>&1 || true
  systemctl stop uchiha-radius-telegram-bot.service >/dev/null 2>&1 || true
fi

sleep 1
curl -fsS --max-time 3 "http://127.0.0.1:$DISPATCHER_PORT/healthz" >/dev/null
curl -fsS --max-time 3 "http://127.0.0.1:$PROVIDER_PORT/healthz" >/dev/null

echo "Central RADIUS runtime staged and started."
echo "Provider API: 127.0.0.1:$PROVIDER_PORT"
echo "Backend v37: 127.0.0.1:$V37_PORT"
echo "MikroTik dispatcher: 127.0.0.1:$DISPATCHER_PORT"
echo "Telegram bot active: $([[ -n "$OLD_BOT_TOKEN" && -n "$OLD_OWNER_ID" ]] && echo yes || echo no)"
echo "Nginx config staged: $ETC/nginx-radius.conf.pending"
