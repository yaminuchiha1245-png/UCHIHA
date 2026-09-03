#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null
apt-get install -y curl jq openssl ca-certificates >/dev/null

SECRETS_DIR=/etc/uchiha/secrets
ENV_FILE="$SECRETS_DIR/game-zone.env"
DEFAULT_DOMAIN="gamezone.155-254-35-187.sslip.io"
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

printf 'Game Zone domain [%s]: ' "$DEFAULT_DOMAIN"
read -r DOMAIN
DOMAIN=${DOMAIN:-$DEFAULT_DOMAIN}
DOMAIN=${DOMAIN#https://}
DOMAIN=${DOMAIN#http://}
DOMAIN=${DOMAIN%%/*}

read -r -s -p 'Telegram BOT_TOKEN: ' BOT_TOKEN
echo
if [ -z "$BOT_TOKEN" ]; then
  echo 'ERROR: BOT_TOKEN is required' >&2
  exit 1
fi

BOT_INFO="$(curl -fsSL --connect-timeout 10 --max-time 20 "https://api.telegram.org/bot${BOT_TOKEN}/getMe")" || {
  echo 'ERROR: Telegram rejected the token or network request failed.' >&2
  exit 1
}
if [ "$(printf '%s' "$BOT_INFO" | jq -r '.ok // false')" != "true" ]; then
  echo 'ERROR: Telegram BOT_TOKEN validation failed.' >&2
  exit 1
fi
BOT_USERNAME="$(printf '%s' "$BOT_INFO" | jq -r '.result.username // empty')"
if [ -z "$BOT_USERNAME" ]; then
  echo 'ERROR: Telegram bot username could not be detected.' >&2
  exit 1
fi

echo "Detected bot: @${BOT_USERNAME}"
read -r -p 'Admin Telegram numeric ID: ' ADMIN_IDS
if ! printf '%s' "$ADMIN_IDS" | grep -Eq '^[0-9]+(,[0-9]+)*$'; then
  echo 'ERROR: enter Telegram numeric ID only, for example 123456789' >&2
  exit 1
fi

read -r -p "Support username [${BOT_USERNAME}]: " SUPPORT_USERNAME
SUPPORT_USERNAME=${SUPPORT_USERNAME#@}
SUPPORT_USERNAME=${SUPPORT_USERNAME:-$BOT_USERNAME}

while true; do
  read -r -s -p 'Admin panel password (minimum 12 characters): ' ADMIN_PASSWORD
  echo
  if [ "${#ADMIN_PASSWORD}" -lt 12 ]; then
    echo 'Password is too short.'
    continue
  fi
  read -r -s -p 'Repeat admin panel password: ' ADMIN_PASSWORD_2
  echo
  if [ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_2" ]; then
    echo 'Passwords do not match.'
    continue
  fi
  break
done

hex32(){ openssl rand -hex 32; }
b64_32(){ openssl rand -base64 32 | tr -d '\n'; }

POSTGRES_PASSWORD="$(hex32)"
INTERNAL_BOT_SECRET="$(hex32)"
INTERNAL_BOT_ADMIN_SECRET="$(hex32)"
ADMIN_SESSION_SECRET="$(hex32)"
USER_SESSION_SECRET="$(hex32)"
INVENTORY_ENCRYPTION_KEY="$(b64_32)"
BACKUP_ENCRYPTION_KEY="$(b64_32)"
PROVIDER_WEBHOOK_SECRET="$(hex32)"
PAYMENT_WEBHOOK_SECRET="$(hex32)"
AUDIT_HMAC_KEY="$(hex32)"
STATE_HMAC_KEY="$(hex32)"
FINANCIAL_JOURNAL_HMAC_KEY="$(hex32)"
WALLET_AUTHORITY_HMAC_KEY="$(hex32)"
BUSINESS_AUTHORITY_HMAC_KEY="$(hex32)"

umask 077
cat >"$ENV_FILE" <<EOF
STORAGE_DRIVER=postgres
DOMAIN=$DOMAIN
POSTGRES_DB=gamezone
POSTGRES_USER=gamezone
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
BOT_TOKEN=$BOT_TOKEN
BOT_USERNAME=$BOT_USERNAME
SUPPORT_USERNAME=$SUPPORT_USERNAME
REQUIRED_CHANNEL=
ADMIN_TELEGRAM_IDS=$ADMIN_IDS
INTERNAL_BOT_SECRET=$INTERNAL_BOT_SECRET
INTERNAL_BOT_ADMIN_SECRET=$INTERNAL_BOT_ADMIN_SECRET
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_SESSION_SECRET=$ADMIN_SESSION_SECRET
USER_SESSION_SECRET=$USER_SESSION_SECRET
INVENTORY_ENCRYPTION_KEY=$INVENTORY_ENCRYPTION_KEY
BACKUP_ENCRYPTION_KEY=$BACKUP_ENCRYPTION_KEY
ALLOWED_ORIGINS=https://$DOMAIN
ALLOW_LEGACY_ADMIN_KEY=false
ADMIN_SESSION_HOURS=12
PROVIDER_WEBHOOK_SECRET=$PROVIDER_WEBHOOK_SECRET
SUPPLIER_TOKEN=
ORDER_SYNC_INTERVAL_MS=60000
PAYMENT_WEBHOOK_SECRET=$PAYMENT_WEBHOOK_SECRET
TELEGRAM_HTTP_TIMEOUT_MS=12000
BROADCAST_DELAY_MS=45
PG_POOL_MAX=5
PG_CONNECT_TIMEOUT_MS=10000
PG_IDLE_TIMEOUT_MS=30000
PG_PERSIST_RETRIES=3
BACKUP_INTERVAL_SECONDS=86400
PUBLIC_BASE_URL=https://$DOMAIN
STORAGE_FAIL_FAST=true
PG_SINGLE_INSTANCE_LOCK=true
OPERATION_LOCK_TIMEOUT_MS=30000
BACKUP_RETENTION_DAYS=30
BACKUP_MAX_FILES=30
TELEGRAM_INIT_DATA_MAX_AGE_SECONDS=3600
AUDIT_HMAC_KEY=$AUDIT_HMAC_KEY
STATE_HMAC_KEY=$STATE_HMAC_KEY
FINANCIAL_JOURNAL_HMAC_KEY=$FINANCIAL_JOURNAL_HMAC_KEY
WALLET_AUTHORITY_HMAC_KEY=$WALLET_AUTHORITY_HMAC_KEY
BUSINESS_AUTHORITY_HMAC_KEY=$BUSINESS_AUTHORITY_HMAC_KEY
JSON_BODY_LIMIT=2mb
BACKUP_MAX_AGE_HOURS=48
ALLOW_PRODUCTION_PRIVATE_PROVIDER=false
ALLOW_PRODUCTION_INSECURE_PROVIDER=false
SAFETY_BACKUP_RETENTION_DAYS=90
SAFETY_BACKUP_MAX_FILES=60
BACKUP_RETRY_SECONDS=300
BACKUP_MAX_CONSECUTIVE_FAILURES=3
SHUTDOWN_GRACE_MS=10000
PG_STATE_HISTORY_MAX=200
PG_STATE_HISTORY_RETENTION_DAYS=90
PG_STATE_HISTORY_MIN_INTERVAL_SECONDS=300
STATE_VERIFY_INTERVAL_MS=300000
PG_FINANCIAL_MIRROR=true
PG_FINANCIAL_JOURNAL=true
PG_WALLET_AUTHORITY=true
PG_BUSINESS_AUTHORITY=true
UPLOAD_DIR=/app/server/uploads
RECEIPT_DIR=/app/server/receipts
IMAGE_UPLOAD_MAX_BYTES=2097152
RECEIPT_MAX_BYTES=1048576
EOF
chmod 600 "$ENV_FILE"
unset BOT_TOKEN ADMIN_PASSWORD ADMIN_PASSWORD_2

# Caddy will own ports 80/443 for Game Zone.
systemctl disable --now nginx.service 2>/dev/null || true
systemctl disable --now game-zone-bot.service 2>/dev/null || true
systemctl disable --now uchiha-store.service 2>/dev/null || true

# Force the GitHub control agent to re-apply Game Zone after secrets are present.
rm -f /var/lib/uchiha-control/game-zone.sha
systemctl start uchiha-control.service 2>/dev/null || true

echo
echo 'GAME_ZONE_SECRETS=READY'
echo "BOT=@${BOT_USERNAME}"
echo "STORE=https://${DOMAIN}/"
echo "ADMIN=https://${DOMAIN}/admin/"
echo "ENV=${ENV_FILE}"
echo 'No secret value was uploaded to GitHub.'
