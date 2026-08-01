#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="${REPO_DIR:-/opt/uchiha}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/uchiha-deploy}"
DOMAIN="${DOMAIN:-uchiha-builder.com}"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ -f "$REPO_DIR/builder/scripts/vps-autodeploy.sh" ]] || {
  echo "Missing $REPO_DIR/builder/scripts/vps-autodeploy.sh" >&2
  exit 1
}
[[ -f "$DEPLOY_DIR/compose.yml" ]] || { echo "Missing $DEPLOY_DIR/compose.yml" >&2; exit 1; }
[[ -f "$DEPLOY_DIR/.env" ]] || { echo "Missing $DEPLOY_DIR/.env" >&2; exit 1; }

log "Installing required packages"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx openssl curl jq util-linux

log "Installing validated auto-deploy command"
install -m 700 "$REPO_DIR/builder/scripts/vps-autodeploy.sh" /usr/local/sbin/uchiha-autodeploy

log "Installing daily database backup command"
cat > /usr/local/sbin/uchiha-backup <<'BACKUP'
#!/usr/bin/env bash
set -Eeuo pipefail
exec 9>/run/lock/uchiha-backup.lock
flock -n 9 || exit 0
DEPLOY_DIR="/opt/uchiha-deploy"
BACKUP_DIR="$DEPLOY_DIR/backups"
TIMESTAMP="$(date -u +%Y-%m-%d_%H-%M-%S)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
TMP="$BACKUP_DIR/.uchiha_builder_${TIMESTAMP}.dump.tmp"
FINAL="$BACKUP_DIR/uchiha_builder_${TIMESTAMP}.dump"
cd "$DEPLOY_DIR"
docker compose exec -T postgres pg_dump -U uchiha -d uchiha_builder -Fc > "$TMP"
mv "$TMP" "$FINAL"
chmod 600 "$FINAL"
find "$BACKUP_DIR" -type f -name '*.dump' -mtime +14 -delete
BACKUP
chmod 700 /usr/local/sbin/uchiha-backup

log "Creating a private wildcard origin certificate"
install -m 700 -d /etc/nginx/ssl/uchiha-builder
if [[ ! -f /etc/nginx/ssl/uchiha-builder/origin.key || ! -f /etc/nginx/ssl/uchiha-builder/origin.pem ]]; then
  openssl req -x509 -nodes -newkey rsa:2048 -sha256 -days 825 \
    -keyout /etc/nginx/ssl/uchiha-builder/origin.key \
    -out /etc/nginx/ssl/uchiha-builder/origin.pem \
    -subj "/CN=$DOMAIN" \
    -addext "subjectAltName=DNS:$DOMAIN,DNS:*.$DOMAIN"
fi
chmod 600 /etc/nginx/ssl/uchiha-builder/origin.key
chmod 644 /etc/nginx/ssl/uchiha-builder/origin.pem

log "Configuring Nginx for the platform and all store subdomains"
cat > /etc/nginx/conf.d/uchiha-upgrade.conf <<'NGINXMAP'
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}
NGINXMAP

cat > /etc/nginx/sites-available/uchiha-builder <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN *.$DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN www.$DOMAIN *.$DOMAIN;

    ssl_certificate /etc/nginx/ssl/uchiha-builder/origin.pem;
    ssl_certificate_key /etc/nginx/ssl/uchiha-builder/origin.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    server_tokens off;
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:4100;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_connect_timeout 30s;
        proxy_send_timeout 90s;
        proxy_read_timeout 90s;
    }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/uchiha-builder /etc/nginx/sites-enabled/uchiha-builder
nginx -t
systemctl enable --now nginx
systemctl reload nginx

log "Installing systemd timers"
cat > /etc/systemd/system/uchiha-autodeploy.service <<'SERVICE'
[Unit]
Description=UCHIHA Builder validated auto-deployment
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/uchiha-autodeploy
User=root
Group=root
Nice=10
SERVICE

cat > /etc/systemd/system/uchiha-autodeploy.timer <<'TIMER'
[Unit]
Description=Check for validated UCHIHA Builder releases

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
RandomizedDelaySec=30s
Persistent=true
Unit=uchiha-autodeploy.service

[Install]
WantedBy=timers.target
TIMER

cat > /etc/systemd/system/uchiha-backup.service <<'SERVICE'
[Unit]
Description=UCHIHA Builder PostgreSQL backup
Wants=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/uchiha-backup
User=root
Group=root
Nice=10
SERVICE

cat > /etc/systemd/system/uchiha-backup.timer <<'TIMER'
[Unit]
Description=Daily UCHIHA Builder PostgreSQL backup

[Timer]
OnCalendar=*-*-* 03:15:00
RandomizedDelaySec=10min
Persistent=true
Unit=uchiha-backup.service

[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now uchiha-autodeploy.timer uchiha-backup.timer

log "Creating the first verified backup"
systemctl start uchiha-backup.service

log "Verifying local application and Nginx"
curl --fail --silent --show-error http://127.0.0.1:4100/ready | jq .
curl --insecure --fail --silent --show-error \
  --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/ready" | jq .

log "Installation completed"
systemctl --no-pager --full status uchiha-autodeploy.timer uchiha-backup.timer || true
printf '\nCloudflare final settings:\n'
printf '1. DNS A @   -> server IP, Proxied\n'
printf '2. DNS A *   -> server IP, Proxied\n'
printf '3. DNS CNAME www -> %s, Proxied\n' "$DOMAIN"
printf '4. SSL/TLS encryption mode -> Full\n'
printf '\nNo GitHub VPS secrets are required. The server deploys only commits validated by GitHub Actions.\n'
