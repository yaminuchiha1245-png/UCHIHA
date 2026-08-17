#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
REPO_DIR="${UCHIHA_REPO_DIR:-$ROOT_DIR/repo}"
BRANCH="builder/v1-platform"
TMP_UPDATE="/run/uchiha-update-target-$$.sh"
TIMER_FILE="/etc/systemd/system/uchiha-autodeploy.timer"
LIVE_VERIFIED_REF="refs/heads/audit/vps-live-verified"

cleanup() {
  rm -f "$TMP_UPDATE"
}
trap cleanup EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ -d "$REPO_DIR/.git" ]] || { echo "Repository not found at $REPO_DIR" >&2; exit 1; }
cd "$REPO_DIR"
git diff --quiet && git diff --cached --quiet || { echo "Refusing auto-deploy with local repository changes" >&2; exit 1; }
[[ "$(git branch --show-current)" == "$BRANCH" ]] || { echo "Refusing auto-deploy outside $BRANCH" >&2; exit 1; }

ensure_fast_timer() {
  local desired current
  desired='[Unit]
Description=Continuously check builder/v1-platform for UCHIHA updates
[Timer]
OnBootSec=20s
OnUnitInactiveSec=30s
AccuracySec=5s
Persistent=true
Unit=uchiha-autodeploy.service
[Install]
WantedBy=timers.target
'
  current="$(cat "$TIMER_FILE" 2>/dev/null || true)"
  if [[ "$current" != "$desired" ]]; then
    printf '%s' "$desired" >"$TIMER_FILE"
    chmod 644 "$TIMER_FILE"
    systemctl daemon-reload
    systemctl enable --now uchiha-autodeploy.timer >/dev/null 2>&1 || true
    systemctl try-restart uchiha-autodeploy.timer >/dev/null 2>&1 || true
    echo "UCHIHA auto-deploy cadence set to 30 seconds"
  fi
}

publish_live_verified_ref() {
  local deployed_sha
  deployed_sha="$(cat "$ROOT_DIR/current-release" 2>/dev/null || true)"
  if [[ "$deployed_sha" != "$TARGET_SHA" || "$(git rev-parse HEAD)" != "$TARGET_SHA" ]]; then
    echo "Live verification ref not published: release marker or repository HEAD does not match $TARGET_SHA" >&2
    return 0
  fi

  # Best-effort observability only. Deployment has already passed update-vps.sh,
  # which writes current-release after smoke + launch audit. A read-only deploy
  # credential must never turn a healthy production release into a failed one.
  if git push --force origin "$TARGET_SHA:$LIVE_VERIFIED_REF" >/dev/null 2>&1; then
    echo "UCHIHA live verified ref published: $TARGET_SHA"
  else
    echo "UCHIHA live verified ref could not be published (remote may be read-only)" >&2
  fi
}

ensure_fast_timer

# Always fetch the remote branch before doing anything expensive. This keeps
# the normal 30-second check lightweight and makes a new push visible quickly.
git fetch --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
TARGET_SHA="$(git rev-parse "origin/$BRANCH")"
LOCAL_SHA="$(git rev-parse HEAD)"
CURRENT_RELEASE="$(cat "$ROOT_DIR/current-release" 2>/dev/null || true)"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid target SHA: $TARGET_SHA" >&2; exit 1; }

# current-release is written only after the full update, smoke and launch gates
# succeed. If both the repository and that marker match the remote SHA, no
# backup/build/restart work is needed for this polling cycle. Still publish the
# audit ref so GitHub can independently prove which exact SHA is live.
if [[ "$TARGET_SHA" == "$LOCAL_SHA" && "$CURRENT_RELEASE" == "$TARGET_SHA" ]]; then
  publish_live_verified_ref
  exit 0
fi

# Bootstrap from the target commit itself. Even if the locally installed updater
# is old, the next deployment attempt executes the newest update-vps.sh.
git show "${TARGET_SHA}:builder/scripts/update-vps.sh" >"$TMP_UPDATE"
[[ -s "$TMP_UPDATE" ]] || { echo "Target update-vps.sh is empty" >&2; exit 1; }
chmod 700 "$TMP_UPDATE"
echo "UCHIHA auto-deploy target: $TARGET_SHA (local=$LOCAL_SHA release=${CURRENT_RELEASE:-none})"
env UCHIHA_ROOT_DIR="$ROOT_DIR" UCHIHA_REPO_DIR="$REPO_DIR" bash "$TMP_UPDATE"
publish_live_verified_ref
