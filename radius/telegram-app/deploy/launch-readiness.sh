#!/usr/bin/env bash
set -euo pipefail

PUBLIC_HOST="${UCHIHA_RADIUS_PUBLIC_HOST:-radius.uchiha-builder.com}"
APP_DIR="/opt/uchiha-radius/telegram-app"
ETC_DIR="/etc/uchiha-radius"
STATE_DIR="/var/lib/uchiha-radius"

ok=0
warn=0
fail=0

check() {
  local state="$1" name="$2" detail="$3"
  case "$state" in
    ok) ok=$((ok+1)); printf 'OK   %-28s %s\n' "$name" "$detail";;
    warn) warn=$((warn+1)); printf 'WAIT %-28s %s\n' "$name" "$detail";;
    fail) fail=$((fail+1)); printf 'FAIL %-28s %s\n' "$name" "$detail";;
  esac
}

service_check() {
  local unit="$1" label="$2"
  if systemctl is-active --quiet "$unit"; then
    check ok "$label" "active"
  else
    check fail "$label" "inactive"
  fi
}

service_check uchiha-radius.service "Backend v37"
service_check uchiha-radius-provider.service "Provider API"
service_check uchiha-radius-mikrotik-dispatcher.service "MikroTik dispatcher"

if systemctl is-active --quiet uchiha-radius-telegram-bot.service; then
  check ok "Telegram bot" "active"
else
  check warn "Telegram bot" "waiting for real token + owner ID"
fi

if [[ -s "${APP_DIR}/dist/index.html" ]]; then
  check ok "Telegram WebApp" "built"
else
  check fail "Telegram WebApp" "missing build"
fi

provider_code="$(curl -sS -o /tmp/uchiha-provider-health -w '%{http_code}' --max-time 4 http://127.0.0.1:8788/healthz || true)"
if [[ "$provider_code" == "200" ]]; then
  check ok "Provider health" "HTTP 200"
else
  check fail "Provider health" "HTTP ${provider_code:-000}"
fi

# Before TLS provisioning use the HTTP staging route; afterward the
# same routes intentionally redirect HTTP -> HTTPS and must be probed over TLS.
edge_transport="HTTP"
edge_base="http://127.0.0.1"
edge_args=(--noproxy '*' -H "Host: ${PUBLIC_HOST}")
if [[ -s "/etc/letsencrypt/live/${PUBLIC_HOST}/fullchain.pem" && -s "/etc/letsencrypt/live/${PUBLIC_HOST}/privkey.pem" ]]; then
  edge_transport="HTTPS"
  edge_base="https://${PUBLIC_HOST}"
  edge_args=(--noproxy '*' --resolve "${PUBLIC_HOST}:443:127.0.0.1")
fi

edge_code="$(curl -sS -o /tmp/uchiha-edge-health -w '%{http_code}' --max-time 4 "${edge_args[@]}" "${edge_base}/healthz" || true)"
if [[ "$edge_code" == "200" ]]; then
  check ok "Nginx edge ${edge_transport}" "${edge_transport} 200"
else
  check fail "Nginx edge ${edge_transport}" "${edge_transport} ${edge_code:-000}"
fi

web_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 4 "${edge_args[@]}" "${edge_base}/telegram/" || true)"
if [[ "$web_code" == "200" ]]; then
  check ok "Telegram edge route" "${edge_transport} 200"
else
  check fail "Telegram edge route" "${edge_transport} ${web_code:-000}"
fi

installer_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 4 "${edge_args[@]}" "${edge_base}/site-agent/install.sh" || true)"
if [[ "$installer_code" == "200" ]]; then
  check ok "Site Agent installer" "${edge_transport} 200"
else
  check fail "Site Agent installer" "${edge_transport} ${installer_code:-000}"
fi

