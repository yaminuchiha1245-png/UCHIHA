#!/usr/bin/env bash
set -euo pipefail

PUBLIC_HOST="${UCHIHA_RADIUS_PUBLIC_HOST:-radius.uchiha-builder.com}"
TELEGRAM_ROOT="/opt/uchiha-radius/telegram-app/dist"
TELEGRAM_ASSETS="/opt/uchiha-radius/telegram-app/web"
PROVIDER_PORT="${UCHIHA_RADIUS_PROVIDER_PORT:-8788}"
ACME_ROOT="/var/www/uchiha-radius-acme"
NGINX_CONF="/etc/nginx/conf.d/uchiha-radius-http.conf"

[[ "${EUID}" -eq 0 ]] || { echo "Run as root." >&2; exit 2; }
command -v nginx >/dev/null || { echo "nginx is required." >&2; exit 2; }

[[ -s "${TELEGRAM_ROOT}/index.html" ]] || {
  echo "Telegram WebApp build is missing: ${TELEGRAM_ROOT}/index.html" >&2
  exit 3
}

install -d -m 0755 "${ACME_ROOT}/.well-known/acme-challenge"

cat >"${NGINX_CONF}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${PUBLIC_HOST};

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
        default_type text/plain;
        try_files \$uri =404;
    }

    location = /healthz {
        default_type application/json;
        add_header Cache-Control "no-store" always;
        return 200 '{"ok":true,"service":"uchiha-radius-edge","tlsReady":false}';
    }

    location = /telegram {
        return 308 /telegram/;
    }

    location /telegram/ {
        alias ${TELEGRAM_ROOT}/;
        try_files \$uri \$uri/ /telegram/index.html;
        add_header Cache-Control "no-store" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "same-origin" always;
        add_header Content-Security-Policy "default-src 'self' https://telegram.org; script-src 'self' 'unsafe-inline' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors https://web.telegram.org https://*.telegram.org;" always;
    }

    location = /telegram-assets/telegram-runtime-v101.js {
        alias ${TELEGRAM_ASSETS}/telegram-runtime-v101.js;
        add_header Cache-Control "public, max-age=300" always;
        add_header X-Content-Type-Options "nosniff" always;
    }

    location ^~ /telegram-api/ {
        proxy_pass http://127.0.0.1:${PROVIDER_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 20s;
        proxy_connect_timeout 3s;
        client_max_body_size 256k;
    }

    location ^~ /api/radius-agent/ {
        proxy_pass http://127.0.0.1:${PROVIDER_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 20s;
        proxy_connect_timeout 3s;
        client_max_body_size 256k;
    }

    location / {
        default_type application/json;
        add_header Cache-Control "no-store" always;
        return 503 '{"ok":false,"code":"tls_not_provisioned","service":"uchiha-radius-edge"}';
    }
}
EOF

nginx -t
systemctl reload nginx

local_health="$(curl -fsS --max-time 4 -H "Host: ${PUBLIC_HOST}" http://127.0.0.1/healthz)"
local_webapp_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 4 -H "Host: ${PUBLIC_HOST}" http://127.0.0.1/telegram/)"
local_api_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 4 -H "Host: ${PUBLIC_HOST}" http://127.0.0.1/telegram-api/radius-provider/me)"

public_ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
dns_ip="$(getent ahostsv4 "${PUBLIC_HOST}" 2>/dev/null | awk 'NR==1{print $1}' || true)"

echo "edge_http=ready"
echo "local_health=${local_health}"
echo "local_webapp_http=${local_webapp_code}"
echo "local_api_unauthenticated_http=${local_api_code}"
echo "public_ip=${public_ip:-unknown}"
echo "dns_ip=${dns_ip:-unknown}"

if [[ -n "${public_ip}" && -n "${dns_ip}" && "${public_ip}" == "${dns_ip}" ]]; then
    echo "dns_ready=yes"
else
    echo "dns_ready=no"
fi

cert="/etc/letsencrypt/live/${PUBLIC_HOST}/fullchain.pem"
key="/etc/letsencrypt/live/${PUBLIC_HOST}/privkey.pem"
if [[ -s "${cert}" && -s "${key}" ]]; then
    echo "tls_certificate=present"
else
    echo "tls_certificate=missing"
fi
