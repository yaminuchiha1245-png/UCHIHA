#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
REPO_DIR="${UCHIHA_REPO_DIR:-$ROOT_DIR/repo}"
REPOSITORY="yaminuchiha1245-png/UCHIHA"
REMOTE_OPS_ISSUE="24"
LOG_DIR="/var/log/uchiha"
TARGET_SHA="${1:-unknown}"
EXIT_STATUS="${2:-1}"

RAW_FILE="$(mktemp /run/uchiha-remote-ops-raw.XXXXXX)"
SAFE_FILE="$(mktemp /run/uchiha-remote-ops-safe.XXXXXX)"
BODY_FILE="$(mktemp /run/uchiha-remote-ops-body.XXXXXX)"
cleanup() { rm -f "$RAW_FILE" "$SAFE_FILE" "$BODY_FILE"; }
trap cleanup EXIT

LATEST_FAILURE="$(ls -1t "$LOG_DIR"/failure-*.log 2>/dev/null | head -n1 || true)"
LATEST_UPDATE="$(ls -1t "$LOG_DIR"/update-*.log 2>/dev/null | head -n1 || true)"
CURRENT_RELEASE="$(cat "$ROOT_DIR/current-release" 2>/dev/null || true)"
SERVER_HEAD="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || true)"
UTC_NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

{
  echo "UCHIHA VPS REMOTE OPS FAILURE"
  echo "timestamp=$UTC_NOW"
  echo "target_sha=$TARGET_SHA"
  echo "exit_status=$EXIT_STATUS"
  echo "server_head=${SERVER_HEAD:-unknown}"
  echo "current_release=${CURRENT_RELEASE:-unknown}"
  echo
  echo "=== PRE-ROLLBACK FAILURE DIAGNOSTICS ==="
  if [[ -n "$LATEST_FAILURE" && -r "$LATEST_FAILURE" ]]; then
    tail -n 320 "$LATEST_FAILURE"
  else
    echo "No pre-rollback failure diagnostic file found."
  fi
  echo
  echo "=== DEPLOY UPDATE LOG TAIL ==="
  if [[ -n "$LATEST_UPDATE" && -r "$LATEST_UPDATE" ]]; then
    tail -n 260 "$LATEST_UPDATE"
  else
    echo "No update log found."
  fi
} >"$RAW_FILE"

# Never publish raw VPS logs. Exact .env values and common secret formats are
# removed before anything leaves the server. If Python is unavailable, fail
# closed and keep diagnostics local instead of risking secret disclosure.
command -v python3 >/dev/null 2>&1 || {
  echo "Remote Ops report not published: python3 unavailable for mandatory redaction" >&2
  exit 0
}

python3 - "$ROOT_DIR/.env" "$RAW_FILE" "$SAFE_FILE" <<'PY'
import pathlib
import re
import sys

env_path, raw_path, safe_path = map(pathlib.Path, sys.argv[1:4])
text = raw_path.read_text(errors="replace")

# First redact exact configured values from the host environment. Short values
# are skipped to avoid destroying ordinary log text.
if env_path.exists():
    for raw_line in env_path.read_text(errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        if len(value) >= 6:
            text = text.replace(value, f"[REDACTED:{key.strip()}]")

patterns = [
    (r"(?i)\bBearer\s+[A-Za-z0-9._~+\-/=]+", "Bearer [REDACTED]"),
    (r"\bsk-[A-Za-z0-9_-]{10,}\b", "sk-[REDACTED]"),
    (r"\b[0-9]{6,12}:[A-Za-z0-9_-]{20,}\b", "[TELEGRAM_TOKEN_REDACTED]"),
    (r"(?i)(postgres(?:ql)?://[^:\s/@]+:)([^@\s]+)(@)", r"\1[REDACTED]\3"),
    (r"(?i)((?:password|passwd|secret|token|api[_-]?key|authorization|cookie|session)\s*[:=]\s*)([^\s,;\"'}]+)", r"\1[REDACTED]"),
]
for pattern, replacement in patterns:
    text = re.sub(pattern, replacement, text)

# Keep the report below GitHub's comment limit while preserving the most recent
# and therefore most relevant failure output.
limit = 48000
if len(text) > limit:
    text = "[report truncated to most recent output]\n" + text[-limit:]

safe_path.write_text(text)
PY

{
  echo "### UCHIHA VPS deployment failure"
  echo
  echo "- Target: \`$TARGET_SHA\`"
  echo "- Exit status: \`$EXIT_STATUS\`"
  echo "- Reported: \`$UTC_NOW\`"
  echo "- Secrets: server-side redaction applied before upload"
  echo
  echo '```text'
  cat "$SAFE_FILE"
  echo '```'
} >"$BODY_FILE"

if command -v gh >/dev/null 2>&1 && gh auth status --hostname github.com >/dev/null 2>&1; then
  gh api --method POST "repos/$REPOSITORY/issues/$REMOTE_OPS_ISSUE/comments" \
    -f body="$(cat "$BODY_FILE")" >/dev/null 2>&1 || \
    echo "Remote Ops issue comment could not be published" >&2

  if [[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    gh api --method POST "repos/$REPOSITORY/statuses/$TARGET_SHA" \
      -f state=failure \
      -f context='uchiha/vps-live' \
      -f description='VPS deployment failed; see Remote Ops issue #24' \
      -f target_url='https://github.com/yaminuchiha1245-png/UCHIHA/issues/24' >/dev/null 2>&1 || true
  fi
else
  echo "Remote Ops report not published: GitHub CLI is not authenticated" >&2
fi
