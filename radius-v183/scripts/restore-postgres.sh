#!/usr/bin/env bash
set -euo pipefail

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"

backup_file="${1:-}"
if [ -z "$backup_file" ] || [ ! -f "$backup_file" ]; then
  printf 'Usage: RESTORE_DATABASE_URL=... scripts/restore-postgres.sh /absolute/path/to/backup.dump\n' >&2
  exit 2
fi
case "$backup_file" in
  /*) ;;
  *)
    printf 'Backup file path must be absolute\n' >&2
    exit 2
    ;;
esac

"$(dirname "$0")/verify-backup.sh" "$backup_file"

existing_tables="$(node "$(dirname "$0")/postgres-command.mjs" RESTORE_DATABASE_URL psql --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 \
  --command="SELECT COUNT(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');")"
if [ "$existing_tables" != "0" ]; then
  printf 'Restore target must be an empty database; found %s user tables.\n' "$existing_tables" >&2
  exit 2
fi

node "$(dirname "$0")/postgres-command.mjs" RESTORE_DATABASE_URL pg_restore --exit-on-error --single-transaction --no-owner --no-acl "$backup_file"

migration_count="$(node "$(dirname "$0")/postgres-command.mjs" RESTORE_DATABASE_URL psql --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 \
  --command="SELECT COUNT(*) FROM schema_migrations;")"
if ! [[ "$migration_count" =~ ^[1-9][0-9]*$ ]]; then
  printf 'Restored database is missing migration history.\n' >&2
  exit 1
fi
node "$(dirname "$0")/postgres-command.mjs" RESTORE_DATABASE_URL psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --command="SELECT 1 FROM tenants LIMIT 0; SELECT 1 FROM radius_nodes LIMIT 0; SELECT 1 FROM webhook_events LIMIT 0;" >/dev/null
printf 'Backup restored successfully into an empty database with %s migrations.\n' "$migration_count"
