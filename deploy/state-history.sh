#!/bin/sh
set -eu
LIMIT="${1:-20}"
docker compose --env-file .env.production exec -T \
  -e PG_SINGLE_INSTANCE_LOCK=false \
  server npm run state:history -- "$LIMIT"
