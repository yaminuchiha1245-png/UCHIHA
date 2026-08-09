#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
REPO_DIR="${UCHIHA_REPO_DIR:-$ROOT_DIR/repo}"
BRANCH="builder/v1-platform"
BACKUP_DIR="${UCHIHA_BACKUP_DIR:-/var/backups/uchiha}"
POSTGRES_CONTAINER="${UCHIHA_POSTGRES_CONTAINER:-uchiha-postgres}"
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

env_value() {
  grep -E "^$1=" "$ROOT_DIR/.env" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

create_verified_backup() {
  local user database password stamp final temporary
  user="$(env_value POSTGRES_USER)"
  database="$(env_value POSTGRES_DB)"
  password="$(env_value POSTGRES_PASSWORD)"
  [[ -n "$user" && -n "$database" && -n "$password" ]] || { echo "PostgreSQL backup configuration is incomplete" >&2; return 1; }
  docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 || { echo "PostgreSQL container is unavailable" >&2; return 1; }
  install -d -m 700 "$BACKUP_DIR"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  final="$BACKUP_DIR/uchiha-$stamp.dump"
  temporary="$final.tmp"
  rm -f "$temporary"
  docker exec -e PGPASSWORD="$password" "$POSTGRES_CONTAINER" \
    pg_dump -U "$user" -d "$database" -Fc --no-owner --no-privileges >"$temporary"
  [[ -s "$temporary" ]] || { echo "Backup file is empty" >&2; rm -f "$temporary"; return 1; }
  cat "$temporary" | docker exec -i "$POSTGRES_CONTAINER" pg_restore -l >/dev/null
  mv "$temporary" "$final"
  chmod 600 "$final"
  find "$BACKUP_DIR" -type f -name 'uchiha-*.dump' -mtime +13 -delete
  printf '%s\n' "$final"
}

restore_test() (
  set -Eeuo pipefail
  local backup="$1" user password test_database table_count
  user="$(env_value POSTGRES_USER)"
  password="$(env_value POSTGRES_PASSWORD)"
  test_database="uchiha_restore_test_$(date -u +%s)_$RANDOM"
  cleanup_restore_test() {
    docker exec -e PGPASSWORD="$password" "$POSTGRES_CONTAINER" \
      psql -U "$user" -d postgres -v ON_ERROR_STOP=1 \
      -c "DROP DATABASE IF EXISTS \"$test_database\" WITH (FORCE);" >/dev/null 2>&1 || true
  }
  trap cleanup_restore_test EXIT
  cat "$backup" | docker exec -i "$POSTGRES_CONTAINER" pg_restore -l >/dev/null
  docker exec -e PGPASSWORD="$password" "$POSTGRES_CONTAINER" createdb -U "$user" "$test_database"
  cat "$backup" | docker exec -i -e PGPASSWORD="$password" "$POSTGRES_CONTAINER" \
    pg_restore -U "$user" -d "$test_database" --no-owner --no-privileges --exit-on-error
  table_count="$(docker exec -e PGPASSWORD="$password" "$POSTGRES_CONTAINER" \
    psql -U "$user" -d "$test_database" -Atqc "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public';")"
  [[ "$table_count" =~ ^[1-9][0-9]*$ ]] || { echo "Restore test produced no public tables" >&2; exit 1; }
  echo "Restore test passed with $table_count public tables"
)

install_backup_schedule() {
  install -d -m 700 "$BACKUP_DIR"
  install -m 700 "$REPO_DIR/builder/scripts/backup-postgres.sh" /usr/local/sbin/uchiha-backup
  install -m 700 "$REPO_DIR/builder/scripts/restore-test.sh" /usr/local/sbin/uchiha-restore-test
  cat >/etc/systemd/system/uchiha-backup.service <<'SERVICE'
[Unit]
Description=UCHIHA PostgreSQL verified backup
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/uchiha-backup
User=root
Group=root
Nice=10
SERVICE
  cat >/etc/systemd/system/uchiha-backup.timer <<'TIMER'
[Unit]
Description=Daily UCHIHA PostgreSQL backup

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true
RandomizedDelaySec=900
Unit=uchiha-backup.service

[Install]
WantedBy=timers.target
TIMER
  systemctl daemon-reload
  systemctl enable --now uchiha-backup.timer
  systemctl is-enabled --quiet uchiha-backup.timer
  systemctl is-active --quiet uchiha-backup.timer
}

container_matches_source() {
  local relative source_hash container_hash
  local files=(
    "src/start.mjs"
    "src/db.mjs"
    "src/ai-product-activation-guard.mjs"
    "src/ai-bot-token-ownership-guard.mjs"
    "public/ai-bot-purchase.js"
    "public/theme.js"
  )
  docker inspect uchiha-api >/dev/null 2>&1 || return 1
  for relative in "${files[@]}"; do
    [[ -f "$REPO_DIR/builder/$relative" ]] || return 1
    source_hash="$(sha256sum "$REPO_DIR/builder/$relative" | cut -d' ' -f1)"
    container_hash="$(docker exec uchiha-api sha256sum "/app/$relative" 2>/dev/null | cut -d' ' -f1 || true)"
    [[ -n "$container_hash" && "$source_hash" == "$container_hash" ]] || return 1
  done
  return 0
}

verify_ai_schema() {
  local user database password result
  user="$(env_value POSTGRES_USER)"
  database="$(env_value POSTGRES_DB)"
  password="$(env_value POSTGRES_PASSWORD)"
  result="$(docker exec -e PGPASSWORD="$password" "$POSTGRES_CONTAINER" \
    psql -U "$user" -d "$database" -Atqc \
    "SELECT CASE WHEN EXISTS (SELECT 1 FROM schema_migrations WHERE version='032_ai_bot_telegram_identity_unique') AND to_regclass('public.idx_ai_bot_instances_telegram_bot_id_unique') IS NOT NULL THEN 'ready' ELSE 'missing' END;")"
  [[ "$result" == "ready" ]] || { echo "AI schema verification failed: migration/index 032 missing" >&2; return 1; }
  echo "AI schema verification passed: migration 032 and Telegram identity index are present"
}

ai_product_sale_enabled() {
  local user database password result
  user="$(env_value POSTGRES_USER)"
  database="$(env_value POSTGRES_DB)"
  password="$(env_value POSTGRES_PASSWORD)"
  result="$(docker exec -e PGPASSWORD="$password" "$POSTGRES_CONTAINER" \
    psql -U "$user" -d "$database" -Atqc \
    "SELECT CASE WHEN EXISTS (SELECT 1 FROM platform_services WHERE service_key='ai-chatbot' AND tenant_id IS NULL AND store_id IS NULL AND status='active' AND is_catalog_product=TRUE AND starting_price_minor>0) THEN 'yes' ELSE 'no' END;")"
  [[ "$result" == "yes" ]]
}

apply_safe_migrations() {
  echo "Applying safe migrations twice to verify idempotency"
  "${COMPOSE[@]}" run --rm api npm run bootstrap
  "${COMPOSE[@]}" run --rm api npm run bootstrap
  verify_ai_schema
}

preflight_release_environment() {
  echo "Preflighting runtime configuration before replacing live application services."
  "${COMPOSE[@]}" run --rm --no-deps api npm run verify:production
  if ai_product_sale_enabled; then
    "${COMPOSE[@]}" run --rm api npm run verify:ai-launch
  fi
}

verify_running_release() {
  verify_ai_schema
  "${COMPOSE[@]}" exec -T api npm run verify:production
  if ai_product_sale_enabled; then
    echo "AI product is priced and active; enforcing AI launch readiness."
    "${COMPOSE[@]}" exec -T api npm run verify:ai-launch
  else
    echo "AI product is not yet priced+active; launch gate remains closed until platform owner completes pricing."
  fi
  bash "$REPO_DIR/builder/scripts/smoke-vps.sh"
}

wait_for_api_health() {
  for _ in $(seq 1 60); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' uchiha-api 2>/dev/null || true)" == "healthy" ]] && return 0
    sleep 2
  done
  return 1
}

cd "$REPO_DIR"
git diff --quiet && git diff --cached --quiet || { echo "Refusing to overwrite local repository changes" >&2; exit 1; }
CURRENT_BRANCH="$(git branch --show-current)"
[[ "$CURRENT_BRANCH" == "$BRANCH" ]] || { echo "Refusing update from branch $CURRENT_BRANCH; expected $BRANCH" >&2; exit 1; }
PREVIOUS_SHA="$(git rev-parse HEAD)"
echo "Current commit: $PREVIOUS_SHA"

BACKUP_FILE="$(create_verified_backup)"
[[ -s "$BACKUP_FILE" ]] || { echo "Backup verification failed" >&2; exit 1; }
restore_test "$BACKUP_FILE"

git fetch --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
TARGET_SHA="$(git rev-parse "origin/$BRANCH")"
echo "Target commit: $TARGET_SHA"
if [[ "$TARGET_SHA" == "$PREVIOUS_SHA" ]]; then
  if container_matches_source; then
    echo "Repository and image sources match. Re-rendering runtime, applying migrations and preflighting host environment changes before recreation."
    bash "$REPO_DIR/builder/scripts/render-vps-runtime.sh"
    "${COMPOSE[@]}" config --quiet
    apply_safe_migrations
    preflight_release_environment
    "${COMPOSE[@]}" up -d --force-recreate --remove-orphans api worker tls-ask caddy
    wait_for_api_health || { "${COMPOSE[@]}" logs --tail=160 api worker caddy >&2 || true; echo "API did not become healthy after environment refresh" >&2; exit 1; }
    verify_running_release
    install_backup_schedule
    exit 0
  fi
  echo "Git is current but the running container is stale or unverifiable. Forcing a clean rebuild."
fi

OLD_IMAGE_ID="$(docker image inspect uchiha-builder:production --format '{{.Id}}' 2>/dev/null || true)"
if [[ -n "$OLD_IMAGE_ID" ]]; then docker tag "$OLD_IMAGE_ID" "uchiha-builder:rollback-$PREVIOUS_SHA"; fi
SOURCE_UPDATED=false
DEPLOYMENT_STARTED=false
rollback() {
  local status="$1"
  trap - ERR
  echo "Update failed with status $status. Attempting rollback to $PREVIOUS_SHA." >&2
  if [[ "$SOURCE_UPDATED" == true ]]; then
    git -C "$REPO_DIR" checkout -B "$BRANCH" "$PREVIOUS_SHA" || true
  fi
  if [[ "$DEPLOYMENT_STARTED" == true ]] && docker image inspect "uchiha-builder:rollback-$PREVIOUS_SHA" >/dev/null 2>&1; then
    docker tag "uchiha-builder:rollback-$PREVIOUS_SHA" uchiha-builder:production || true
  fi
  if [[ "$DEPLOYMENT_STARTED" == true ]]; then
    [[ -f "$REPO_DIR/builder/scripts/render-vps-runtime.sh" ]] && bash "$REPO_DIR/builder/scripts/render-vps-runtime.sh" || true
    "${COMPOSE[@]}" up -d --force-recreate --remove-orphans postgres api worker tls-ask caddy || true
    "${COMPOSE[@]}" logs --tail=160 api worker caddy postgres >&2 || true
  fi
  echo "Rollback attempt finished. PostgreSQL volumes were not removed. Log: $LOG_FILE" >&2
  exit "$status"
}
trap 'rollback $?' ERR

git checkout -B "$BRANCH" "$TARGET_SHA"
SOURCE_UPDATED=true
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

apply_safe_migrations
preflight_release_environment

"${COMPOSE[@]}" up -d --force-recreate --remove-orphans api worker tls-ask caddy
wait_for_api_health || { "${COMPOSE[@]}" logs --tail=160 api worker caddy postgres >&2 || true; echo "API did not become healthy" >&2; exit 1; }

verify_running_release
install_backup_schedule

trap - ERR
printf '%s\n' "$TARGET_SHA" >"$ROOT_DIR/current-release"
chmod 600 "$ROOT_DIR/current-release"
echo "Update completed successfully: $PREVIOUS_SHA -> $TARGET_SHA"
echo "Backup: $BACKUP_FILE"
echo "Log: $LOG_FILE"
echo "Daily backup timer: active"
"${COMPOSE[@]}" ps
