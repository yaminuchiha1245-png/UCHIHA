#!/usr/bin/env sh
set -eu

VERSION="v5.4.0"
BASE_URL="https://github.com/docker/compose/releases/download/${VERSION}"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64|amd64)
    ASSET="docker-compose-linux-x86_64"
    SHA256="837fd1d35bf6a494f41b5b5988269a7be79de337cf1a1a6ff0e45ab51bb4e9be"
    ;;
  aarch64|arm64)
    ASSET="docker-compose-linux-aarch64"
    SHA256="fc5d1371f1ec7987e703da94ede49af3fb240b83f22991a98511de7bc4b93b"
    ;;
  *)
    echo "Unsupported architecture for Docker Compose: $ARCH" >&2
    exit 2
    ;;
esac

if docker compose version >/dev/null 2>&1; then
  CURRENT="$(docker compose version --short 2>/dev/null || true)"
  echo "Docker Compose plugin already available: ${CURRENT:-unknown}"
  exit 0
fi

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 3; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required" >&2; exit 3; }

PLUGIN_DIR="/usr/local/libexec/docker/cli-plugins"
PLUGIN="$PLUGIN_DIR/docker-compose"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT INT TERM

mkdir -p "$PLUGIN_DIR"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE_URL/$ASSET" -o "$TMP"
printf '%s  %s\n' "$SHA256" "$TMP" | sha256sum -c -
install -m 0755 "$TMP" "$PLUGIN"

docker compose version >/dev/null
CURRENT="$(docker compose version --short 2>/dev/null || true)"
echo "Docker Compose plugin installed and verified: ${CURRENT:-$VERSION}"
