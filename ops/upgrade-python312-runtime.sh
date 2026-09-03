#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
APP_BASE=/opt/uchiha

log(){ printf '\n[UCHIHA] %s\n' "$*"; }

log "Installing Python 3.12 for Ubuntu 22.04"
apt-get update -y
apt-get install -y software-properties-common ca-certificates curl
if ! command -v python3.12 >/dev/null 2>&1; then
  add-apt-repository -y ppa:deadsnakes/ppa
  apt-get update -y
  apt-get install -y python3.12 python3.12-venv python3.12-dev
fi

python3.12 --version

rebuild_venv(){
  local name="$1" dir="$APP_BASE/$1"
  [ -f "$dir/requirements.txt" ] || return 0
  log "Rebuilding $name virtualenv with Python 3.12"
  if systemctl cat "uchiha-$name.service" >/dev/null 2>&1; then
    systemctl stop "uchiha-$name.service" || true
  fi
  rm -rf "$dir/.venv"
  python3.12 -m venv "$dir/.venv"
  "$dir/.venv/bin/python" -m pip install --upgrade pip wheel
  "$dir/.venv/bin/pip" install -r "$dir/requirements.txt"
}

rebuild_venv store
rebuild_venv builder

# Keep future automatic deployments on Python 3.12 if a venv ever has to be recreated.
if [ -f /usr/local/sbin/uchiha-sync ]; then
  sed -i 's/python3 -m venv/python3.12 -m venv/g' /usr/local/sbin/uchiha-sync
fi

systemctl daemon-reload
if systemctl cat uchiha-store.service >/dev/null 2>&1; then
  systemctl restart uchiha-store.service
fi
sleep 7

echo "=== PYTHON ==="
/opt/uchiha/store/.venv/bin/python --version || true
echo "=== PORT 8080 ==="
ss -ltnp | grep ':8080' || true
echo "=== STORE STATUS ==="
systemctl --no-pager --full status uchiha-store.service | sed -n '1,18p' || true
echo "=== HEALTH ==="
if curl -fsS --max-time 10 http://127.0.0.1:8080/v1/storefront/health; then
  echo
  echo "UCHIHA_STORE_HEALTH=OK"
else
  echo "UCHIHA_STORE_HEALTH=NOT_READY"
  echo "=== RECENT LOGS ==="
  journalctl -u uchiha-store.service -n 80 --no-pager || true
fi
