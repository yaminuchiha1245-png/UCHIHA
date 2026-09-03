#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run as root" >&2
  exit 1
fi

REPO_SLUG="yaminuchiha1245-png/UCHIHA"
CONTROL_BRANCH="server-control"
RAW_BASE="https://raw.githubusercontent.com/${REPO_SLUG}/${CONTROL_BRANCH}/control"

export DEBIAN_FRONTEND=noninteractive

echo "[1/7] Installing control dependencies..."
apt-get update -y
apt-get install -y curl ca-certificates jq rsync tar unzip git util-linux

if ! command -v docker >/dev/null 2>&1; then
  echo "[2/7] Installing Docker..."
  apt-get install -y docker.io
  systemctl enable --now docker
else
  echo "[2/7] Docker already installed."
fi

if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  echo "[3/7] Installing Docker Compose..."
  apt-get install -y docker-compose || true
else
  echo "[3/7] Docker Compose already installed."
fi

mkdir -p /etc/uchiha/secrets /var/lib/uchiha-control /opt/uchiha/projects
chmod 700 /etc/uchiha/secrets

echo "[4/7] Installing UCHIHA control agent..."
curl -fsSL --retry 3 "${RAW_BASE}/agent.sh" -o /usr/local/sbin/uchiha-control-agent
chmod 755 /usr/local/sbin/uchiha-control-agent

cat >/etc/systemd/system/uchiha-control.service <<'EOF'
[Unit]
Description=UCHIHA GitHub desired-state control agent
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/uchiha-control-agent
Nice=10
EOF

cat >/etc/systemd/system/uchiha-control.timer <<'EOF'
[Unit]
Description=Check GitHub UCHIHA server-control desired state

[Timer]
OnBootSec=60s
OnUnitActiveSec=2min
RandomizedDelaySec=10s
Persistent=true

[Install]
WantedBy=timers.target
EOF

cat >/usr/local/bin/uchiha-control-status <<'EOF'
#!/usr/bin/env bash
set -u
echo "=== UCHIHA CONTROL ==="
systemctl --no-pager --full status uchiha-control.timer | sed -n '1,14p' || true
echo
echo "=== LAST CONTROL RUN ==="
journalctl -u uchiha-control.service -n 40 --no-pager || true
echo
echo "=== PROJECT STATE ==="
find /var/lib/uchiha-control -maxdepth 1 -name '*.sha' -printf '%f: ' -exec cat {} \; 2>/dev/null || true
EOF
chmod 755 /usr/local/bin/uchiha-control-status

echo "[5/7] Retiring old temporary sync/bot services..."
systemctl disable --now uchiha-sync.timer 2>/dev/null || true
systemctl disable --now game-zone-bot.service 2>/dev/null || true

echo "[6/7] Enabling control timer..."
systemctl daemon-reload
systemctl enable --now uchiha-control.timer

echo "[7/7] Running first sync..."
systemctl start uchiha-control.service || true

echo
echo "UCHIHA_CONTROL=READY"
echo "Control path: ChatGPT -> GitHub branch server-control -> this VPS"
echo "Secrets path: /etc/uchiha/secrets/ (never stored in GitHub)"
echo "Check status anytime with: uchiha-control-status"
