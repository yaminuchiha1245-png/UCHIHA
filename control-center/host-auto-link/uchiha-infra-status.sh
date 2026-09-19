#!/usr/bin/env bash
set -euo pipefail
OUT=/var/www/uchiha-infra/status.json
TMP="${OUT}.tmp"
mkdir -p /var/www/uchiha-infra

HOST="$(hostname)"
IP="$(hostname -I | awk '{print $1}')"
MEM_PCT="$(free | awk '/Mem:/ {if($2>0) printf "%.0f", ($3/$2)*100; else print 0}')"
DISK_PCT="$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
LOAD="$(awk '{print $1}' /proc/loadavg)"

DB_NAME=""
DB_ENGINE=""
DB_VERSION=""
DB_HEALTH="false"
if docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}' | grep -q 'postgres'; then
  ROW="$(docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}' | grep 'postgres' | head -1)"
  DB_NAME="$(printf '%s' "$ROW" | cut -d'|' -f1)"
  IMG="$(printf '%s' "$ROW" | cut -d'|' -f2)"
  DB_ENGINE="PostgreSQL"
  DB_VERSION="$(printf '%s' "$IMG" | sed -n 's/.*postgres:\([0-9][0-9.]*\).*/\1/p')"
  STATUS="$(printf '%s' "$ROW" | cut -d'|' -f3)"
  case "$STATUS" in *healthy*) DB_HEALTH="true";; *) DB_HEALTH="false";; esac
fi

NS_LINES="$(dig +short NS uchiha-builder.com 2>/dev/null | grep -E '^[A-Za-z0-9.-]+\.$' | sed 's/\.$//' || true)"
NS1="$(printf '%s\n' "$NS_LINES" | sed -n '1p')"
NS2="$(printf '%s\n' "$NS_LINES" | sed -n '2p')"
DNS_PROVIDER="Cloudflare"
if ! printf '%s\n%s\n' "$NS1" "$NS2" | grep -qi 'cloudflare'; then DNS_PROVIDER="DNS"; fi

PANEL_SSL="false"
GAME_SSL="false"
[ -s /etc/letsencrypt/live/panel.uchiha-builder.com/fullchain.pem ] && PANEL_SSL="true"
[ -s /etc/letsencrypt/live/gamezone.155-254-35-187.sslip.io/fullchain.pem ] && GAME_SSL="true"

CONTAINER_TOTAL="$(docker ps -q | wc -l | tr -d ' ')"
CONTAINER_HEALTHY="$(docker ps --format '{{.Status}}' | grep -c 'healthy' || true)"

python3 - "$TMP" "$HOST" "$IP" "$MEM_PCT" "$DISK_PCT" "$LOAD" "$DB_NAME" "$DB_ENGINE" "$DB_VERSION" "$DB_HEALTH" "$DNS_PROVIDER" "$NS1" "$NS2" "$PANEL_SSL" "$GAME_SSL" "$CONTAINER_TOTAL" "$CONTAINER_HEALTHY" <<'PY'
import json,sys,datetime
(out,host,ip,mem,disk,load,db_name,db_engine,db_version,db_health,dns_provider,ns1,ns2,panel_ssl,game_ssl,total,healthy)=sys.argv[1:]
data={
  "ok": True,
  "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "server": {
    "connected": True,
    "provider": "Hostfiley",
    "host": host,
    "publicIp": ip,
    "health": "healthy",
    "memoryPercent": int(mem or 0),
    "diskPercent": int(disk or 0),
    "load1": float(load or 0),
    "containersRunning": int(total or 0),
    "containersHealthy": int(healthy or 0)
  },
  "database": {
    "connected": bool(db_engine),
    "engine": db_engine,
    "version": db_version,
    "health": "healthy" if db_health=="true" else ("running" if db_engine else "unavailable"),
    "service": "Game Zone" if db_name else ""
  },
  "domains": {
    "detected": True,
    "provider": dns_provider,
    "apiManaged": False,
    "nameservers": [x for x in (ns1,ns2) if x],
    "items": [
      {"domain":"panel.uchiha-builder.com","ssl":panel_ssl=="true","role":"Control Center"},
      {"domain":"uchiha-builder.com","ssl":False,"role":"Builder"},
      {"domain":"gamezone.155-254-35-187.sslip.io","ssl":game_ssl=="true","role":"Game Zone"}
    ]
  }
}
with open(out,"w",encoding="utf-8") as f:
    json.dump(data,f,ensure_ascii=False,separators=(",",":"))
PY
chmod 0644 "$TMP"
mv "$TMP" "$OUT"
