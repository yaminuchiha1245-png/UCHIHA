#!/usr/bin/env bash
set -euo pipefail

RELEASE_ID="uchiha-radius-v101-backend-v37"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_ROOT="/opt/uchiha-radius"
RELEASE_ROOT="${INSTALL_ROOT}/releases"
CURRENT_LINK="${INSTALL_ROOT}/current"
STATE_DIR="/var/lib/uchiha-radius"
BACKUP_DIR="${STATE_DIR}/backups"
ETC_DIR="/etc/uchiha-radius"
ENV_FILE="${ETC_DIR}/connector.env"
SERVICE_NAME="uchiha-radius"
SERVICE_USER="uchiha-radius"
SERVICE_GROUP="uchiha-radius"
PUBLIC_URL=""
DOMAIN=""
MODE="dry-run"
PREPARE_ONLY=0
SKIP_NGINX=0
SKIP_START=0

usage() {
  cat <<'EOF'
UCHIHA RADIUS-A v101 / Backend v37 VPS bootstrap

Default mode is DRY-RUN and makes no system changes.

Usage:
  ./UCHIHA-RADIUS-v101-Backend-v37-vps-bootstrap.sh [options]

Options:
  --apply                 Perform changes (requires root).
  --dry-run               Print planned actions only (default).
  --prepare-only          Create user/directories/templates but do not deploy/start.
  --source-dir PATH       Flat extracted v101/v37 release directory.
  --env-file PATH         Production environment file.
  --domain DOMAIN         Public hostname for Nginx configuration.
  --public-url URL        HTTPS base URL for post-start smoke test.
  --skip-nginx            Do not install/test/reload Nginx config.
  --skip-start            Install/deploy but do not start systemd service.
  -h, --help              Show this help.

Safe first-run flow:
  1) Run without --apply to review.
  2) Run --apply --prepare-only.
  3) Fill /etc/uchiha-radius/connector.env and bootstrap owner password file.
  4) Ensure TLS certificate exists (or use --skip-nginx temporarily).
  5) Run --apply --domain radius.example.com --public-url https://radius.example.com
EOF
}

log(){ printf '%s\n' "$*"; }
die(){ printf 'BLOCKED: %s\n' "$*" >&2; exit 2; }

run() {
  if [[ "$MODE" == "dry-run" ]]; then
    printf '+'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) MODE="apply"; shift;;
    --dry-run) MODE="dry-run"; shift;;
    --prepare-only) PREPARE_ONLY=1; shift;;
    --source-dir) SOURCE_DIR="$2"; shift 2;;
    --env-file) ENV_FILE="$2"; ETC_DIR="$(dirname "$2")"; shift 2;;
    --domain) DOMAIN="$2"; shift 2;;
    --public-url) PUBLIC_URL="$2"; shift 2;;
    --skip-nginx) SKIP_NGINX=1; shift;;
    --skip-start) SKIP_START=1; shift;;
    -h|--help) usage; exit 0;;
    *) die "unknown argument: $1";;
  esac
done

SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd)"
DEPLOYER="${SOURCE_DIR}/UCHIHA-RADIUS-v101-Backend-v37-deploy.py"
BACKEND="${SOURCE_DIR}/RADIUS-A-Connector-Backend-v37.py"
ENV_TEMPLATE="${SOURCE_DIR}/RADIUS-A-Connector-Backend-v37-production.env.template"
SYSTEMD_SOURCE="${SOURCE_DIR}/uchiha-radius-v37.service"
NGINX_SOURCE="${SOURCE_DIR}/RADIUS-A-Connector-Backend-v37-nginx.example.conf"
NGINX_LIMITS_SOURCE="${SOURCE_DIR}/RADIUS-A-Connector-Backend-v37-nginx-limits.example.conf"
SMOKE="${SOURCE_DIR}/UCHIHA-RADIUS-v101-Backend-v37-launch-smoke.py"

