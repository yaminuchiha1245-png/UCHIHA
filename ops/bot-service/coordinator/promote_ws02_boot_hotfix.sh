#!/usr/bin/env bash
# Coordinated static tenant-first-paint hotfix. Backups and rollback are mandatory.
set -Eeuo pipefail
umask 077
ROOT=/opt/uchiha/projects/bot-service-stage/uchiha-bot-service
STAGE=/opt/uchiha/projects/bot-service-stage/integration-00-ws02-boot-v0551-20260927
WEB="$ROOT/apps/miniapp"
CAND="$STAGE/apps/miniapp"
NEW=uchiha-ui-785725ae6758c25a.js
PUBLIC=https://uchiha-bot.155-254-35-187.sslip.io
exec 9>/tmp/uchiha-bot-service-release-00.lock
flock -n 9 || { echo 'BLOCKED: release lock held'; exit 2; }
test "$(cat "$ROOT/VERSION")" = 0.5.51 && test "$(cat "$STAGE/VERSION")" = 0.5.51
test -s "$STAGE/WS02_BOOT_MANIFEST.json" && test ! -e "$WEB/assets/$NEW"
echo '9b71ef6befd69d4bc9bd6617261c3d100430dd80fd24fb3109ea365cd1ac80df  '"$WEB"'/index.html' | sha256sum -c --status
echo '190e50b6453872aa62a0ae4d679dfe9aae7bfae23263f0744c1ed6c142c84300  '"$WEB"'/assets/uchiha-ui-190e50b6453872aa.js' | sha256sum -c --status
echo 'bd7ec5425cb41ab3729aa71ce167b241db79db3131196837f6cdfaa30b2522d2  '"$ROOT"'/apps/bot-engine/main.py' | sha256sum -c --status
echo 'eff67e92e00f2175e3dcf24d006553aa890a7cbd7ff7bf08365bff51acc1446a  '"$ROOT"'/apps/bot-engine/merchant_admin_panel.py' | sha256sum -c --status
cmp -s "$ROOT/apps/bot-engine/panel_navigation.py" /opt/uchiha/projects/bot-service-stage/integration-00-nav-v0551-20260927/apps/bot-engine/panel_navigation.py
grep -qx 'ALLOW_LIVE_ORDERS=false' "$ROOT/.env"
python3 - "$STAGE" <<'PY'
import gzip,hashlib,json,sys
from pathlib import Path
s=Path(sys.argv[1]); m=json.loads((s/'WS02_BOOT_MANIFEST.json').read_text())
assert m['status']=='WS02_STAGED_NOT_DEPLOYED' and m['baseline']=='0.5.51'
assert m['api_changed'] is False and m['real_orders_enabled'] is False
assert m['candidate_js']=='uchiha-ui-785725ae6758c25a.js'
p=s/'apps/miniapp/assets'/m['candidate_js']
raw=p.read_bytes()
want='785725ae6758c25af75d780b024c6a171ab0383adebfea364f271387910d168a'
assert hashlib.sha256(raw).hexdigest()==want==m['candidate_js_sha256']
assert gzip.decompress(Path(str(p)+'.gz').read_bytes())==raw
html=(s/'apps/miniapp/index.html').read_bytes()
assert hashlib.sha256(html).hexdigest()==m['candidate_html_sha256']
print('CANDIDATE_MANIFEST_AND_GZIP=PASS')
PY
test "$(df -Pm "$ROOT" | awk 'NR==2 {print $4}')" -ge 1500
docker inspect uchiha_bot_service-gateway-1 --format '{{range .Mounts}}{{println .Source .Destination}}{{end}}' | grep -Fqx "$WEB /srv"
output=$("$ROOT/scripts/backup.sh" 2>&1)
BACKUP=$(printf '%s\n' "$output" | tail -1)
case "$BACKUP" in /var/backups/uchiha-bot-service/*|"$ROOT"/.backups/*) ;; *) echo 'BLOCKED: backup path'; exit 2;; esac
test -s "$BACKUP/manifest.txt" && test -s "$BACKUP/database.dump"
for key in source_saved database_saved env_saved; do
  grep -qx "$key=yes" "$BACKUP/manifest.txt" || { echo "BLOCKED: $key"; exit 2; }
done
if docker volume inspect uchiha_bot_service_uchiha_identity_docs >/dev/null 2>&1; then
  grep -qx 'identity_documents_saved=yes' "$BACKUP/manifest.txt"
  tar -tzf "$BACKUP/identity-documents.tar.gz" >/dev/null
fi
if docker volume inspect uchiha_bot_service_uchiha_brand_assets >/dev/null 2>&1; then
  grep -qx 'brand_logos_saved=yes' "$BACKUP/manifest.txt"
  tar -tzf "$BACKUP/brand-logos.tar.gz" >/dev/null
fi
tar -tzf "$BACKUP/source.tar.gz" >/dev/null
db=$(docker compose -f "$ROOT/infra/docker-compose.yml" --env-file "$ROOT/.env" ps -q db)
test -n "$db"
docker exec -i "$db" pg_restore -l >/dev/null < "$BACKUP/database.dump"
cp -p "$WEB/index.html" "$BACKUP/index.html.pre-ws02"
sha256sum "$BACKUP/source.tar.gz" "$BACKUP/database.dump" "$BACKUP/index.html.pre-ws02" > "$BACKUP/ws02-checksums.sha256"
echo 'FULL_BACKUP_VERIFIED=PASS'
echo "ROLLBACK_BACKUP=$BACKUP"
swapped=0; accepted=0
rollback() {
  status=$?
  trap - EXIT
  if [ "$swapped" -eq 1 ] && [ "$accepted" -ne 1 ]; then
    install -m 644 "$BACKUP/index.html.pre-ws02" "$WEB/.index.ws02.rollback.tmp"
    mv -f "$WEB/.index.ws02.rollback.tmp" "$WEB/index.html"
    echo 'LIVE_INDEX_ROLLBACK=RESTORED'
  fi
  exit "$status"
}
trap rollback EXIT
echo '9b71ef6befd69d4bc9bd6617261c3d100430dd80fd24fb3109ea365cd1ac80df  '"$WEB"'/index.html' | sha256sum -c --status
for suffix in '' .gz .br; do
  install -m 644 "$CAND/assets/$NEW$suffix" "$WEB/assets/.$NEW$suffix.ws02.tmp"
  mv -f "$WEB/assets/.$NEW$suffix.ws02.tmp" "$WEB/assets/$NEW$suffix"
done
install -m 644 "$CAND/index.html" "$WEB/.index.ws02.tmp"
swapped=1
mv -f "$WEB/.index.ws02.tmp" "$WEB/index.html"
cd "$ROOT"
./scripts/release_gate.sh --runtime >/dev/null
want='785725ae6758c25af75d780b024c6a171ab0383adebfea364f271387910d168a'
got=$(curl -fsS --max-time 15 "$PUBLIC/assets/$NEW" | sha256sum | awk '{print $1}')
test "$got" = "$want" || { echo 'BLOCKED: public JS hash mismatch'; exit 2; }
for id in 1 2; do
  curl -fsS --max-time 15 "$PUBLIC/?bot_id=$id&ws02_qa=20260927" -o "$BACKUP/tenant-$id-public-check.html"
  grep -Fq "/assets/$NEW" "$BACKUP/tenant-$id-public-check.html"
  grep -Fq 'id="tenant-first-paint"' "$BACKUP/tenant-$id-public-check.html"
  echo "TENANT_$id=PASS"
done
curl -fsS --max-time 12 "$PUBLIC/api/v1/health" | grep -Fq '"service":"uchiha-bot-service"'
grep -qx 'ALLOW_LIVE_ORDERS=false' "$ROOT/.env"
echo 'WS02_PUBLIC_ACCEPTANCE=PASS'
echo 'PRODUCTION_VERSION=0.5.51+nav00+ws02boot'
echo 'REAL_ORDERS=LOCKED'
accepted=1
trap - EXIT
