#!/bin/sh
set -eu
COMPOSE="docker compose --env-file .env.production"

restart_stack() {
  $COMPOSE up -d server
  tries=0
  while [ "$tries" -lt 40 ]; do
    if $COMPOSE exec -T server node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      $COMPOSE up -d bot caddy
      echo "Game Zone services are online."
      return 0
    fi
    tries=$((tries+1));sleep 2
  done
  return 1
}

echo "Stopping Bot/Caddy/Server for exclusive financial-mirror rebuild..."
$COMPOSE stop bot caddy server

if $COMPOSE run --rm -T \
  -e ALLOW_FINANCIAL_MIRROR_REBUILD=true \
  server npm run financial-mirror:rebuild
then
  echo "Financial mirror rebuild completed."
  restart_stack
else
  code=$?
  echo "Financial mirror rebuild failed; attempting to restart the existing stack." >&2
  restart_stack || true
  exit "$code"
fi
