#!/usr/bin/env bash
set -euo pipefail

PUBLIC_HOST="${UCHIHA_RADIUS_PUBLIC_HOST:-radius.uchiha-builder.com}"
PROVIDER_PORT="${UCHIHA_RADIUS_PROVIDER_PORT:-8788}"
V37_PORT="${UCHIHA_RADIUS_V37_PORT:-8792}"
TELEGRAM_ROOT="/opt/uchiha-radius/telegram-app/dist"
TELEGRAM_ASSETS="/opt/uchiha-radius/telegram-app/web"
ACME_ROOT="/var/www/uchiha-radius-acme"
LIMITS_CONF="/etc/nginx/conf.d/uchiha-radius-limits.conf"
EDGE_CONF="/etc/nginx/conf.d/uchiha-radius.conf"
HTTP_STAGE="/etc/nginx/conf.d/uchiha-radius-http.conf"

[[ "${EUID}" -eq 0 ]] || { echo "Run as root." >&2; exit 2; }
command -v nginx >/dev/null || { echo "nginx is required." >&2; exit 2; }
command -v certbot >/dev/null || { echo "certbot is required." >&2; exit 2; }
[[ -s "${TELEGRAM_ROOT}/index.html" ]] || { echo "Telegram WebApp is not staged." >&2; exit 3; }

public_ip="${UCHIHA_RADIUS_PUBLIC_IP:-}"
if [[ -z "${public_ip}" ]]; then
  public_ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' || true)"
fi
if [[ -z "${public_ip}" ]]; then
  public_ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
fi
dns_ip="$(getent ahostsv4 "${PUBLIC_HOST}" 2>/dev/null | awk 'NR==1{print $1}' || true)"
[[ -n "${public_ip}" && -n "${dns_ip}" ]] || {
  echo "Cannot verify public/DNS addresses." >&2
  exit 4
}
if [[ "${public_ip}" != "${dns_ip}" ]]; then
  echo "DNS is not ready: ${PUBLIC_HOST} -> ${dns_ip}, VPS -> ${public_ip}" >&2
  exit 5
fi

install -d -m 0755 "${ACME_ROOT}/.well-known/acme-challenge"

if [[ ! -s "/etc/letsencrypt/live/${PUBLIC_HOST}/fullchain.pem" || ! -s "/etc/letsencrypt/live/${PUBLIC_HOST}/privkey.pem" ]]; then
  certbot certonly --webroot -w "${ACME_ROOT}" -d "${PUBLIC_HOST}"     --non-interactive --agree-tos --register-unsafely-without-email
fi

cat >"${LIMITS_CONF}" <<'EOF'
limit_conn_zone $binary_remote_addr zone=uchiha_radius_conn:10m;
limit_req_zone  $binary_remote_addr zone=uchiha_radius_req:10m rate=100r/s;
EOF

cat >"${EDGE_CONF}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${PUBLIC_HOST};

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
        default_type text/plain;
        try_files \$uri =404;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${PUBLIC_HOST};

    ssl_certificate /etc/letsencrypt/live/${PUBLIC_HOST}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${PUBLIC_HOST}/privkey.pem;

    client_max_body_size 256k;
    client_header_timeout 10s;
    client_body_timeout 10s;
    keepalive_timeout 30s;

    limit_conn uchiha_radius_conn 64;
    limit_req zone=uchiha_radius_req burst=200 nodelay;
    limit_req_status 429;
    limit_conn_status 503;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "same-origin" always;

    location = /healthz {
        default_type application/json;
        add_header Cache-Control "no-store" always;
        return 200 '{"ok":true,"service":"uchiha-radius-edge","tlsReady":true}';
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
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
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
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 20s;
        proxy_connect_timeout 3s;
        client_max_body_size 256k;
    }

    location ^~ /api/connectors/radius/ {
        proxy_pass http://127.0.0.1:${V37_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Port 443;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    location / {
        root /opt/uchiha-radius/current;
        try_files /RADIUS-A-Master-v101.html =404;
        add_header Cache-Control "no-store" always;
    }
}
EOF

rm -f "${HTTP_STAGE}"
nginx -t
systemctl reload nginx

curl -fsS --max-time 8 "https://${PUBLIC_HOST}/healthz" >/tmp/uchiha-radius-edge-tls-health.json
webapp_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "https://${PUBLIC_HOST}/telegram/")"
[[ "${webapp_code}" == "200" ]] || { echo "Telegram WebApp HTTPS check failed: ${webapp_code}" >&2; exit 6; }

echo "edge_tls=ready"
echo "dns_ready=yes"
echo "https_health=200"
echo "telegram_webapp_https=200"
