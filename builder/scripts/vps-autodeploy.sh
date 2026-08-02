#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
UPDATE_SCRIPT="$ROOT_DIR/repo/builder/scripts/update-vps.sh"
[[ -f "$UPDATE_SCRIPT" ]] || { echo "Missing $UPDATE_SCRIPT" >&2; exit 1; }
exec bash "$UPDATE_SCRIPT"
