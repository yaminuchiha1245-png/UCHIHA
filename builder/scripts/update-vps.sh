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
cd "$REPO_DIR"
git diff --quiet && git diff --cached --quiet || { echo "Refusing to overwrite local repository changes" >&2; exit 1; }
[[ "$(git branch --show-current)" == "$BRANCH" ]] || { echo "Refusing update outside $BRANCH" >&2; exit 1; }

env_value() {
  grep -E "^$1=" "$ROOT_DIR/.env" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

refresh_target() {
  git fetch --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
  TARGET_SHA="$(git rev-parse "origin/$BRANCH")"
  [[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid target SHA: $TARGET_SHA" >&2; return 1; }
}

refresh_autodeploy_runtime() {
  local tmp="/run/uchiha-autodeploy-refresh-$$.sh"
  git show "${TARGET_SHA}:builder/scripts/vps-autodeploy.sh" >"$tmp"
  [[ -s "$tmp" ]] || { rm -f "$tmp"; echo "Target auto-deploy wrapper is empty" >&2; return 1; }
  install -m 700 "$tmp" /usr/local/sbin/uchiha-autodeploy
  rm -f "$tmp"
  systemctl enable --now uchiha-autodeploy.timer >/dev/null 2>&1 || true
}

create_verified_backup() {
  local user database password stamp final temporary
  user="$(env_value POSTGRES_USER)"
  database="$(env_value POSTGRES_DB)"
  password="$(env_value POSTGRES_PASSWORD)"
  [[ -n "$user" && -n "$database" && -n "$password" ]] || {
    echo "PostgreSQL backup configuration is incomplete" >&2
    return 1
  }
  docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 || {
    echo "PostgreSQL container is unavailable" >&2
    return 1
  }
  install -d -m 700 "$BACKUP_DIR"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  final="$BACKUP_DIR/uchiha-$stamp.dump"
  temporary="$final.tmp"
  rm -f "$temporary"
  docker exec -e PGPASSWORD="$password" "$POSTGRES_CONTAINER" \
    pg_dump -U "$user" -d "$database" -Fc --no-owner --no-privileges >"$temporary"
  [[ -s "$temporary" ]] || { rm -f "$temporary"; echo "Backup file is empty" >&2; return 1; }
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
  docker exec -e PGPASSWORD="$password" "$POSTGRES_CONTAINER" createdb -U "$user" "$test_database"
  cat "$backup" | docker exec -i -e PGPASSWORD="$password" "$POSTGRES_CONTAINER" \
    pg_restore -U "$user" -d "$test_database" --no-owner --no-privileges --exit-on-error
  table_count="$(docker exec -e PGPASSWORD="$password" "$POSTGRES_CONTAINER" \
    psql -U "$user" -d "$test_database" -Atqc \
    "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public';")"
  [[ "$table_count" =~ ^[1-9][0-9]*$ ]] || { echo "Restore test produced no public tables" >&2; exit 1; }
  echo "Restore test passed with $table_count public tables"
)

wait_for_postgres() {
  for _ in $(seq 1 60); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)" == "healthy" ]] && return 0
    sleep 2
  done
  return 1
}

print_api_diagnostics() {
  echo "=== TARGET API STATE ===" >&2
  docker inspect -f 'status={{.State.Status}} exit={{.State.ExitCode}} error={{.State.Error}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' uchiha-api >&2 2>/dev/null || true
  echo "=== TARGET API HEALTH HISTORY ===" >&2
  docker inspect -f '{{if .State.Health}}{{range .State.Health.Log}}{{.Start}} exit={{.ExitCode}} output={{printf "%s" .Output}}{{println}}{{end}}{{end}}' uchiha-api >&2 2>/dev/null || true
  echo "=== TARGET API /ready ===" >&2
  docker exec uchiha-api node -e \
    "fetch('http://127.0.0.1:4100/ready').then(async r=>console.error('HTTP',r.status,await r.text())).catch(e=>console.error('READY_ERROR',e?.stack||e))" \
    >&2 2>/dev/null || true
  echo "=== TARGET API LOGS ===" >&2
  docker logs --tail=260 uchiha-api >&2 2>&1 || true
}

wait_for_api_health() {
  local state health
  for _ in $(seq 1 120); do
    state="$(docker inspect -f '{{.State.Status}}' uchiha-api 2>/dev/null || true)"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' uchiha-api 2>/dev/null || true)"
    [[ "$health" == "healthy" ]] && return 0
    [[ "$state" == "exited" || "$state" == "dead" ]] && return 1
    sleep 2
  done
  return 1
}

verify_schema_050() {
  local user database password result
  user="$(env_value POSTGRES_USER)"
  database="$(env_value POSTGRES_DB)"
  password="$(env_value POSTGRES_PASSWORD)"
  result="$(docker exec -e PGPASSWORD="$password" "$POSTGRES_CONTAINER" \
    psql -U "$user" -d "$database" -Atqc \
    "SELECT CASE WHEN EXISTS (SELECT 1 FROM schema_migrations WHERE version='050_subscription_review_revalidation_guard') THEN 'ready' ELSE 'missing' END;")"
  [[ "$result" == "ready" ]] || { echo "Migration 050 is missing" >&2; return 1; }
  echo "Schema verification passed through migration 050"
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

apply_migrations_and_preflight() {
  echo "Applying migrations twice to verify idempotency"
  "${COMPOSE[@]}" run --rm api npm run bootstrap
  "${COMPOSE[@]}" run --rm api npm run bootstrap
  verify_schema_050
  echo "Preflighting production runtime"
  "${COMPOSE[@]}" run --rm --no-deps api npm run verify:production
  if ai_product_sale_enabled; then
    echo "AI product is active; enforcing AI launch preflight"
    "${COMPOSE[@]}" run --rm api npm run verify:ai-launch
  fi
}

verify_live_release() {
  "${COMPOSE[@]}" exec -T api npm run verify:production
  if ai_product_sale_enabled; then
    "${COMPOSE[@]}" exec -T api npm run verify:ai-launch
  fi
  bash "$REPO_DIR/builder/scripts/smoke-vps.sh"
  bash "$REPO_DIR/builder/scripts/launch-audit.sh"
}

install_backup_schedule() {
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
Description=Daily UCHIHA PostgreSQL verified backup
[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true
RandomizedDelaySec=900
Unit=uchiha-backup.service
[Install]
WantedBy=timers.target
TIMER
  systemctl daemon-reload
  systemctl enable --now uchiha-backup.timer >/dev/null
}

refresh_target
refresh_autodeploy_runtime

REPO_HEAD="$(git rev-parse HEAD)"
LIVE_SHA="$(cat "$ROOT_DIR/current-release" 2>/dev/null || true)"
if [[ ! "$LIVE_SHA" =~ ^[0-9a-f]{40}$ ]]; then LIVE_SHA="$REPO_HEAD"; fi

echo "Repository head: $REPO_HEAD"
echo "Verified live release: $LIVE_SHA"
echo "Target commit: $TARGET_SHA"

BACKUP_FILE="$(create_verified_backup)"
[[ -s "$BACKUP_FILE" ]] || { echo "Backup verification failed" >&2; exit 1; }
restore_test "$BACKUP_FILE"

OLD_IMAGE_ID="$(docker image inspect uchiha-builder:production --format '{{.Id}}' 2>/dev/null || true)"
if [[ -n "$OLD_IMAGE_ID" ]]; then docker tag "$OLD_IMAGE_ID" "uchiha-builder:rollback-$LIVE_SHA"; fi
DEPLOYMENT_STARTED=false

rollback() {
  local status="$1"
  trap - ERR
  echo "Update failed with status $status. Rolling back to verified live release $LIVE_SHA." >&2
  print_api_diagnostics || true
  git -C "$REPO_DIR" checkout -B "$BRANCH" "$LIVE_SHA" || true
  if docker image inspect "uchiha-builder:rollback-$LIVE_SHA" >/dev/null 2>&1; then
    docker tag "uchiha-builder:rollback-$LIVE_SHA" uchiha-builder:production || true
  fi
  if [[ "$DEPLOYMENT_STARTED" == true ]]; then
    bash "$REPO_DIR/builder/scripts/render-vps-runtime.sh" || true
    "${COMPOSE[@]}" stop worker >/dev/null 2>&1 || true
    "${COMPOSE[@]}" up -d postgres >/dev/null 2>&1 || true
    wait_for_postgres || true
    "${COMPOSE[@]}" up -d --force-recreate --no-deps api >/dev/null 2>&1 || true
    wait_for_api_health || true
    "${COMPOSE[@]}" up -d --force-recreate --remove-orphans worker tls-ask caddy >/dev/null 2>&1 || true
  fi

  # The stable release renderer intentionally restores all runtime files, which
  # also installs the stable release's old auto-deploy wrapper. Immediately
  # re-install the newest remote control-plane wrapper so a rollback never loses
  # autonomous polling, one-attempt failed-SHA suppression, or Remote Ops.
  refresh_target || true
  refresh_autodeploy_runtime || true

  echo "Rollback finished. PostgreSQL volumes were preserved. Log: $LOG_FILE" >&2
  exit "$status"
}
trap 'rollback $?' ERR

git checkout -B "$BRANCH" "$TARGET_SHA"
[[ -f builder/package.json ]] || { echo "builder/package.json is missing" >&2; exit 1; }

echo "Building Docker image uchiha-builder:$TARGET_SHA"
docker build --pull -t "uchiha-builder:$TARGET_SHA" builder
docker tag "uchiha-builder:$TARGET_SHA" uchiha-builder:production
DEPLOYMENT_STARTED=true

bash "$REPO_DIR/builder/scripts/render-vps-runtime.sh"
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" up -d postgres
wait_for_postgres || { echo "PostgreSQL did not become healthy" >&2; exit 1; }

apply_migrations_and_preflight

# Stage the release deliberately: stop the background worker, replace ONLY the
# API, and require its internal /ready probe to pass before touching the rest of
# the application stack. This removes startup contention and preserves the exact
# failing API container long enough to capture diagnostics before rollback.
"${COMPOSE[@]}" stop worker >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d --force-recreate --no-deps api
if ! wait_for_api_health; then
  print_api_diagnostics
  echo "Target API did not become healthy before worker/Caddy rollout" >&2
  exit 1
fi

echo "Target API is healthy; starting worker and edge services"
"${COMPOSE[@]}" up -d --force-recreate --remove-orphans worker tls-ask caddy

verify_live_release
install_backup_schedule

trap - ERR
printf '%s\n' "$TARGET_SHA" >"$ROOT_DIR/current-release"
chmod 600 "$ROOT_DIR/current-release"
rm -f "$ROOT_DIR/failed-release"
echo "Update completed successfully: $LIVE_SHA -> $TARGET_SHA"
echo "Backup: $BACKUP_FILE"
echo "Log: $LOG_FILE"
"${COMPOSE[@]}" ps
