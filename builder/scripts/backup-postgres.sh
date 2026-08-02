#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
ENV_FILE="${UCHIHA_ENV_FILE:-$ROOT_DIR/.env}"
BACKUP_DIR="${UCHIHA_BACKUP_DIR:-/var/backups/uchiha}"
CONTAINER="${UCHIHA_POSTGRES_CONTAINER:-uchiha-postgres}"

exec 9>/run/lock/uchiha-backup.lock
flock -n 9 || { echo "A UCHIHA backup is already running" >&2; exit 1; }
[[ -r "$ENV_FILE" ]] || { echo "Missing environment file: $ENV_FILE" >&2; exit 1; }

env_value() {
  grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

POSTGRES_USER="$(env_value POSTGRES_USER)"
POSTGRES_DB="$(env_value POSTGRES_DB)"
POSTGRES_PASSWORD="$(env_value POSTGRES_PASSWORD)"
[[ -n "$POSTGRES_USER" && -n "$POSTGRES_DB" && -n "$POSTGRES_PASSWORD" ]] || {
  echo "PostgreSQL backup configuration is incomplete" >&2
  exit 1
}

docker inspect "$CONTAINER" >/dev/null 2>&1 || { echo "PostgreSQL container is not running: $CONTAINER" >&2; exit 1; }
install -d -m 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FINAL="$BACKUP_DIR/uchiha-$STAMP.dump"
TMP="$FINAL.tmp"
trap 'rm -f "$TMP"' EXIT

docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges >"$TMP"
[[ -s "$TMP" ]] || { echo "Backup file is empty" >&2; exit 1; }
cat "$TMP" | docker exec -i "$CONTAINER" pg_restore -l >/dev/null
mv "$TMP" "$FINAL"
chmod 600 "$FINAL"
find "$BACKUP_DIR" -type f -name 'uchiha-*.dump' -mtime +13 -delete
trap - EXIT
printf '%s\n' "$FINAL"
