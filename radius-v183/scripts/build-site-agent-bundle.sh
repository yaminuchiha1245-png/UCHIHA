#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
out="$root/dist/agent-release"
mkdir -p "$out"
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
dest="$temp/uchiha-site-agent"
mkdir -p "$dest/apps" "$dest/packages" "$dest/infra/freeradius"
cp -R apps/radius-agent "$dest/apps/"
cp -R packages/contracts "$dest/packages/"
cp -R infra/freeradius/. "$dest/infra/freeradius/"
for file in install.sh check-and-start.sh check-config.mjs radius-agent.env.template uchiha-site-agent.service.in Dockerfile compose.yaml DOCKER-README.md; do
  cp "infra/site-agent/$file" "$dest/$file"
done
cp infra/site-agent/README.md "$dest/README.md"
cat > "$dest/package.json" <<'JSON'
{
  "name": "uchiha-site-agent-release",
  "version": "1.0.0-rc.1",
  "private": true,
  "type": "module",
  "workspaces": ["apps/radius-agent", "packages/contracts"],
  "scripts": {
    "start": "node apps/radius-agent/src/index.js",
    "preflight": "node check-config.mjs"
  }
}
JSON
chmod 0755 "$dest/install.sh" "$dest/check-and-start.sh"
find "$dest" -type f \( -name '*.env' -o -name 'routers.json' \) -exec chmod 0600 {} \;
archive="$out/uchiha-site-agent-v183.tar.gz"
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -C "$temp" -czf "$archive" uchiha-site-agent
(cd "$out" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
echo "BUNDLE_READY $archive"
