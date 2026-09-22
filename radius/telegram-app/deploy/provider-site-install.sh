#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CENTRAL_URL="https://radius.uchiha-builder.com"
AGENT_TOKEN=""
MIKROTIK_IP=""
ROUTEROS_USER=""
ROUTEROS_PASSWORD=""
SITE_IP=""

usage() {
  cat <<'EOF'
UCHIHA RADIUS provider-site installer

Usage:
  bash provider-site-install.sh [options]

Options:
  --central-url URL
  --agent-token TOKEN
  --mikrotik-ip IP
  --routeros-user USER
  --routeros-password PASS
  --site-ip IP
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --central-url) CENTRAL_URL="$2"; shift 2;;
    --agent-token) AGENT_TOKEN="$2"; shift 2;;
    --mikrotik-ip) MIKROTIK_IP="$2"; shift 2;;
    --routeros-user) ROUTEROS_USER="$2"; shift 2;;
    --routeros-password) ROUTEROS_PASSWORD="$2"; shift 2;;
    --site-ip) SITE_IP="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
done

[[ "${EUID}" -eq 0 ]] || { echo "Run as root." >&2; exit 2; }
[[ "$CENTRAL_URL" == https://* ]] || { echo "Central URL must use HTTPS." >&2; exit 2; }

if [[ -z "$AGENT_TOKEN" ]]; then
  read -rsp "Site Agent token: " AGENT_TOKEN; echo
fi
if [[ -z "$MIKROTIK_IP" ]]; then
  read -rp "MikroTik management IP: " MIKROTIK_IP
fi
if [[ -z "$ROUTEROS_USER" ]]; then
  read -rp "RouterOS API username: " ROUTEROS_USER
fi
if [[ -z "$ROUTEROS_PASSWORD" ]]; then
  read -rsp "RouterOS API password: " ROUTEROS_PASSWORD; echo
fi

python3 - "$MIKROTIK_IP" <<'PY'
import ipaddress, sys
ip=ipaddress.ip_address(sys.argv[1])
if ip.version != 4 or not ip.is_private:
    raise SystemExit("MikroTik management address must be private IPv4")
PY

if [[ -z "$SITE_IP" ]]; then
  SITE_IP="$(ip route get "$MIKROTIK_IP" 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
fi
[[ -n "$SITE_IP" ]] || { echo "Could not detect provider-site LAN IP; use --site-ip." >&2; exit 2; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq freeradius freeradius-utils freeradius-python3 python3

if ! getent group uchiha-radius >/dev/null; then
  groupadd --system uchiha-radius
fi
if ! id uchiha-radius >/dev/null 2>&1; then
  useradd --system --gid uchiha-radius --home-dir /var/lib/uchiha-radius --shell /usr/sbin/nologin uchiha-radius
fi
if id freerad >/dev/null 2>&1; then
  usermod -a -G uchiha-radius freerad
fi

install -d -m 0755 /opt/uchiha-radius/site-gateway
install -d -m 0750 -o uchiha-radius -g uchiha-radius /var/lib/uchiha-radius
install -d -m 0750 -o root -g uchiha-radius /etc/uchiha-radius

install -m 0644 "$SOURCE_DIR/site_agent.py" /opt/uchiha-radius/site-gateway/site_agent.py
install -m 0644 "$SOURCE_DIR/site_radius_db.py" /opt/uchiha-radius/site-gateway/site_radius_db.py
install -m 0644 "$SOURCE_DIR/mikrotik_site_gateway.py" /opt/uchiha-radius/site-gateway/mikrotik_site_gateway.py
install -m 0644 "$SOURCE_DIR/freeradius_uchiha.py" /opt/uchiha-radius/site-gateway/freeradius_uchiha.py

GATEWAY_TOKEN="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
)"
RADIUS_SECRET="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(24))
PY
)"

umask 077
cat >/etc/uchiha-radius/site-gateway.env <<EOF
UCHIHA_SITE_GATEWAY_BIND=127.0.0.1
UCHIHA_SITE_GATEWAY_PORT=8789
UCHIHA_SITE_GATEWAY_TOKEN=$GATEWAY_TOKEN
UCHIHA_ROUTEROS_BASE_URL=https://$MIKROTIK_IP
UCHIHA_ROUTEROS_USERNAME=$ROUTEROS_USER
UCHIHA_ROUTEROS_PASSWORD=$ROUTEROS_PASSWORD
UCHIHA_ROUTEROS_ALLOW_INSECURE=0
EOF

cat >/etc/uchiha-radius/site-agent.env <<EOF
UCHIHA_RADIUS_CENTRAL_URL=$CENTRAL_URL
UCHIHA_RADIUS_SITE_AGENT_TOKEN=$AGENT_TOKEN
UCHIHA_SITE_GATEWAY_URL=http://127.0.0.1:8789
UCHIHA_SITE_GATEWAY_TOKEN=$GATEWAY_TOKEN
UCHIHA_SITE_AGENT_POLL_SECONDS=1
UCHIHA_SITE_AGENT_TIMEOUT=12
UCHIHA_SITE_AGENT_SESSION_SYNC_SECONDS=5
UCHIHA_SITE_AGENT_CONFIG_SYNC_SECONDS=15
UCHIHA_SITE_RADIUS_DB=/var/lib/uchiha-radius/site-radius.sqlite3
EOF

chmod 0600 /etc/uchiha-radius/site-gateway.env /etc/uchiha-radius/site-agent.env

install -m 0644 "$SOURCE_DIR/deploy/freeradius-uchiha.module" /etc/freeradius/3.0/mods-available/uchiha_radius
ln -sfn ../mods-available/uchiha_radius /etc/freeradius/3.0/mods-enabled/uchiha_radius

python3 - "$SOURCE_DIR/deploy/freeradius-uchiha.site.template" "$MIKROTIK_IP" "$RADIUS_SECRET" <<'PY'
from pathlib import Path
import sys
source=Path(sys.argv[1]).read_text(encoding="utf-8")
source=source.replace("__MIKROTIK_IP__",sys.argv[2]).replace("__SHARED_SECRET__",sys.argv[3])
target=Path("/etc/freeradius/3.0/sites-available/uchiha_radius")
target.write_text(source,encoding="utf-8")
target.chmod(0o640)
PY
chown root:freerad /etc/freeradius/3.0/sites-available/uchiha_radius
ln -sfn ../sites-available/uchiha_radius /etc/freeradius/3.0/sites-enabled/uchiha_radius
rm -f /etc/freeradius/3.0/sites-enabled/default

install -m 0644 "$SOURCE_DIR/deploy/uchiha-radius-mikrotik-site-gateway.service" /etc/systemd/system/
install -m 0644 "$SOURCE_DIR/deploy/uchiha-radius-site-agent.service" /etc/systemd/system/

freeradius -XC >/tmp/uchiha-freeradius-check.log 2>&1 || {
  cat /tmp/uchiha-freeradius-check.log >&2
  exit 3
}

systemctl daemon-reload
systemctl enable freeradius uchiha-radius-mikrotik-site-gateway uchiha-radius-site-agent
systemctl restart uchiha-radius-mikrotik-site-gateway
systemctl restart uchiha-radius-site-agent
systemctl restart freeradius

systemctl is-active --quiet uchiha-radius-mikrotik-site-gateway
systemctl is-active --quiet uchiha-radius-site-agent
systemctl is-active --quiet freeradius

cat >/root/uchiha-radius-mikrotik-setup.rsc <<EOF
/radius remove [find comment="UCHIHA-RADIUS"]
/radius add service=ppp,hotspot address=$SITE_IP secret="$RADIUS_SECRET" authentication-port=1812 accounting-port=1813 comment="UCHIHA-RADIUS"
/ppp aaa set use-radius=yes accounting=yes interim-update=1m
:foreach i in=[/ip hotspot profile find] do={ /ip hotspot profile set $i use-radius=yes radius-accounting=yes radius-interim-update=received }
EOF
chmod 0600 /root/uchiha-radius-mikrotik-setup.rsc

echo
echo "UCHIHA RADIUS provider site is installed."
echo "Central: $CENTRAL_URL"
echo "MikroTik: $MIKROTIK_IP"
echo "Local RADIUS server: $SITE_IP:1812/1813"
echo "RouterOS setup commands are stored in:"
echo "  /root/uchiha-radius-mikrotik-setup.rsc"
echo "Apply that file on the MikroTik only after reviewing the current RADIUS configuration."
