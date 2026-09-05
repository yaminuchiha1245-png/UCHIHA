#!/bin/sh
set -eu
docker compose --env-file .env.production exec -T \
  -e PG_SINGLE_INSTANCE_LOCK=false \
  -e STORE_READ_ONLY=true \
  server npm run business-authority:verify