public_ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' || true)"
dns_ip="$(getent ahostsv4 "${PUBLIC_HOST}" 2>/dev/null | awk 'NR==1{print $1}' || true)"
if [[ -n "$public_ip" && "$dns_ip" == "$public_ip" ]]; then
  check ok "Public DNS" "${PUBLIC_HOST} -> ${dns_ip}"
else
  check warn "Public DNS" "${PUBLIC_HOST} -> ${dns_ip:-unknown}; VPS -> ${public_ip:-unknown}"
fi

if [[ -s "/etc/letsencrypt/live/${PUBLIC_HOST}/fullchain.pem" && -s "/etc/letsencrypt/live/${PUBLIC_HOST}/privkey.pem" ]]; then
  check ok "TLS certificate" "present"
else
  check warn "TLS certificate" "waiting for DNS cutover"
fi

read -r token_ready owner_ready < <(python3 - <<'PY'
from pathlib import Path
p=Path('/etc/uchiha-radius/provider.env')
vals={}
if p.exists():
    for raw in p.read_text(errors='ignore').splitlines():
        line=raw.strip()
        if line and not line.startswith('#') and '=' in line:
            k,v=line.split('=',1); vals[k]=v.strip()
print(1 if vals.get('TELEGRAM_BOT_TOKEN') else 0,
      1 if vals.get('UCHIHA_RADIUS_OWNER_TELEGRAM_ID','').isdigit() and int(vals.get('UCHIHA_RADIUS_OWNER_TELEGRAM_ID','0'))>0 else 0)
PY
)
if [[ "$token_ready" == "1" ]]; then
  check ok "Telegram token" "configured"
else
  check warn "Telegram token" "missing"
fi
if [[ "$owner_ready" == "1" ]]; then
  check ok "Telegram owner ID" "configured"
else
  check warn "Telegram owner ID" "missing"
fi

read -r agents registered routers subscribers < <(python3 - <<'PY'
import sqlite3, time
p='/var/lib/uchiha-radius/provider.sqlite3'
try:
    db=sqlite3.connect(p)
    now=int(time.time())
    online=db.execute("select count(*) from site_agents where last_seen_at is not null and last_seen_at>=?",(now-90,)).fetchone()[0]
    registered=db.execute("select count(*) from site_agents").fetchone()[0]
    routers=db.execute("select count(*) from routers").fetchone()[0]
    subscribers=db.execute("select count(*) from subscribers").fetchone()[0]
    print(online,registered,routers,subscribers)
except Exception:
    print(0,0,0,0)
PY
)
if [[ "$registered" -gt 0 && "$agents" -gt 0 ]]; then
  check ok "Provider Site Agent" "${agents}/${registered} online"
elif [[ "$registered" -gt 0 ]]; then
  check warn "Provider Site Agent" "registered but offline"
else
  check warn "Provider Site Agent" "no provider MikroTik site linked yet"
fi
check ok "Provider database" "${routers} routers · ${subscribers} subscribers"

v37_result="$(PYTHONPATH="${APP_DIR}" python3 - <<'PY'
from v37_gateway import V37Gateway
try:
    g=V37Gateway.from_secret_file(
        'http://127.0.0.1:8792',
        key_id='telegram-provider',
        secret_file='/etc/uchiha-radius/v37-gateway-hmac.secret',
        public_host='radius.uchiha-builder.com',
    )
    r=g.request('GET','/api/connectors/radius/production-readiness',actor='launch-readiness',role='owner')
    b=r.json() if r.body else {}
    print('ok' if r.status==200 and b.get('ok') is True else f'http-{r.status}')
except Exception:
    print('error')
PY
)"
if [[ "$v37_result" == "ok" ]]; then
  check ok "v37 signed readiness" "ok=true"
else
  check fail "v37 signed readiness" "$v37_result"
fi

echo
echo "READY_SUMMARY ok=${ok} waiting=${warn} failed=${fail}"
if [[ "$fail" -gt 0 ]]; then
  exit 2
fi
if [[ "$warn" -gt 0 ]]; then
  exit 10
fi
exit 0
