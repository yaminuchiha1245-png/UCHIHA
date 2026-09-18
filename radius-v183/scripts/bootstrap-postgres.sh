#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_ADMIN_URL:?POSTGRES_ADMIN_URL is required}"
: "${RUNTIME_DATABASE_PASSWORD:?RUNTIME_DATABASE_PASSWORD is required}"
: "${PLATFORM_DATABASE_PASSWORD:?PLATFORM_DATABASE_PASSWORD is required}"
: "${MIGRATOR_DATABASE_PASSWORD:?MIGRATOR_DATABASE_PASSWORD is required}"
: "${BACKUP_DATABASE_PASSWORD:?BACKUP_DATABASE_PASSWORD is required}"

for secret_name in RUNTIME_DATABASE_PASSWORD PLATFORM_DATABASE_PASSWORD MIGRATOR_DATABASE_PASSWORD BACKUP_DATABASE_PASSWORD; do
  if [ "${!secret_name}" = "" ] || [ "${#secret_name}" -lt 1 ]; then
    printf 'Invalid secret variable name\n' >&2
    exit 2
  fi
  secret_value="${!secret_name}"
  if [ "${#secret_value}" -lt 20 ]; then
    printf '%s must contain at least 20 characters\n' "$secret_name" >&2
    exit 2
  fi
done

node scripts/postgres-command.mjs POSTGRES_ADMIN_URL psql --no-psqlrc --set=ON_ERROR_STOP=1 --file=infra/postgres/bootstrap-roles.sql

: "${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}"
DATABASE_DRIVER=postgres DATABASE_URL="$MIGRATION_DATABASE_URL" \
  NODE_ENV=development ALLOW_DEV_AUTH=false npm run db:init

node scripts/postgres-command.mjs POSTGRES_ADMIN_URL psql --no-psqlrc --set=ON_ERROR_STOP=1 --file=infra/postgres/runtime-grants.sql
printf 'PostgreSQL roles, migrations and least-privilege grants completed.\n'
