#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
REPO_DIR="${UCHIHA_REPO_DIR:-$ROOT_DIR/repo}"
BRANCH="builder/v1-platform"
COMPOSE=(docker compose -f "$ROOT_DIR/compose.yml" --project-directory "$ROOT_DIR")

log() { printf '\n==> %s\n' "$*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

[[ ${EUID:-$(id -u)} -eq 0 ]] || fail "Run as root"
[[ -d "$REPO_DIR/.git" ]] || fail "Repository not found at $REPO_DIR"
[[ -r "$ROOT_DIR/.env" ]] || fail "Environment file not found at $ROOT_DIR/.env"
cd "$REPO_DIR"
git diff --quiet && git diff --cached --quiet || fail "Refusing recovery while repository has local changes"

log "Starting Docker"
systemctl enable --now docker

docker info >/dev/null 2>&1 || fail "Docker daemon is not available"

# Restore the last known production image first when runtime files still exist.
# This is intentionally best-effort: it can bring the public service back while
# the verified target image is being built, without touching PostgreSQL volumes.
if [[ -f "$ROOT_DIR/compose.yml" ]] && docker image inspect uchiha-builder:production >/dev/null 2>&1; then
  log "Attempting immediate recovery of the last production stack"
  "${COMPOSE[@]}" up -d postgres || true
  for _ in $(seq 1 45); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' uchiha-postgres 2>/dev/null || true)" == "healthy" ]] && break
    sleep 2
  done
  if [[ "$(docker inspect -f '{{.State.Health.Status}}' uchiha-postgres 2>/dev/null || true)" == "healthy" ]]; then
    "${COMPOSE[@]}" up -d api worker tls-ask caddy || true
  fi
fi

log "Fetching the exact production branch"
git fetch --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
TARGET_SHA="$(git rev-parse "origin/$BRANCH")"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "Invalid target SHA: $TARGET_SHA"
CURRENT_RELEASE="$(cat "$ROOT_DIR/current-release" 2>/dev/null || true)"
printf 'Current verified release: %s\n' "${CURRENT_RELEASE:-none}"
printf 'Recovery target: %s\n' "$TARGET_SHA"

log "Checking out the recovery target"
git checkout -B "$BRANCH" "$TARGET_SHA"
[[ "$(git rev-parse HEAD)" == "$TARGET_SHA" ]] || fail "Repository HEAD does not match target"

# A human-triggered rescue is an explicit request to retry the newest SHA once.
# update-vps.sh remains fail-closed and performs a verified PostgreSQL backup,
# restore test, migrations, runtime preflight, staged API rollout, smoke tests,
# and rollback on any failure.
rm -f "$ROOT_DIR/failed-release"

# Re-enable existing control-plane units before the long build when present.
systemctl enable --now uchiha-autodeploy.timer >/dev/null 2>&1 || true
systemctl enable --now uchiha-backup.timer >/dev/null 2>&1 || true

log "Running the safe production updater"
env UCHIHA_ROOT_DIR="$ROOT_DIR" UCHIHA_REPO_DIR="$REPO_DIR" \
  bash "$REPO_DIR/builder/scripts/update-vps.sh"

log "Reinstalling persistent VPS automation"
bash "$REPO_DIR/builder/scripts/install-vps-automation.sh"
systemctl enable --now docker uchiha-autodeploy.timer uchiha-backup.timer >/dev/null

log "Ensuring the full runtime is up"
"${COMPOSE[@]}" up -d --remove-orphans postgres api worker tls-ask caddy

log "Verifying the deployed release internally"
DEPLOYED_SHA="$(cat "$ROOT_DIR/current-release" 2>/dev/null || true)"
[[ "$DEPLOYED_SHA" == "$TARGET_SHA" ]] || fail "current-release does not match target"
docker exec uchiha-api node -e \
  "fetch('http://127.0.0.1:4100/ready').then(async r=>{const t=await r.text();console.log(t);if(!r.ok)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})"

log "Final container state"
"${COMPOSE[@]}" ps
ss -ltnp 2>/dev/null | awk 'NR==1 || $4 ~ /:22$|:80$|:443$/' || true

printf '\nUCHIHA VPS recovery completed successfully at %s\n' "$TARGET_SHA"