for f in "$DEPLOYER" "$BACKEND" "$ENV_TEMPLATE" "$SYSTEMD_SOURCE" "$SMOKE"; do
  [[ -f "$f" ]] || die "release file missing: $f"
done

command -v python3 >/dev/null || die "python3 is required"
command -v install >/dev/null || die "install is required"

if [[ "$MODE" == "apply" && "${EUID}" -ne 0 ]]; then
  die "--apply requires root"
fi

log "== Verify exact release package =="
python3 -S -B "$DEPLOYER" --source-dir "$SOURCE_DIR" --verify-only >/dev/null
log "PASS: release manifest verified"

if [[ "$MODE" == "apply" ]]; then
  if ! getent group "$SERVICE_GROUP" >/dev/null 2>&1; then
    groupadd --system "$SERVICE_GROUP"
  fi
  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    useradd --system --gid "$SERVICE_GROUP" --home-dir "$STATE_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
else
  if ! getent group "$SERVICE_GROUP" >/dev/null 2>&1; then
    log "+ groupadd --system $SERVICE_GROUP"
  fi
  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    log "+ useradd --system --gid $SERVICE_GROUP --home-dir $STATE_DIR --shell /usr/sbin/nologin $SERVICE_USER"
  fi
fi

log "== Prepare directories =="
run install -d -m 0755 "$INSTALL_ROOT" "$RELEASE_ROOT"
run install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$STATE_DIR" "$BACKUP_DIR"
run install -d -m 0750 -o root -g "$SERVICE_GROUP" "$ETC_DIR"

if [[ ! -e "$ENV_FILE" ]]; then
  log "Environment file does not exist yet: $ENV_FILE"
  if [[ "$MODE" == "apply" ]]; then
    install -m 0600 -o root -g root "$ENV_TEMPLATE" "$ENV_FILE"
    log "Created template at $ENV_FILE"
  else
    log "+ install -m 0600 $ENV_TEMPLATE $ENV_FILE"
  fi
  if [[ "$PREPARE_ONLY" -eq 0 ]]; then
    die "fill the new environment file, then rerun the bootstrap"
  fi
fi

if [[ "$PREPARE_ONLY" -eq 1 ]]; then
  log "PREPARED: directories/user/environment template are ready."
  log "No service was deployed or started."
  exit 0
fi

[[ -f "$ENV_FILE" ]] || die "environment file missing: $ENV_FILE"
if grep -q 'CHANGE_ME' "$ENV_FILE"; then
  die "environment file still contains CHANGE_ME placeholders"
fi

# Read a single environment variable without printing its value.
env_value() {
  local key="$1"
  python3 - "$ENV_FILE" "$key" <<'PY'
import sys
from pathlib import Path
path=Path(sys.argv[1]); key=sys.argv[2]
for raw in path.read_text(encoding="utf-8").splitlines():
    line=raw.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k,v=line.split("=",1)
    if k.strip()==key:
        print(v.strip().strip("'").strip('"'))
        raise SystemExit(0)
raise SystemExit(1)
PY
}

BOOTSTRAP_PASSWORD_FILE="$(env_value UCHIHA_BOOTSTRAP_OWNER_PASSWORD_FILE || true)"
if [[ -n "$BOOTSTRAP_PASSWORD_FILE" && ! -f "$BOOTSTRAP_PASSWORD_FILE" ]]; then
  die "bootstrap owner password file is missing: $BOOTSTRAP_PASSWORD_FILE"
fi
if [[ -n "$BOOTSTRAP_PASSWORD_FILE" ]]; then
  MODE_BITS="$(stat -c '%a' "$BOOTSTRAP_PASSWORD_FILE")"
  [[ "$MODE_BITS" == "600" || "$MODE_BITS" == "400" ]] || die "bootstrap password file must be mode 600 or 400"
  [[ -s "$BOOTSTRAP_PASSWORD_FILE" ]] || die "bootstrap password file is empty"
fi

