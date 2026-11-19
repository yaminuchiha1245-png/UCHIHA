#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
ENV_FILE="${UCHIHA_ENV_FILE:-$ROOT_DIR/.env}"
BACKUP_DIR="${UCHIHA_BACKUP_DIR:-/var/backups/uchiha}"
CONTAINER="${UCHIHA_POSTGRES_CONTAINER:-uchiha-postgres}"
BACKUP_FILE="${1:-$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'uchiha-*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2-)}"

[[ -n "$BACKUP_FILE" && -s "$BACKUP_FILE" ]] || { echo "No non-empty backup file found" >&2; exit 1; }
[[ -r "$ENV_FILE" ]] || { echo "Missing environment file: $ENV_FILE" >&2; exit 1; }

env_value() {
  grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}
POSTGRES_USER="$(env_value POSTGRES_USER)"
POSTGRES_PASSWORD="$(env_value POSTGRES_PASSWORD)"
TEST_DB="uchiha_restore_test_$(date -u +%s)_$RANDOM"
cleanup() {
  docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER" \
    psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"$TEST_DB\" WITH (FORCE);" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cat "$BACKUP_FILE" | docker exec -i "$CONTAINER" pg_restore -l >/dev/null
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER" \
  createdb -U "$POSTGRES_USER" "$TEST_DB"
cat "$BACKUP_FILE" | docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER" \
  pg_restore -U "$POSTGRES_USER" -d "$TEST_DB" --no-owner --no-privileges --exit-on-error
TABLE_COUNT="$(docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER" \
  psql -U "$POSTGRES_USER" -d "$TEST_DB" -Atqc "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public';")"
[[ "$TABLE_COUNT" =~ ^[1-9][0-9]*$ ]] || { echo "Restored database contains no public tables" >&2; exit 1; }
printf 'Restore test passed: %s tables from %s\n' "$TABLE_COUNT" "$BACKUP_FILE"
