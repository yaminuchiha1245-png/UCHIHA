#!/bin/sh
set -eu

REVISION="${1:-}"
if ! printf '%s' "$REVISION" | grep -Eq '^[1-9][0-9]*$'; then
  echo "Usage: ./state-rollback.sh <history-revision>"
  exit 1
fi

CONFIRM="ROLLBACK_TO_REVISION_${REVISION}"
COMPOSE="docker compose --env-file .env.production"

restart_stack() {
  echo "Starting Game Zone services..."
  $COMPOSE up -d server
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
  echo "Server did not become ready after state rollback." >&2
  return 1
}

echo "This will restore historical snapshot revision ${REVISION} as a NEW active revision."
echo "Stopping Bot/Caddy/Server so the rollback process can acquire the writer advisory lock..."
$COMPOSE stop bot caddy server

if $COMPOSE run --rm -T \
  -e ALLOW_STATE_ROLLBACK=true \
  -e PG_SINGLE_INSTANCE_LOCK=true \
  server npm run state:rollback -- "$REVISION" "$CONFIRM"
then
  echo "Point-in-time state rollback completed."
  restart_stack
else
  code=$?
  echo "State rollback failed. Attempting to restore the existing service stack..." >&2
  restart_stack || true
  exit "$code"
fi
