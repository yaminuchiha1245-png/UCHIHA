#!/usr/bin/env bash
# One-time coordinated V0.5.51 navigation hotfix; fail closed on any source drift.
set -Eeuo pipefail
umask 077
ROOT=/opt/uchiha/projects/bot-service-stage/uchiha-bot-service
STAGE=/opt/uchiha/projects/bot-service-stage/integration-00-nav-v0551-20260927
BOT="$ROOT/apps/bot-engine"
CAND="$STAGE/apps/bot-engine"
exec 9>/tmp/uchiha-bot-service-release-00.lock
flock -n 9 || { echo 'BLOCKED: another coordinator release owns the lock'; exit 2; }
test -d "$BOT" && test -f "$ROOT/.env" && test -s "$STAGE/NAV_STAGE_MANIFEST.json"
test "$(cat "$ROOT/VERSION")" = '0.5.51'
test "$(cat "$STAGE/VERSION")" = '0.5.51'
test ! -e "$BOT/panel_navigation.py"
echo '01dcc64cd6b86a58374c63f490005acd1a6fd73f7839f963e9e45a65d6545ac3  '"$BOT"'/main.py' | sha256sum -c --status
echo '24038e3a37ae403a79ef34261c062520f4005eede41d34b14575bd0c3fa25c0a  '"$BOT"'/merchant_admin_panel.py' | sha256sum -c --status
python3 - "$STAGE" <<'PY'
from pathlib import Path
import hashlib,json,sys
stage=Path(sys.argv[1])
manifest=json.loads((stage/'NAV_STAGE_MANIFEST.json').read_text())
assert manifest['status']=='STAGED_NOT_DEPLOYED'
assert manifest['baseline']=='0.5.51' and manifest['real_orders_enabled'] is False
for name,expected in manifest['candidate_sha256'].items():
    actual=(stage/'apps/bot-engine'/name).read_bytes()
    assert hashlib.sha256(actual).hexdigest()==expected, name
    compile(actual,name,'exec')
print('CANDIDATE_SHA256=PASS')
PY
# Show only disk headroom; do not print tokens or database rows.
free_mb=$(df -Pm "$ROOT" | awk 'NR==2 {print $4}')
test "$free_mb" -ge 1500 || { echo 'BLOCKED: insufficient backup disk space'; exit 2; }
echo "DISK_AVAILABLE_MB=$free_mb"
if grep -Eq '^ALLOW_LIVE_ORDERS=(true|1|yes)' "$ROOT/.env"; then
  echo 'BLOCKED: supplier charging unlocked before accepted integration'
  exit 2
fi
if ! grep -q '^ALLOW_LIVE_ORDERS=false' "$ROOT/.env"; then
  echo 'BLOCKED: supplier charging lock not explicitly false'
  exit 2
