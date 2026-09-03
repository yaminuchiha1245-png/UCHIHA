#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run as root" >&2
  exit 1
fi

STORE=/opt/uchiha/store/uchiha.py
SYNC=/usr/local/sbin/uchiha-sync
PATCHER=/usr/local/sbin/uchiha-patch-store

[ -f "$STORE" ] || { echo "ERROR: $STORE not found" >&2; exit 1; }

cat >"$PATCHER" <<'PATCH'
#!/usr/bin/env python3
from pathlib import Path

path = Path('/opt/uchiha/store/uchiha.py')
text = path.read_text(encoding='utf-8')

old_required = "required={'BOT_TOKEN':os.getenv('BOT_TOKEN','').strip(),'PLATFORM_BOT_TOKEN':os.getenv('PLATFORM_BOT_TOKEN','').strip()};missing=[k for k,v in required.items() if not v]"
new_required = "required={'BOT_TOKEN':os.getenv('BOT_TOKEN','').strip()};missing=[k for k,v in required.items() if not v]"

old_tasks = "tasks={'UCHIHA STORE':asyncio.create_task(store_app.main()),'UCHIHA PLATFORM':asyncio.create_task(_platform_mode(platform_app)),'AUTOMATIC BACKUPS':asyncio.create_task(_automatic_backup_worker())}"
new_tasks = "tasks={'UCHIHA STORE':asyncio.create_task(store_app.main()),'AUTOMATIC BACKUPS':asyncio.create_task(_automatic_backup_worker())}\n    platform_token=os.getenv('PLATFORM_BOT_TOKEN','').strip()\n    if platform_token or _env_flag('PLATFORM_API_ENABLED',False):tasks['UCHIHA PLATFORM']=asyncio.create_task(_platform_mode(platform_app))\n    else:logging.getLogger(__name__).warning('UCHIHA PLATFORM bot disabled: PLATFORM_BOT_TOKEN is not configured')"

changed = False
if old_required in text:
    text = text.replace(old_required, new_required, 1)
    changed = True
elif new_required not in text:
    raise SystemExit('ERROR: required-token block not recognized')

if old_tasks in text:
    text = text.replace(old_tasks, new_tasks, 1)
    changed = True
elif "PLATFORM bot disabled: PLATFORM_BOT_TOKEN is not configured" not in text:
    raise SystemExit('ERROR: task block not recognized')

if changed:
    path.write_text(text, encoding='utf-8')
    print('UCHIHA_STORE_PATCH=APPLIED')
else:
    print('UCHIHA_STORE_PATCH=ALREADY_APPLIED')
PATCH
chmod 755 "$PATCHER"

"$PATCHER"

# Keep the fix across automatic Store code refreshes.
if [ -f "$SYNC" ] && ! grep -q 'uchiha-patch-store' "$SYNC"; then
  python3 - <<'PY'
from pathlib import Path
p=Path('/usr/local/sbin/uchiha-sync')
s=p.read_text()
needle='  fetch_branch "$name" "$branch"\n'
replacement=needle+'  if [ "$name" = "store" ] && [ -x /usr/local/sbin/uchiha-patch-store ]; then /usr/local/sbin/uchiha-patch-store; fi\n'
if needle not in s:
    raise SystemExit('ERROR: sync hook location not found')
p.write_text(s.replace(needle,replacement,1))
PY
  chmod 755 "$SYNC"
fi

# Explicitly keep the platform bot/API off until a separate token is configured.
ENV=/etc/uchiha/store.env
if [ -f "$ENV" ]; then
  grep -q '^PLATFORM_API_ENABLED=' "$ENV" || echo 'PLATFORM_API_ENABLED=0' >> "$ENV"
fi

systemctl daemon-reload
systemctl restart uchiha-store.service
sleep 8

echo '=== PYTHON ==='
/opt/uchiha/store/.venv/bin/python --version || true
echo '=== PORT 8080 ==='
ss -ltnp | grep ':8080' || true
echo '=== HEALTH ==='
if curl -fsS --max-time 10 http://127.0.0.1:8080/v1/storefront/health; then
  echo
  echo 'UCHIHA_STORE_HEALTH=OK'
else
  echo 'UCHIHA_STORE_HEALTH=NOT_READY'
  echo '=== RECENT LOGS ==='
  journalctl -u uchiha-store.service -n 60 --no-pager || true
fi
