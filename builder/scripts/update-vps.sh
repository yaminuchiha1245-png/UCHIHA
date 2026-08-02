#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
REPO_DIR="${UCHIHA_REPO_DIR:-$ROOT_DIR/repo}"
BRANCH="builder/v1-platform"
COMPOSE=(docker compose -f "$ROOT_DIR/compose.yml" --project-directory "$ROOT_DIR")
LOG_DIR="/var/log/uchiha"
install -d -m 700 "$LOG_DIR"
LOG_FILE="$LOG_DIR/update-$(date -u +%Y%m%dT%H%M%SZ).log"
exec > >(tee -a "$LOG_FILE") 2>&1
exec 9>/run/lock/uchiha-update.lock
flock -n 9 || { echo "Another UCHIHA update is running" >&2; exit 1; }

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ -d "$REPO_DIR/.git" ]] || { echo "Repository not found at $REPO_DIR" >&2; exit 1; }
[[ -r "$ROOT_DIR/.env" ]] || { echo "Environment file not found at $ROOT_DIR/.env" >&2; exit 1; }

cd "$REPO_DIR"
git diff --quiet && git diff --cached --quiet || { echo "Refusing to overwrite local repository changes" >&2; exit 1; }
CURRENT_BRANCH="$(git branch --show-current)"
[[ "$CURRENT_BRANCH" == "$BRANCH" ]] || { echo "Refusing update from branch $CURRENT_BRANCH; expected $BRANCH" >&2; exit 1; }
PREVIOUS_SHA="$(git rev-parse HEAD)"
echo "Current commit: $PREVIOUS_SHA"

BACKUP_FILE="$(bash "$REPO_DIR/builder/scripts/backup-postgres.sh")"
[[ -s "$BACKUP_FILE" ]] || { echo "Backup verification failed" >&2; exit 1; }
bash "$REPO_DIR/builder/scripts/restore-test.sh" "$BACKUP_FILE"

git fetch --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
TARGET_SHA="$(git rev-parse "origin/$BRANCH")"
echo "Target commit: $TARGET_SHA"
if [[ "$TARGET_SHA" == "$PREVIOUS_SHA" ]]; then
  echo "Already on the latest builder/v1-platform commit. Running health checks only."
  bash "$REPO_DIR/builder/scripts/smoke-vps.sh"
  exit 0
fi

OLD_IMAGE_ID="$(docker image inspect uchiha-builder:production --format '{{.Id}}' 2>/dev/null || true)"
if [[ -n "$OLD_IMAGE_ID" ]]; then docker tag "$OLD_IMAGE_ID" "uchiha-builder:rollback-$PREVIOUS_SHA"; fi
DEPLOYMENT_STARTED=false
rollback() {
  local status="$1"
  trap - ERR
  echo "Update failed with status $status. Attempting rollback to $PREVIOUS_SHA." >&2
  if [[ "$DEPLOYMENT_STARTED" == true ]]; then
    git -C "$REPO_DIR" checkout -B "$BRANCH" "$PREVIOUS_SHA" || true
    if docker image inspect "uchiha-builder:rollback-$PREVIOUS_SHA" >/dev/null 2>&1; then
      docker tag "uchiha-builder:rollback-$PREVIOUS_SHA" uchiha-builder:production || true
    fi
    bash "$REPO_DIR/builder/scripts/render-vps-runtime.sh" || true
    "${COMPOSE[@]}" up -d --force-recreate --remove-orphans postgres api worker tls-ask caddy || true
    "${COMPOSE[@]}" logs --tail=160 api worker caddy postgres >&2 || true
  fi
  echo "Rollback attempt finished. PostgreSQL volumes were not removed. Log: $LOG_FILE" >&2
  exit "$status"
}
trap 'rollback $?' ERR

git checkout -B "$BRANCH" "$TARGET_SHA"
[[ "$(git branch --show-current)" == "$BRANCH" ]] || { echo "Branch safety check failed" >&2; exit 1; }
[[ -f builder/package.json ]] || { echo "builder/package.json is missing" >&2; exit 1; }

echo "Building Docker image uchiha-builder:$TARGET_SHA"
docker build --pull -t "uchiha-builder:$TARGET_SHA" builder
docker tag "uchiha-builder:$TARGET_SHA" uchiha-builder:production
DEPLOYMENT_STARTED=true

bash "$REPO_DIR/builder/scripts/render-vps-runtime.sh"
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" up -d postgres

for _ in $(seq 1 60); do
  [[ "$(docker inspect -f '{{.State.Health.Status}}' uchiha-postgres 2>/dev/null || true)" == "healthy" ]] && break
  sleep 2
done
[[ "$(docker inspect -f '{{.State.Health.Status}}' uchiha-postgres 2>/dev/null || true)" == "healthy" ]] || { echo "PostgreSQL did not become healthy" >&2; exit 1; }

echo "Applying safe migrations twice to verify idempotency"
"${COMPOSE[@]}" run --rm api npm run bootstrap
"${COMPOSE[@]}" run --rm api npm run bootstrap

"${COMPOSE[@]}" up -d --force-recreate --remove-orphans api worker tls-ask caddy
for _ in $(seq 1 60); do
  [[ "$(docker inspect -f '{{.State.Health.Status}}' uchiha-api 2>/dev/null || true)" == "healthy" ]] && break
  sleep 2
done
[[ "$(docker inspect -f '{{.State.Health.Status}}' uchiha-api 2>/dev/null || true)" == "healthy" ]] || { echo "API did not become healthy" >&2; exit 1; }

"${COMPOSE[@]}" exec -T api npm run verify:production
bash "$REPO_DIR/builder/scripts/smoke-vps.sh"

trap - ERR
printf '%s\n' "$TARGET_SHA" >"$ROOT_DIR/current-release"
chmod 600 "$ROOT_DIR/current-release"
echo "Update completed successfully: $PREVIOUS_SHA -> $TARGET_SHA"
echo "Backup: $BACKUP_FILE"
echo "Log: $LOG_FILE"
"${COMPOSE[@]}" ps
