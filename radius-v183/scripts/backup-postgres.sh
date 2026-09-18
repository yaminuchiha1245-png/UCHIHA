#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is required}"
: "${BACKUP_DIRECTORY:?BACKUP_DIRECTORY is required}"

case "$BACKUP_DIRECTORY" in
  /*) ;;
  *)
    printf 'BACKUP_DIRECTORY must be an absolute path\n' >&2
    exit 2
    ;;
esac

BACKUP_DIRECTORY="$(realpath -m -- "$BACKUP_DIRECTORY")"
case "$BACKUP_DIRECTORY" in
  /|/root|/home|"$HOME"|.)
    printf 'Refusing unsafe BACKUP_DIRECTORY\n' >&2
    exit 2
    ;;
esac

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || [ "$RETENTION_DAYS" -lt 1 ]; then
  printf 'BACKUP_RETENTION_DAYS must be a positive integer\n' >&2
  exit 2
fi

install -d -m 0700 "$BACKUP_DIRECTORY"
exec 9>"$BACKUP_DIRECTORY/.backup.lock"
if ! flock -n 9; then
  printf 'Another backup is already running.\n' >&2
  exit 2
fi
backup_access="$(node "$(dirname "$0")/postgres-command.mjs" BACKUP_DATABASE_URL psql --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 \
  --command="SELECT current_user = 'uchiha_backup' AND app.has_tenant_access('__backup_scope_probe__');")"
if [ "$backup_access" != "t" ]; then
  printf 'Backup requires the dedicated backup role and migration 009; refusing a potentially incomplete archive.\n' >&2
  exit 2
fi
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIRECTORY/uchiha-radius-$timestamp.dump"
partial="$target.partial"
checksum_partial="$target.sha256.partial"

if [ -e "$target" ] || [ -e "$target.sha256" ]; then
  printf 'A backup with this timestamp already exists: %s\n' "$target" >&2
  exit 2
fi

cleanup_partial() {
  rm -f -- "$partial" "$checksum_partial"
}
trap cleanup_partial EXIT HUP INT TERM

umask 077
node "$(dirname "$0")/postgres-command.mjs" BACKUP_DATABASE_URL pg_dump --format=custom --compress=9 --no-owner --no-acl --enable-row-security --file="$partial"
pg_restore --list "$partial" >/dev/null
checksum="$(sha256sum "$partial" | awk '{print $1}')"
printf '%s\n' "$checksum" > "$checksum_partial"
mv -- "$partial" "$target"
mv -- "$checksum_partial" "$target.sha256"
trap - EXIT HUP INT TERM
find "$BACKUP_DIRECTORY" -maxdepth 1 -type f \( -name 'uchiha-radius-*.dump' -o -name 'uchiha-radius-*.dump.sha256' \) -mtime "+$RETENTION_DAYS" -delete
printf 'Verified backup created: %s\n' "$target"
