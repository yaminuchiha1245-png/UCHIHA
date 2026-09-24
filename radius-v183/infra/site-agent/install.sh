#!/usr/bin/env bash
set -euo pipefail
self=$(cd "$(dirname "$0")" && pwd)
node_bin=$(command -v node || true)
if [[ -z "$node_bin" ]] || [[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 24 ]]; then
  echo "Install system-wide Node.js 24 and npm on this local Linux host first."; exit 1
fi
command -v npm >/dev/null || { echo "npm is required"; exit 1; }
command -v systemctl >/dev/null || { echo "This installer requires systemd Linux"; exit 1; }
test -f "$self/apps/radius-agent/src/index.js"
test -f "$self/packages/contracts/src/index.js"
echo "Agent release OK. Node $(node --version), npm $(npm --version)"
if [[ "$*" == "--check" ]]; then exit 0; fi
if (( EUID != 0 )); then echo "Run: sudo bash install.sh"; exit 1; fi
if [[ -e /opt/uchiha-radius-agent/apps/radius-agent/src/index.js ]]; then
  echo "Existing installation found. Refusing destructive replacement."; exit 1
fi
node_bin=$(readlink -f "$node_bin")
if [[ "$node_bin" == /root/* || "$node_bin" == /home/* ]]; then
  echo "Use system-wide Node.js 24, not a private nvm path."; exit 1
fi
getent group uchiha-agent >/dev/null || groupadd --system uchiha-agent
id -u uchiha-agent >/dev/null 2>&1 || useradd --system --gid uchiha-agent --home-dir /var/lib/uchiha-radius-agent --shell /usr/sbin/nologin uchiha-agent
runuser -u uchiha-agent -- "$node_bin" --version >/dev/null
install -d -m 0755 -o root -g root /opt/uchiha-radius-agent
if [[ ! -d /etc/uchiha-radius ]]; then
  install -d -m 0750 -o root -g uchiha-agent /etc/uchiha-radius
fi
install -d -m 0700 -o uchiha-agent -g uchiha-agent /var/lib/uchiha-radius-agent
cp -R "$self/apps" "$self/packages" "$self/package.json" /opt/uchiha-radius-agent/
install -m 0644 "$self/check-config.mjs" /opt/uchiha-radius-agent/check-config.mjs
install -m 0755 "$self/check-and-start.sh" /opt/uchiha-radius-agent/check-and-start.sh
install -d -m 0755 -o root -g root /opt/uchiha-radius-agent/infra/freeradius
cp -R "$self/infra/freeradius/." /opt/uchiha-radius-agent/infra/freeradius/
if [[ ! -e /etc/uchiha-radius/radius-agent.env ]]; then
  install -m 0600 -o uchiha-agent -g uchiha-agent "$self/radius-agent.env.template" /etc/uchiha-radius/radius-agent.env
fi
if [[ ! -e /etc/uchiha-radius/routers.json ]]; then
  install -m 0600 -o uchiha-agent -g uchiha-agent "$self/infra/freeradius/routers.example.json" /etc/uchiha-radius/routers.json
fi
printf '%s\n' "$node_bin" > /opt/uchiha-radius-agent/node-path.txt
chmod 0644 /opt/uchiha-radius-agent/node-path.txt
(cd /opt/uchiha-radius-agent && npm install --offline --ignore-scripts --no-audit --no-fund)
sed "s#__NODE_BIN__#$node_bin#g" "$self/uchiha-site-agent.service.in" > /etc/systemd/system/uchiha-site-agent.service
chmod 0644 /etc/systemd/system/uchiha-site-agent.service
systemctl daemon-reload
echo "Installed WITHOUT starting. Download your personal templates from RADIUS > Site Agent."
echo "Fill private /etc/uchiha-radius/radius-agent.env, routers.json and a trusted local CA."
echo "Then run sudo bash /opt/uchiha-radius-agent/check-and-start.sh."
