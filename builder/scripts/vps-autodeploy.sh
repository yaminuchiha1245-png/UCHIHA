#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
REPO_DIR="${UCHIHA_REPO_DIR:-$ROOT_DIR/repo}"
BRANCH="builder/v1-platform"
TMP_UPDATE="/run/uchiha-update-target-$$.sh"

cleanup() {
  rm -f "$TMP_UPDATE"
  # GitHub push events are the authoritative deployment trigger. Keep the old
  # polling timer disabled so production is not refreshed periodically.
  if command -v systemctl >/dev/null 2>&1; then
    systemctl disable --now uchiha-autodeploy.timer >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ -d "$REPO_DIR/.git" ]] || { echo "Repository not found at $REPO_DIR" >&2; exit 1; }
cd "$REPO_DIR"
git diff --quiet && git diff --cached --quiet || { echo "Refusing auto-deploy with local repository changes" >&2; exit 1; }
[[ "$(git branch --show-current)" == "$BRANCH" ]] || { echo "Refusing auto-deploy outside $BRANCH" >&2; exit 1; }

# Disable any legacy periodic polling before handling this explicit GitHub push.
systemctl disable --now uchiha-autodeploy.timer >/dev/null 2>&1 || true

echo "UCHIHA deploy trigger: GitHub push only (periodic polling disabled)"

# Fetch the remote branch and deploy only when there is an actual new target.
git fetch --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
TARGET_SHA="$(git rev-parse "origin/$BRANCH")"
LOCAL_SHA="$(git rev-parse HEAD)"
CURRENT_RELEASE="$(cat "$ROOT_DIR/current-release" 2>/dev/null || true)"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid target SHA: $TARGET_SHA" >&2; exit 1; }

# current-release is written only after the full update, smoke and launch gates
# succeed. If both the repository and that marker match the remote SHA, no
# backup/build/restart work is needed for this push.
if [[ "$TARGET_SHA" == "$LOCAL_SHA" && "$CURRENT_RELEASE" == "$TARGET_SHA" ]]; then
  exit 0
fi

# Bootstrap from the target commit itself. Even if the locally installed updater
# is old, the next deployment attempt executes the newest update-vps.sh.
git show "${TARGET_SHA}:builder/scripts/update-vps.sh" >"$TMP_UPDATE"
[[ -s "$TMP_UPDATE" ]] || { echo "Target update-vps.sh is empty" >&2; exit 1; }
chmod 700 "$TMP_UPDATE"
echo "UCHIHA deploy target: $TARGET_SHA (local=$LOCAL_SHA release=${CURRENT_RELEASE:-none})"

# Do not exec here: update-vps.sh may temporarily recreate the legacy timer while
# updating runtime files. Returning to this wrapper guarantees the EXIT cleanup
# disables that timer after success or failure.
env UCHIHA_ROOT_DIR="$ROOT_DIR" UCHIHA_REPO_DIR="$REPO_DIR" bash "$TMP_UPDATE"
