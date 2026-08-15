#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
REPO_DIR="${UCHIHA_REPO_DIR:-$ROOT_DIR/repo}"
BRANCH="builder/v1-platform"
TMP_UPDATE="/run/uchiha-update-target-$$.sh"

cleanup() {
  rm -f "$TMP_UPDATE"
}
trap cleanup EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ -d "$REPO_DIR/.git" ]] || { echo "Repository not found at $REPO_DIR" >&2; exit 1; }
cd "$REPO_DIR"
git diff --quiet && git diff --cached --quiet || { echo "Refusing auto-deploy with local repository changes" >&2; exit 1; }
[[ "$(git branch --show-current)" == "$BRANCH" ]] || { echo "Refusing auto-deploy outside $BRANCH" >&2; exit 1; }

# Bootstrap from the remote branch before invoking the updater. This avoids a
# deadlock where an old local update-vps.sh fails before its own git fetch and
# therefore can never receive the fix that would make future deploys succeed.
git fetch --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
TARGET_SHA="$(git rev-parse "origin/$BRANCH")"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid target SHA: $TARGET_SHA" >&2; exit 1; }

git show "${TARGET_SHA}:builder/scripts/update-vps.sh" >"$TMP_UPDATE"
[[ -s "$TMP_UPDATE" ]] || { echo "Target update-vps.sh is empty" >&2; exit 1; }
chmod 700 "$TMP_UPDATE"
echo "UCHIHA auto-deploy target: $TARGET_SHA"
exec env UCHIHA_ROOT_DIR="$ROOT_DIR" UCHIHA_REPO_DIR="$REPO_DIR" bash "$TMP_UPDATE"
