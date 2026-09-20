#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
REPO_DIR="${UCHIHA_REPO_DIR:-$ROOT_DIR/repo}"
REPOSITORY="yaminuchiha1245-png/UCHIHA"
REMOTE_OPS_ISSUE="24"
DIAGNOSTIC_REF="refs/heads/audit/vps-diagnostics"
LOG_DIR="/var/log/uchiha"
TARGET_SHA="${1:-unknown}"
EXIT_STATUS="${2:-1}"
KEYVAL_APP_KEY="3cg7aby9"
KEYVAL_ITEM_KEY="yourkey"

RAW_FILE="$(mktemp /run/uchiha-remote-ops-raw.XXXXXX)"
SAFE_FILE="$(mktemp /run/uchiha-remote-ops-safe.XXXXXX)"
BODY_FILE="$(mktemp /run/uchiha-remote-ops-body.XXXXXX)"
RELAY_FILE="$(mktemp /run/uchiha-remote-ops-relay.XXXXXX)"
cleanup() { rm -f "$RAW_FILE" "$SAFE_FILE" "$BODY_FILE" "$RELAY_FILE"; }
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

PUBLISHED=false

# Preferred channel: GitHub issue comment via an already-authenticated gh CLI.
if command -v gh >/dev/null 2>&1 && gh auth status --hostname github.com >/dev/null 2>&1; then
  if gh api --method POST "repos/$REPOSITORY/issues/$REMOTE_OPS_ISSUE/comments" \
    -f body="$(cat "$BODY_FILE")" >/dev/null 2>&1; then
    PUBLISHED=true
  else
    echo "Remote Ops issue comment could not be published" >&2
  fi

  if [[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    gh api --method POST "repos/$REPOSITORY/statuses/$TARGET_SHA" \
      -f state=failure \
      -f context='uchiha/vps-live' \
      -f description='VPS deployment failed; see Remote Ops diagnostics' \
      -f target_url='https://github.com/yaminuchiha1245-png/UCHIHA/issues/24' >/dev/null 2>&1 || true
  fi
fi

# Fallback channel: publish one sanitized file as a dedicated diagnostic ref
# using the repository SSH remote already configured on the VPS. This uses git
# plumbing and never changes the production working tree. If the deploy key is
# intentionally read-only, the push simply fails and diagnostics stay local.
publish_git_diagnostic_ref() {
  local blob tree parent commit
  blob="$(git -C "$REPO_DIR" hash-object -w "$SAFE_FILE")" || return 1
  tree="$(printf '100644 blob %s\tlatest.txt\n' "$blob" | git -C "$REPO_DIR" mktree)" || return 1

  git -C "$REPO_DIR" fetch origin "+$DIAGNOSTIC_REF:refs/remotes/origin/audit/vps-diagnostics" >/dev/null 2>&1 || true
  parent="$(git -C "$REPO_DIR" rev-parse refs/remotes/origin/audit/vps-diagnostics 2>/dev/null || true)"

  if [[ "$parent" =~ ^[0-9a-f]{40}$ ]]; then
    commit="$(
      GIT_AUTHOR_NAME='UCHIHA VPS' GIT_AUTHOR_EMAIL='vps@uchiha.local' \
      GIT_COMMITTER_NAME='UCHIHA VPS' GIT_COMMITTER_EMAIL='vps@uchiha.local' \
      git -C "$REPO_DIR" commit-tree "$tree" -p "$parent" -m "ops: VPS failure $TARGET_SHA"
    )" || return 1
  else
    commit="$(
      GIT_AUTHOR_NAME='UCHIHA VPS' GIT_AUTHOR_EMAIL='vps@uchiha.local' \
      GIT_COMMITTER_NAME='UCHIHA VPS' GIT_COMMITTER_EMAIL='vps@uchiha.local' \
      git -C "$REPO_DIR" commit-tree "$tree" -m "ops: VPS failure $TARGET_SHA"
    )" || return 1
  fi

  git -C "$REPO_DIR" push --force origin "$commit:$DIAGNOSTIC_REF" >/dev/null 2>&1
}

if publish_git_diagnostic_ref; then
  PUBLISHED=true
  echo "Remote Ops sanitized diagnostic ref published"
fi

# Last-resort readable relay. Only a short tail of the ALREADY-SANITIZED report
# is sent to a public demo key-value endpoint. No raw logs or environment values
# are sent. The 900-character cap is below the service's documented 1024 limit.
publish_short_keyval_relay() {
  command -v curl >/dev/null 2>&1 || return 1
  python3 - "$SAFE_FILE" "$RELAY_FILE" <<'PY'
import pathlib
import re
import sys
from urllib.parse import quote

text = pathlib.Path(sys.argv[1]).read_text(errors="replace")
lines = [line.strip() for line in text.splitlines() if line.strip()]
interesting = []
for line in lines:
    low = line.lower()
    if any(word in low for word in ("error", "failed", "fatal", "unhealthy", "exception", "typeerror", "referenceerror", "syntaxerror", "eaddr", "listen", "health=")):
        interesting.append(line)
summary = " | ".join(interesting[-12:]) or " | ".join(lines[-12:])
summary = re.sub(r"\s+", " ", summary)
summary = summary[-900:]
pathlib.Path(sys.argv[2]).write_text(quote(summary, safe=""))
PY
  local encoded
  encoded="$(cat "$RELAY_FILE")"
  [[ -n "$encoded" ]] || return 1
  curl -fsS --max-time 10 -X POST \
    "https://keyvalue.immanuel.co/api/KeyVal/UpdateValue/$KEYVAL_APP_KEY/$KEYVAL_ITEM_KEY/$encoded" \
    >/dev/null 2>&1
}

if publish_short_keyval_relay; then
  PUBLISHED=true
  echo "Remote Ops short sanitized relay published"
fi

if [[ "$PUBLISHED" != true ]]; then
  echo "Remote Ops report could not leave the VPS; sanitized diagnostics remain local" >&2
fi
