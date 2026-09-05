#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
REPO_DIR="$ROOT_DIR/repo"
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
for file in vps-autodeploy.sh backup-postgres.sh restore-test.sh smoke-vps.sh; do
  [[ -f "$REPO_DIR/builder/scripts/$file" ]] || { echo "Missing $file" >&2; exit 1; }
done
[[ -f "$ROOT_DIR/compose.yml" && -f "$ROOT_DIR/.env" ]] || { echo "VPS runtime is not installed" >&2; exit 1; }

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y curl jq util-linux
install -d -m 700 /var/backups/uchiha
install -m 700 "$REPO_DIR/builder/scripts/vps-autodeploy.sh" /usr/local/sbin/uchiha-autodeploy
install -m 700 "$REPO_DIR/builder/scripts/backup-postgres.sh" /usr/local/sbin/uchiha-backup
install -m 700 "$REPO_DIR/builder/scripts/restore-test.sh" /usr/local/sbin/uchiha-restore-test

cat >/etc/systemd/system/uchiha-autodeploy.service <<'SERVICE'
[Unit]
Description=UCHIHA Builder safe branch update
Wants=network-online.target docker.service
After=network-online.target docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/uchiha-autodeploy
User=root
Group=root
Nice=10
SERVICE

cat >/etc/systemd/system/uchiha-autodeploy.timer <<'TIMER'
[Unit]
Description=Continuously check builder/v1-platform for UCHIHA updates
[Timer]
OnBootSec=20s
OnUnitInactiveSec=30s
AccuracySec=5s
Persistent=true
Unit=uchiha-autodeploy.service
[Install]
WantedBy=timers.target
TIMER

cat >/etc/systemd/system/uchiha-backup.service <<'SERVICE'
[Unit]
Description=UCHIHA Builder verified PostgreSQL backup
Requires=docker.service
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/uchiha-backup
User=root
Group=root
Nice=10
SERVICE

cat >/etc/systemd/system/uchiha-backup.timer <<'TIMER'
[Unit]
Description=Daily UCHIHA Builder PostgreSQL backup
[Timer]
OnCalendar=*-*-* 03:15:00
RandomizedDelaySec=15min
Persistent=true
Unit=uchiha-backup.service
[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now uchiha-autodeploy.timer uchiha-backup.timer
BACKUP_FILE="$(/usr/local/sbin/uchiha-backup)"
/usr/local/sbin/uchiha-restore-test "$BACKUP_FILE"
bash "$REPO_DIR/builder/scripts/smoke-vps.sh"
systemctl --no-pager --full status uchiha-autodeploy.timer uchiha-backup.timer || true