log "== Host preflight (no external network calls) =="
if [[ "$MODE" == "dry-run" ]]; then
  log "+ set -a; . $ENV_FILE; set +a; python3 -S -B $BACKEND --check-host"
else
  (
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    python3 -S -B "$BACKEND" --check-host
  ) >/dev/null
  log "PASS: host preflight"
fi

log "== Full startup configuration self-check =="
if [[ "$MODE" == "dry-run" ]]; then
  log "+ set -a; . $ENV_FILE; set +a; python3 -S -B $BACKEND --check-config"
else
  (
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    python3 -S -B "$BACKEND" --check-config
  ) >/dev/null
  log "PASS: config self-check"
fi

log "== Stage exact versioned release =="
run python3 -S -B "$DEPLOYER" \
  --source-dir "$SOURCE_DIR" \
  --release-root "$RELEASE_ROOT" \
  --current-link "$CURRENT_LINK" \
  --env-file "$ENV_FILE" \
  --skip-systemctl --skip-smoke

log "== Install systemd unit =="
run install -m 0644 "$SYSTEMD_SOURCE" "/etc/systemd/system/${SERVICE_NAME}.service"
run systemctl daemon-reload
run systemctl enable "$SERVICE_NAME"

if [[ "$SKIP_NGINX" -eq 0 ]]; then
  [[ -n "$DOMAIN" ]] || die "--domain is required unless --skip-nginx is used"
  command -v nginx >/dev/null || die "nginx is required unless --skip-nginx is used"
  [[ -f "$NGINX_SOURCE" && -f "$NGINX_LIMITS_SOURCE" ]] || die "Nginx release files are missing"

  CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
  KEY="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
  if [[ "$MODE" == "apply" && (! -f "$CERT" || ! -f "$KEY") ]]; then
    die "TLS certificate/key not found for $DOMAIN; provision TLS first or rerun with --skip-nginx"
  fi

  TMP_SERVER="$(mktemp)"
  trap 'rm -f "$TMP_SERVER"' EXIT
  sed "s/radius\\.example\\.com/${DOMAIN//\//\\/}/g" "$NGINX_SOURCE" > "$TMP_SERVER"

  run install -m 0644 "$NGINX_LIMITS_SOURCE" /etc/nginx/conf.d/uchiha-radius-limits.conf
  run install -m 0644 "$TMP_SERVER" /etc/nginx/conf.d/uchiha-radius.conf

  if [[ "$MODE" == "dry-run" ]]; then
    log "+ nginx -t"
    log "+ systemctl reload nginx"
  else
    nginx -t
    systemctl reload nginx
    log "PASS: Nginx configuration"
  fi
fi

if [[ "$SKIP_START" -eq 1 ]]; then
  log "INSTALLED: release staged; service start was explicitly skipped."
  exit 0
fi

log "== Start service =="
run systemctl restart "$SERVICE_NAME"

if [[ "$MODE" == "apply" ]]; then
  systemctl is-active --quiet "$SERVICE_NAME" || die "service is not active after restart"
  log "PASS: systemd service active"
fi

if [[ -n "$PUBLIC_URL" ]]; then
  log "== Startup smoke =="
  if [[ "$MODE" == "dry-run" ]]; then
    log "+ load $ENV_FILE; python3 -S -B $SMOKE --base-url $PUBLIC_URL --startup-only"
  else
    (
      set -a
      # shellcheck disable=SC1090
      . "$ENV_FILE"
      if [[ -n "$BOOTSTRAP_PASSWORD_FILE" ]]; then
        export UCHIHA_SMOKE_OPERATOR_PASSWORD_FILE="$BOOTSTRAP_PASSWORD_FILE"
      fi
      set +a
      python3 -S -B "$SMOKE" --base-url "$PUBLIC_URL" --startup-only
    )
  fi
fi

log "DONE: VPS bootstrap completed for ${RELEASE_ID}."
log "Next: guarded checkpoint -> post-deploy verification -> final READY_TO_SERVE smoke."
