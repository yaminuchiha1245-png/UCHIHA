#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
REPO_DIR="${UCHIHA_REPO_DIR:-$ROOT_DIR/repo}"
REPOSITORY="yaminuchiha1245-png/UCHIHA"
BRANCH="builder/v1-platform"
TMP_UPDATE="/run/uchiha-update-target-$$.sh"
TMP_REPORT="/run/uchiha-report-target-$$.sh"
TIMER_FILE="/etc/systemd/system/uchiha-autodeploy.timer"
FAILED_RELEASE_FILE="$ROOT_DIR/failed-release"
MONITOR_FILE="/var/log/uchiha/failure-target-$$.log"
UPDATE_PID=""
MONITOR_PID=""

cleanup() {
  rm -f "$TMP_UPDATE" "$TMP_REPORT"
  if [[ -n "$MONITOR_PID" ]]; then kill "$MONITOR_PID" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ -d "$REPO_DIR/.git" ]] || { echo "Repository not found at $REPO_DIR" >&2; exit 1; }
install -d -m 700 /var/log/uchiha
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

self_heal_actions_runner() {
  local unit units runner_dir runner_user

  # A registered self-hosted runner is already present on this VPS from the
  # original deployment setup. Keep it online so GitHub can stream VPS job logs
  # back to the repository without requiring an interactive SSH/Termius session.
  units="$(systemctl list-unit-files 'actions.runner.*.service' --no-legend --no-pager 2>/dev/null | awk '{print $1}' || true)"
  if [[ -n "$units" ]]; then
    while IFS= read -r unit; do
      [[ -n "$unit" ]] || continue
      systemctl enable "$unit" >/dev/null 2>&1 || true
      systemctl start "$unit" >/dev/null 2>&1 || true
      if systemctl is-active --quiet "$unit"; then
        echo "UCHIHA GitHub Actions runner active: $unit"
        return 0
      fi
    done <<<"$units"
  fi

  # Fallback for a runner that was registered interactively but whose systemd
  # unit disappeared. Never re-register it and never read/copy runner secrets;
  # only start an existing .runner installation as its owning Unix user.
  for runner_dir in /home/uchiha-deploy/actions-runner /home/uchiha-deploy/*actions-runner* /opt/actions-runner; do
    [[ -d "$runner_dir" && -f "$runner_dir/.runner" && -x "$runner_dir/run.sh" ]] || continue
    if pgrep -f "$runner_dir/bin/Runner.Listener" >/dev/null 2>&1; then
      echo "UCHIHA GitHub Actions runner listener is already active"
      return 0
    fi
    runner_user="$(stat -c '%U' "$runner_dir" 2>/dev/null || true)"
    [[ -n "$runner_user" && "$runner_user" != "UNKNOWN" ]] || runner_user="uchiha-deploy"
    nohup runuser -u "$runner_user" -- "$runner_dir/run.sh" \
      >>/var/log/uchiha/github-runner.log 2>&1 </dev/null &
    sleep 3
    if pgrep -f "$runner_dir/bin/Runner.Listener" >/dev/null 2>&1; then
      echo "UCHIHA GitHub Actions runner started from existing registration"
      return 0
    fi
  done

  echo "UCHIHA GitHub Actions runner is not online yet; auto-deploy remains available" >&2
  return 0
}

publish_live_verified_status() {
  local deployed_sha
  deployed_sha="$(cat "$ROOT_DIR/current-release" 2>/dev/null || true)"
  if [[ "$deployed_sha" != "$TARGET_SHA" || "$(git rev-parse HEAD)" != "$TARGET_SHA" ]]; then
    echo "Live verification status not published: release marker or repository HEAD does not match $TARGET_SHA" >&2
    return 0
  fi

  if command -v gh >/dev/null 2>&1 && gh auth status --hostname github.com >/dev/null 2>&1; then
    if gh api --method POST "repos/$REPOSITORY/statuses/$TARGET_SHA" \
      -f state=success \
      -f context='uchiha/vps-live' \
      -f description='Exact VPS release passed smoke and launch gates' \
      -f target_url='https://uchiha-builder.com/ready' >/dev/null 2>&1; then
      echo "UCHIHA live commit status published: $TARGET_SHA"
    fi
  fi
}

monitor_target_api() {
  local target_image_id container_image_id state tmp
  tmp="${MONITOR_FILE}.tmp"
  while [[ -n "$UPDATE_PID" ]] && kill -0 "$UPDATE_PID" >/dev/null 2>&1; do
    target_image_id="$(docker image inspect "uchiha-builder:$TARGET_SHA" --format '{{.Id}}' 2>/dev/null || true)"
    container_image_id="$(docker inspect -f '{{.Image}}' uchiha-api 2>/dev/null || true)"
    if [[ -n "$target_image_id" && "$container_image_id" == "$target_image_id" ]]; then
      state="$(docker inspect -f 'status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} exit={{.State.ExitCode}} error={{.State.Error}}' uchiha-api 2>/dev/null || true)"
      {
        echo "timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "target_sha=$TARGET_SHA"
        echo "target_image_id=$target_image_id"
        echo "container_image_id=$container_image_id"
        echo "$state"
        echo
        echo "=== TARGET API INSPECT ==="
        docker inspect -f 'name={{.Name}} status={{.State.Status}} started={{.State.StartedAt}} finished={{.State.FinishedAt}} restart_count={{.RestartCount}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' uchiha-api 2>&1 || true
        echo
        echo "=== TARGET API LOGS ==="
        docker logs --tail=260 uchiha-api 2>&1 || true
      } >"$tmp"
      mv "$tmp" "$MONITOR_FILE"
      chmod 600 "$MONITOR_FILE"
    fi
    sleep 2
  done
  rm -f "$tmp"
}

ensure_fast_timer
self_heal_actions_runner

git fetch --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
TARGET_SHA="$(git rev-parse "origin/$BRANCH")"
LOCAL_SHA="$(git rev-parse HEAD)"
CURRENT_RELEASE="$(cat "$ROOT_DIR/current-release" 2>/dev/null || true)"
FAILED_RELEASE="$(cat "$FAILED_RELEASE_FILE" 2>/dev/null || true)"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid target SHA: $TARGET_SHA" >&2; exit 1; }

# A failed SHA is attempted once. The lightweight timer continues checking the
# branch, but expensive build/deploy work resumes only when a new commit arrives.
if [[ "$FAILED_RELEASE" == "$TARGET_SHA" ]]; then
  echo "UCHIHA target $TARGET_SHA is already marked failed; waiting for a new commit"
  exit 0
fi

if [[ "$TARGET_SHA" == "$LOCAL_SHA" && "$CURRENT_RELEASE" == "$TARGET_SHA" ]]; then
  rm -f "$FAILED_RELEASE_FILE" "$MONITOR_FILE"
  publish_live_verified_status
  exit 0
fi

# Bootstrap both updater and failure reporter from the target commit itself so a
# rollback of the working tree cannot remove the diagnostics channel.
git show "${TARGET_SHA}:builder/scripts/update-vps.sh" >"$TMP_UPDATE"
[[ -s "$TMP_UPDATE" ]] || { echo "Target update-vps.sh is empty" >&2; exit 1; }
git show "${TARGET_SHA}:builder/scripts/report-vps-failure.sh" >"$TMP_REPORT"
[[ -s "$TMP_REPORT" ]] || { echo "Target report-vps-failure.sh is empty" >&2; exit 1; }
chmod 700 "$TMP_UPDATE" "$TMP_REPORT"
rm -f "$MONITOR_FILE"

echo "UCHIHA auto-deploy target: $TARGET_SHA (local=$LOCAL_SHA release=${CURRENT_RELEASE:-none})"
set +e
env UCHIHA_ROOT_DIR="$ROOT_DIR" UCHIHA_REPO_DIR="$REPO_DIR" bash "$TMP_UPDATE" &
UPDATE_PID=$!
monitor_target_api &
MONITOR_PID=$!
wait "$UPDATE_PID"
UPDATE_STATUS=$?
kill "$MONITOR_PID" >/dev/null 2>&1 || true
wait "$MONITOR_PID" >/dev/null 2>&1 || true
MONITOR_PID=""
UPDATE_PID=""
set -e

if (( UPDATE_STATUS != 0 )); then
  printf '%s\n' "$TARGET_SHA" >"$FAILED_RELEASE_FILE"
  chmod 600 "$FAILED_RELEASE_FILE"
  env UCHIHA_ROOT_DIR="$ROOT_DIR" UCHIHA_REPO_DIR="$REPO_DIR" \
    bash "$TMP_REPORT" "$TARGET_SHA" "$UPDATE_STATUS" || true
  echo "UCHIHA target marked failed after one safe attempt: $TARGET_SHA" >&2
  exit "$UPDATE_STATUS"
fi

rm -f "$FAILED_RELEASE_FILE" "$MONITOR_FILE"
publish_live_verified_status
