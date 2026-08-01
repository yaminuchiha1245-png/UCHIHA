#!/usr/bin/env bash
set -Eeuo pipefail

exec 9>/run/lock/uchiha-autodeploy.lock
flock -n 9 || exit 0

REPO_DIR="${REPO_DIR:-/opt/uchiha}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/uchiha-deploy}"
DEPLOY_REF="${DEPLOY_REF:-deploy/builder-v1-platform}"
LOCAL_BRANCH="${LOCAL_BRANCH:-builder/v1-platform}"
BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_DIR/backups}"
SSH_KEY="${SSH_KEY:-/root/.ssh/uchiha_deploy}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4100/ready}"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

[[ $EUID -eq 0 ]] || fail "Run as root"
[[ -d "$REPO_DIR/.git" ]] || fail "Repository not found at $REPO_DIR"
[[ -f "$DEPLOY_DIR/compose.yml" ]] || fail "compose.yml not found at $DEPLOY_DIR"
[[ -f "$DEPLOY_DIR/.env" ]] || fail ".env not found at $DEPLOY_DIR"
[[ -f "$SSH_KEY" ]] || fail "GitHub deploy key not found at $SSH_KEY"

GIT_SSH_COMMAND="ssh -i $SSH_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
export GIT_SSH_COMMAND

cd "$REPO_DIR"
remote_sha="$(git ls-remote origin "refs/heads/$DEPLOY_REF" | awk 'NR==1 {print $1}')"
[[ -n "$remote_sha" ]] || fail "Validated deploy ref $DEPLOY_REF is not available yet"
current_sha="$(git rev-parse HEAD)"

if [[ "$current_sha" == "$remote_sha" ]]; then
  log "Already running validated commit $current_sha"
  exit 0
fi

log "Validated update found: $current_sha -> $remote_sha"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(date -u +%Y-%m-%d_%H-%M-%S)"
tmp_backup="$BACKUP_DIR/.uchiha_builder_${timestamp}.dump.tmp"
final_backup="$BACKUP_DIR/uchiha_builder_${timestamp}.dump"

cd "$DEPLOY_DIR"
log "Creating PostgreSQL backup"
docker compose exec -T postgres \
  pg_dump -U uchiha -d uchiha_builder -Fc > "$tmp_backup"
mv "$tmp_backup" "$final_backup"
chmod 600 "$final_backup"
find "$BACKUP_DIR" -type f -name '*.dump' -mtime +14 -delete

cd "$REPO_DIR"
log "Fetching validated source"
git fetch --prune origin "refs/heads/$DEPLOY_REF"
git checkout -B "$LOCAL_BRANCH" FETCH_HEAD
git reset --hard FETCH_HEAD

cd "$DEPLOY_DIR"
log "Building API and worker images"
docker compose build api worker

log "Applying migrations and safe seed operations"
docker compose run --rm api npm run bootstrap

log "Restarting application services"
docker compose up -d --remove-orphans postgres api worker

ready=false
for attempt in $(seq 1 40); do
  if response="$(curl --fail --silent --show-error "$HEALTH_URL" 2>/dev/null)" \
    && grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"' <<<"$response" \
    && grep -Eq '"persistent"[[:space:]]*:[[:space:]]*true' <<<"$response"; then
    ready=true
    break
  fi
  sleep 3
done

if [[ "$ready" != true ]]; then
  docker compose logs --tail=180 api worker >&2 || true
  fail "Readiness check failed after deploying $remote_sha"
fi

log "Deployment completed successfully: $remote_sha"
docker compose ps
