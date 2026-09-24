#!/usr/bin/env bash
set -euo pipefail
if (( EUID != 0 )); then echo "Run as root: sudo bash check-and-start.sh"; exit 1; fi
node_bin=$(cat /opt/uchiha-radius-agent/node-path.txt)
echo "Checking tenant-specific configuration and authenticated TLS probes..."
runuser -u uchiha-agent -- "$node_bin" /opt/uchiha-radius-agent/check-config.mjs --probe
systemctl daemon-reload
systemctl enable --now uchiha-site-agent.service
sleep 2
systemctl is-active --quiet uchiha-site-agent.service
echo "Site Agent started. Check your RADIUS status page for signed live heartbeats."
