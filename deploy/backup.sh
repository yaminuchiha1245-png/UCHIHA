#!/bin/sh
set -eu

# Backup only reads game_zone_state. It must not acquire the active Server
# writer advisory lock, and STORE_READ_ONLY prevents accidental mutations.
docker compose --env-file .env.production exec -T \
  -e PG_SINGLE_INSTANCE_LOCK=false \
  -e STORE_READ_ONLY=true \
  server npm run backup

echo "Backup stored in the persistent gamezone_backups Docker volume."