fi
echo 'LIVE_SUPPLIER_CHARGING=LOCKED'
docker exec uchiha_bot_service-bot-engine-1 python3 -c 'import httpx,aiogram;print("DEPENDENCIES=READY")'
# Take source/config/DB/media backup WITHOUT leaking its private contents.
backup_output="$("$ROOT/scripts/backup.sh" 2>&1)"
BACKUP=$(printf '%s\n' "$backup_output" | tail -1)
case "$BACKUP" in /var/backups/uchiha-bot-service/*|"$ROOT"/.backups/*) ;; *) echo 'BLOCKED: unrecognized backup location'; exit 2;; esac
test -d "$BACKUP" && test -s "$BACKUP/manifest.txt"
for key in source_saved database_saved env_saved; do
  grep -qx "$key=yes" "$BACKUP/manifest.txt" || { echo "BLOCKED: $key incomplete"; exit 2; }
done
if docker volume inspect uchiha_bot_service_uchiha_identity_docs >/dev/null 2>&1; then
  grep -qx 'identity_documents_saved=yes' "$BACKUP/manifest.txt" || exit 2
  tar -tzf "$BACKUP/identity-documents.tar.gz" >/dev/null
fi
if docker volume inspect uchiha_bot_service_uchiha_brand_assets >/dev/null 2>&1; then
  grep -qx 'brand_logos_saved=yes' "$BACKUP/manifest.txt" || exit 2
  tar -tzf "$BACKUP/brand-logos.tar.gz" >/dev/null
fi
tar -tzf "$BACKUP/source.tar.gz" >/dev/null
test -s "$BACKUP/database.dump"
db_container=$(docker compose -f "$ROOT/infra/docker-compose.yml" --env-file "$ROOT/.env" ps -q db)
test -n "$db_container"
docker exec -i "$db_container" pg_restore -l >/dev/null < "$BACKUP/database.dump"
sha256sum "$BACKUP/source.tar.gz" "$BACKUP/database.dump" > "$BACKUP/nav00-backup-checksums.sha256"
echo 'BACKUP_VERIFIED=YES'
echo "ROLLBACK_BACKUP=$BACKUP"
ORIGINALS="$BACKUP/nav00-original-source"
mkdir -m 700 "$ORIGINALS"
cp -p "$BOT/main.py" "$BOT/merchant_admin_panel.py" "$ORIGINALS/"
promoted=0
successful=0
rollback() {
  rc=$?
  trap - EXIT
  if [ "$successful" -ne 1 ] && [ "$promoted" -eq 1 ]; then
    echo 'POSTCHECK_FAILED: RESTORING PREVIOUS BOT FILES'
    cp -p "$ORIGINALS/main.py" "$BOT/main.py"
    cp -p "$ORIGINALS/merchant_admin_panel.py" "$BOT/merchant_admin_panel.py"
    rm -f "$BOT/panel_navigation.py"
    cd "$ROOT/infra"
    docker compose --env-file "$ROOT/.env" up -d --no-deps --force-recreate bot-engine >/dev/null || true
    echo 'BOT_SOURCE_ROLLBACK_ATTEMPTED=YES'
  fi
  exit "$rc"
}
trap rollback EXIT
# A second pre-copy check prevents replacing concurrently updated worker files.
echo '01dcc64cd6b86a58374c63f490005acd1a6fd73f7839f963e9e45a65d6545ac3  '"$BOT"'/main.py' | sha256sum -c --status
echo '24038e3a37ae403a79ef34261c062520f4005eede41d34b14575bd0c3fa25c0a  '"$BOT"'/merchant_admin_panel.py' | sha256sum -c --status
test ! -e "$BOT/panel_navigation.py"
for name in main.py merchant_admin_panel.py panel_navigation.py; do
  install -m 644 "$CAND/$name" "$BOT/.nav00-$name.tmp"
done
promoted=1
for name in main.py merchant_admin_panel.py panel_navigation.py; do
  mv -f "$BOT/.nav00-$name.tmp" "$BOT/$name"
done
cd "$ROOT/infra"
docker compose --env-file "$ROOT/.env" up -d --no-deps --force-recreate bot-engine >/dev/null
healthy=0
for attempt in $(seq 1 55); do
  if curl -fsS --max-time 4 http://127.0.0.1:8010/health | grep -q '0.5.51'; then
    healthy=1; break
  fi
  sleep 3
done
test "$healthy" -eq 1 || { echo 'BLOCKED: bot-engine failed to recover'; exit 2; }
cd "$ROOT"
./scripts/release_gate.sh --runtime >/dev/null
for path in '/' '/api/v1/health' '/?bot_id=1' '/?bot_id=2'; do
  code=$(curl -fsS --max-time 12 -o /dev/null -w '%{http_code}|%{ssl_verify_result}' "https://uchiha-bot.155-254-35-187.sslip.io$path")
  test "$code" = '200|0' || { echo "BLOCKED: public HTTPS $path $code"; exit 2; }
done
# A hotfix should not silently lift the charging lock.
grep -qx 'ALLOW_LIVE_ORDERS=false' "$ROOT/.env"
echo 'RELEASE_GATE=PASS'
echo 'PUBLIC_HTTPS=PASS'
echo 'PRODUCTION_NAV_HOTFIX=ACTIVE'
echo 'VERSION=0.5.51+nav00 (VERSION file deliberately unchanged)'
echo "BACKUP_AND_ROLLBACK=$BACKUP"
successful=1
trap - EXIT
