#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run as root" >&2
  exit 1
fi

APP=/opt/uchiha/store
ENV_DIR=/etc/uchiha
DATA_DIR=/var/lib/uchiha/store
ENV_FILE=$ENV_DIR/store.env
SERVICE=/etc/systemd/system/uchiha-store.service
NGINX=/etc/nginx/sites-available/uchiha-store

[ -d "$APP" ] || { echo "ERROR: $APP not found. Run bootstrap first." >&2; exit 1; }
[ -r /dev/tty ] || { echo "ERROR: interactive terminal is required." >&2; exit 1; }
mkdir -p "$ENV_DIR" "$DATA_DIR" /var/log/uchiha
chmod 700 "$ENV_DIR"

printf '\n=== UCHIHA Store secure setup ===\n'
printf 'Nothing typed here is sent to ChatGPT or GitHub.\n\n'

IFS= read -r -s -p 'Telegram BOT_TOKEN: ' BOT_TOKEN < /dev/tty; echo
IFS= read -r -p 'Telegram ADMIN_ID (numeric, blank = 0): ' ADMIN_ID < /dev/tty
ADMIN_ID=${ADMIN_ID:-0}
IFS= read -r -s -p 'JS4Card API_TOKEN (blank if not ready): ' API_TOKEN < /dev/tty; echo
IFS= read -r -p 'Admin username [admin]: ' ADMIN_USER < /dev/tty
ADMIN_USER=${ADMIN_USER:-admin}
while true; do
  IFS= read -r -s -p 'Admin panel password: ' ADMIN_PASS < /dev/tty; echo
  [ -n "$ADMIN_PASS" ] && break
  echo 'Password cannot be empty.'
done
SESSION_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"

escape_env(){
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}
BOT_TOKEN_E="$(escape_env "$BOT_TOKEN")"
API_TOKEN_E="$(escape_env "$API_TOKEN")"
ADMIN_USER_E="$(escape_env "$ADMIN_USER")"
ADMIN_PASS_E="$(escape_env "$ADMIN_PASS")"
SESSION_SECRET_E="$(escape_env "$SESSION_SECRET")"

umask 077
cat >"$ENV_FILE" <<EOF
BOT_TOKEN="$BOT_TOKEN_E"
PLATFORM_BOT_TOKEN=""
ADMIN_ID="$ADMIN_ID"
PLATFORM_OWNER_ID="$ADMIN_ID"
DB_PATH="$DATA_DIR/store.db"
DATABASE_URL="sqlite+aiosqlite:////var/lib/uchiha/store/uchiha_platform.db"
PORT="8080"
STOREFRONT_NAME="Uchiha Store"
STOREFRONT_TELEGRAM_URL="https://t.me/UchihaStoreBot"
STOREFRONT_SUPPORT_URL="https://t.me/UchihaStoreBot"
STOREFRONT_CURRENCY_CODE="USD"
STOREFRONT_EXCHANGE_RATES='{"USD":1}'
STOREFRONT_WEB_ENABLED="1"
STOREFRONT_API_ENABLED="1"
STOREFRONT_PUBLIC_CATALOG_ENABLED="1"
STOREFRONT_SESSION_SECRET="$SESSION_SECRET_E"
STOREFRONT_ADMIN_USERNAME="$ADMIN_USER_E"
STOREFRONT_ADMIN_PASSWORD="$ADMIN_PASS_E"
STOREFRONT_COOKIE_SECURE="0"
STOREFRONT_TRUST_PROXY="1"
API_TOKEN="$API_TOKEN_E"
BINANCE_AUTO_PAY_ENABLED="0"
SHAMCASH_API_ENABLED="0"
EOF
chmod 600 "$ENV_FILE"

cat >"$SERVICE" <<EOF
[Unit]
Description=UCHIHA Store production service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP
EnvironmentFile=$ENV_FILE
ExecStart=$APP/.venv/bin/python $APP/storefront_launcher.py
Restart=always
RestartSec=5
TimeoutStopSec=20
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

cat >"$NGINX" <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 6m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 90s;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sfn "$NGINX" /etc/nginx/sites-enabled/uchiha-store
nginx -t
systemctl daemon-reload
systemctl enable --now uchiha-store.service
systemctl restart nginx
sleep 3

echo
systemctl --no-pager --full status uchiha-store.service | sed -n '1,14p' || true
echo
if curl -fsS --max-time 8 http://127.0.0.1:8080/v1/storefront/health >/dev/null; then
  echo 'UCHIHA_STORE_HEALTH=OK'
else
  echo 'UCHIHA_STORE_HEALTH=NOT_READY'
  echo 'Recent logs:'
  journalctl -u uchiha-store.service -n 30 --no-pager || true
fi

echo
echo 'Store URL on current VPS: http://155.254.35.187/'
echo 'Secrets file: /etc/uchiha/store.env (mode 600)'
echo 'Runtime data: /var/lib/uchiha/store/'