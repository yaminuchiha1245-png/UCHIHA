#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
REPO="https://github.com/yaminuchiha1245-png/UCHIHA.git"
BASE="/opt/uchiha"

log(){ printf '\n[UCHIHA] %s\n' "$*"; }

log "Installing base server packages"
apt-get update -y
apt-get install -y git curl ca-certificates python3 python3-venv python3-pip nginx rsync jq unzip

mkdir -p "$BASE" /etc/uchiha /var/log/uchiha
chmod 700 /etc/uchiha

clone_or_fix(){
  local name="$1" branch="$2" dir="$BASE/$1"
  if [ ! -d "$dir/.git" ]; then
    log "Cloning $name from $branch"
    rm -rf "$dir"
    git clone --branch "$branch" --single-branch "$REPO" "$dir"
  else
    log "Refreshing git remote for $name"
    git -C "$dir" remote set-url origin "$REPO"
    git -C "$dir" fetch origin "$branch"
    git -C "$dir" checkout -B "$branch" "origin/$branch"
  fi
}

clone_or_fix store deploy/store-production
clone_or_fix builder deploy/builder-production

prepare_python(){
  local name="$1" dir="$BASE/$1"
  [ -f "$dir/requirements.txt" ] || return 0
  log "Preparing Python environment for $name"
  if [ ! -x "$dir/.venv/bin/python" ]; then
    python3 -m venv "$dir/.venv"
  fi
  "$dir/.venv/bin/python" -m pip install --upgrade pip wheel >/dev/null
  "$dir/.venv/bin/pip" install -r "$dir/requirements.txt"
}

prepare_python store
prepare_python builder

cat >/usr/local/sbin/uchiha-sync <<'SYNC'
#!/usr/bin/env bash
set -Eeuo pipefail
BASE=/opt/uchiha
sync_one(){
  local name="$1" branch="$2" dir="$BASE/$1"
  [ -d "$dir/.git" ] || return 0
  old="$(git -C "$dir" rev-parse HEAD 2>/dev/null || true)"
  git -C "$dir" fetch -q origin "$branch"
  new="$(git -C "$dir" rev-parse "origin/$branch")"
  if [ "$old" = "$new" ]; then return 0; fi
  echo "$(date -Is) updating $name $old -> $new"
  git -C "$dir" checkout -q -B "$branch" "origin/$branch"
  git -C "$dir" reset -q --hard "origin/$branch"
  if [ -f "$dir/requirements.txt" ]; then
    [ -x "$dir/.venv/bin/python" ] || python3 -m venv "$dir/.venv"
    "$dir/.venv/bin/pip" install -q -r "$dir/requirements.txt"
  fi
  if systemctl cat "uchiha-$name.service" >/dev/null 2>&1; then
    systemctl restart "uchiha-$name.service"
  fi
}
sync_one store deploy/store-production
sync_one builder deploy/builder-production
SYNC
chmod 755 /usr/local/sbin/uchiha-sync

cat >/etc/systemd/system/uchiha-sync.service <<'EOF'
[Unit]
Description=UCHIHA GitHub production sync
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/uchiha-sync
EOF

cat >/etc/systemd/system/uchiha-sync.timer <<'EOF'
[Unit]
Description=Check UCHIHA production branches for updates

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
RandomizedDelaySec=15s
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now uchiha-sync.timer
systemctl enable --now nginx

log "Bootstrap complete"
echo "STORE_BRANCH=$(git -C "$BASE/store" branch --show-current)"
echo "STORE_COMMIT=$(git -C "$BASE/store" rev-parse --short HEAD)"
echo "BUILDER_BRANCH=$(git -C "$BASE/builder" branch --show-current)"
echo "BUILDER_COMMIT=$(git -C "$BASE/builder" rev-parse --short HEAD)"
systemctl --no-pager --full status uchiha-sync.timer | sed -n '1,12p' || true
printf '\nNEXT: secrets and application services are intentionally NOT created yet.\n'
