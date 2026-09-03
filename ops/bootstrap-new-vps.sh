#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
REPO_SLUG="yaminuchiha1245-png/UCHIHA"
BASE="/opt/uchiha"
STATE="/var/lib/uchiha"
PYTHON_BIN="python3.12"

log(){ printf '\n[UCHIHA] %s\n' "$*"; }

log "Installing base server packages"
apt-get update -y
apt-get install -y curl ca-certificates software-properties-common python3 python3-venv python3-pip nginx rsync jq unzip tar

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  log "Installing Python 3.12 runtime"
  add-apt-repository -y ppa:deadsnakes/ppa
  apt-get update -y
  apt-get install -y python3.12 python3.12-venv python3.12-dev
fi

mkdir -p "$BASE" "$STATE" /etc/uchiha /var/log/uchiha
chmod 700 /etc/uchiha

remote_sha(){
  local branch="$1"
  curl -fsSL --retry 3 --connect-timeout 10 \
    "https://api.github.com/repos/${REPO_SLUG}/branches/${branch}" \
    | jq -r '.commit.sha // empty'
}

fetch_branch(){
  local name="$1" branch="$2" dir="$BASE/$1"
  local tmp archive src sha
  sha="$(remote_sha "$branch")"
  if [ -z "$sha" ]; then
    echo "ERROR: could not resolve public GitHub branch $branch" >&2
    return 1
  fi

  tmp="$(mktemp -d)"
  archive="$tmp/source.tar.gz"
  src="$tmp/source"
  mkdir -p "$src" "$dir"

  log "Downloading $name from public branch $branch ($sha)"
  curl -fL --retry 3 --connect-timeout 10 \
    -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/${REPO_SLUG}/tarball/${branch}" \
    -o "$archive"
  tar -xzf "$archive" -C "$src" --strip-components=1

  rsync -a --delete \
    --exclude='.venv/' \
    --exclude='.env' \
    --exclude='.env.local' \
    --exclude='.env.production' \
    --exclude='*.db' \
    --exclude='*.db-*' \
    --exclude='*.sqlite' \
    --exclude='*.sqlite3' \
    --exclude='uploads/' \
    --exclude='storage/' \
    --exclude='logs/' \
    "$src/" "$dir/"

  for protected in uploads storage; do
    if [ -d "$src/$protected" ]; then
      mkdir -p "$dir/$protected"
      rsync -a --ignore-existing "$src/$protected/" "$dir/$protected/"
    fi
  done

  printf '%s\n' "$sha" > "$STATE/$name.sha"
  rm -rf "$tmp"
}

fetch_branch store deploy/store-production
fetch_branch builder deploy/builder-production

prepare_python(){
  local name="$1" dir="$BASE/$1"
  [ -f "$dir/requirements.txt" ] || return 0
  log "Preparing Python 3.12 environment for $name"
  if [ ! -x "$dir/.venv/bin/python" ] || ! "$dir/.venv/bin/python" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3,12) else 1)' 2>/dev/null; then
    rm -rf "$dir/.venv"
    "$PYTHON_BIN" -m venv "$dir/.venv"
  fi
  "$dir/.venv/bin/python" -m pip install --upgrade pip wheel >/dev/null
  "$dir/.venv/bin/pip" install -r "$dir/requirements.txt"
}

prepare_python store
prepare_python builder

cat >/usr/local/sbin/uchiha-sync <<'SYNC'
#!/usr/bin/env bash
set -Eeuo pipefail
REPO_SLUG="yaminuchiha1245-png/UCHIHA"
BASE="/opt/uchiha"
STATE="/var/lib/uchiha"
PYTHON_BIN="python3.12"

remote_sha(){
  local branch="$1"
  curl -fsSL --retry 2 --connect-timeout 10 \
    "https://api.github.com/repos/${REPO_SLUG}/branches/${branch}" \
    | jq -r '.commit.sha // empty'
}

fetch_branch(){
  local name="$1" branch="$2" dir="$BASE/$1"
  local tmp archive src sha
  sha="$(remote_sha "$branch")"
  [ -n "$sha" ] || return 1
  tmp="$(mktemp -d)"
  archive="$tmp/source.tar.gz"
  src="$tmp/source"
  mkdir -p "$src" "$dir"
  curl -fL --retry 3 --connect-timeout 10 \
    -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/${REPO_SLUG}/tarball/${branch}" \
    -o "$archive"
  tar -xzf "$archive" -C "$src" --strip-components=1
  rsync -a --delete \
    --exclude='.venv/' \
    --exclude='.env' \
    --exclude='.env.local' \
    --exclude='.env.production' \
    --exclude='*.db' \
    --exclude='*.db-*' \
    --exclude='*.sqlite' \
    --exclude='*.sqlite3' \
    --exclude='uploads/' \
    --exclude='storage/' \
    --exclude='logs/' \
    "$src/" "$dir/"
  for protected in uploads storage; do
    if [ -d "$src/$protected" ]; then
      mkdir -p "$dir/$protected"
      rsync -a --ignore-existing "$src/$protected/" "$dir/$protected/"
    fi
  done
  printf '%s\n' "$sha" > "$STATE/$name.sha"
  rm -rf "$tmp"
}

sync_one(){
  local name="$1" branch="$2" dir="$BASE/$1" old new
  old="$(cat "$STATE/$name.sha" 2>/dev/null || true)"
  new="$(remote_sha "$branch")"
  [ -n "$new" ] || { echo "$(date -Is) unable to resolve $branch"; return 0; }
  [ "$old" != "$new" ] || return 0
  echo "$(date -Is) updating $name $old -> $new"
  fetch_branch "$name" "$branch"
  if [ -f "$dir/requirements.txt" ]; then
    if [ ! -x "$dir/.venv/bin/python" ] || ! "$dir/.venv/bin/python" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3,12) else 1)' 2>/dev/null; then
      rm -rf "$dir/.venv"
      "$PYTHON_BIN" -m venv "$dir/.venv"
    fi
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
Description=UCHIHA public GitHub production sync
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
OnBootSec=3min
OnUnitActiveSec=5min
RandomizedDelaySec=20s
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now uchiha-sync.timer
systemctl enable --now nginx

log "Bootstrap complete"
echo "PYTHON=$($PYTHON_BIN --version 2>&1)"
echo "STORE_COMMIT=$(cat "$STATE/store.sha")"
echo "BUILDER_COMMIT=$(cat "$STATE/builder.sha")"
systemctl --no-pager --full status uchiha-sync.timer | sed -n '1,12p' || true
printf '\nNEXT: secrets and application services are intentionally NOT created yet.\n'
