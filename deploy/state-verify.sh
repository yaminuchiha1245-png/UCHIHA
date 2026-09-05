#!/bin/sh
set -eu
docker compose --env-file .env.production exec -T \
  -e PG_SINGLE_INSTANCE_LOCK=false \
  server npm run state:verify
