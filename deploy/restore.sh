#!/bin/sh
set -eu

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "Usage: ./restore.sh /app/server/backups/game-zone-....json"
  exit 1
fi

COMPOSE="docker compose --env-file .env.production"

restart_stack() {
  echo "Starting Game Zone services..."
  $COMPOSE up -d server
  echo "Waiting for Server health..."
  tries=0
  while [ "$tries" -lt 40 ]; do
    if $COMPOSE exec -T server node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      $COMPOSE up -d bot caddy
      echo "Game Zone services are online."
      return 0
    fi
    tries=$((tries+1))
    sleep 2
  done
  echo "Server did not become ready after restore." >&2
  return 1
}

echo "Stopping public Game Zone services for exclusive restore..."
$COMPOSE stop bot caddy server

echo "Running isolated restore. Recovery must acquire the normal PostgreSQL writer advisory lock..."
if $COMPOSE run --rm -T \
  -e ALLOW_RESTORE=true \
  server npm run restore -- "$FILE"
then
  echo "Restore completed successfully."
  restart_stack
else
  code=$?
  echo "Restore failed. The Server was stopped to prevent concurrent writes." >&2
  echo "Attempting to bring the existing stack back online..." >&2
  restart_stack || true
  exit "$code"
fi
