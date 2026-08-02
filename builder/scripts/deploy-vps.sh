#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export DEBIAN_FRONTEND=noninteractive

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
REPO_DIR="$ROOT_DIR/repo"
DEPLOY_KEY="${UCHIHA_DEPLOY_KEY:-/root/.ssh/uchiha_vps_ed25519}"
REPOSITORY="yaminuchiha1245-png/UCHIHA"
BRANCH="builder/v1-platform"
COMPOSE=(docker compose -f "$ROOT_DIR/compose.yml" --project-directory "$ROOT_DIR")

fail() { echo "ERROR: $*" >&2; exit 1; }
info() { printf '\n==> %s\n' "$*"; }
env_get() {
  local key="$1" file="$ROOT_DIR/.env"
  [[ -f "$file" ]] || return 0
  grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true
}
ask_required() {
  local prompt="$1" value=""
  while [[ -z "$value" ]]; do printf '%s' "$prompt" >/dev/tty; IFS= read -r value </dev/tty; done
  printf '%s' "$value"
}
ask_default() {
  local prompt="$1" default="$2" value=""
  printf '%s [%s]: ' "$prompt" "$default" >/dev/tty
  IFS= read -r value </dev/tty
  printf '%s' "${value:-$default}"
}
normalize_domain() {
  local value="${1,,}"
  value="${value#http://}"; value="${value#https://}"; value="${value%%/*}"; value="${value%.}"
  printf '%s' "$value"
}
valid_domain() { [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; }
valid_email() { [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; }

[[ ${EUID:-$(id -u)} -eq 0 ]] || fail "Run this script as root"
[[ -r /etc/os-release ]] || fail "Cannot identify the operating system"
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || fail "This installer supports Ubuntu only"
install -d -m 700 "$ROOT_DIR"
FIRST_INSTALL=0
[[ -f "$ROOT_DIR/.env" ]] || FIRST_INSTALL=1

BASE_DOMAIN="$(env_get BASE_DOMAIN)"
if [[ -z "$BASE_DOMAIN" ]]; then BASE_DOMAIN="$(ask_required 'Base domain (example.com): ')"; fi
BASE_DOMAIN="$(normalize_domain "$BASE_DOMAIN")"
valid_domain "$BASE_DOMAIN" || fail "Invalid base domain"

APP_HOST="$(env_get APP_HOST)"
if [[ -z "$APP_HOST" ]]; then APP_HOST="$(ask_default 'UCHIHA Builder public host' "$BASE_DOMAIN")"; fi
APP_HOST="$(normalize_domain "$APP_HOST")"
valid_domain "$APP_HOST" || fail "Invalid application host"

ACME_EMAIL="$(env_get ACME_EMAIL)"
if [[ -z "$ACME_EMAIL" ]]; then ACME_EMAIL="$(ask_required 'Email for HTTPS certificates: ')"; fi
valid_email "$ACME_EMAIL" || fail "Invalid HTTPS email"

ADMIN_EMAIL="$(env_get PLATFORM_ADMIN_EMAIL)"
if [[ -z "$ADMIN_EMAIL" ]]; then ADMIN_EMAIL="$(ask_default 'Platform administrator email' "$ACME_EMAIL")"; fi
valid_email "$ADMIN_EMAIL" || fail "Invalid administrator email"
ADMIN_PASSWORD="$(env_get PLATFORM_ADMIN_PASSWORD)"
GENERATED_ADMIN_PASSWORD=0
if [[ "$FIRST_INSTALL" -eq 1 && -z "$ADMIN_PASSWORD" ]]; then
  ADMIN_PASSWORD="$(openssl rand -base64 30 | tr -d '\n' | tr '/+' 'AZ')"
  GENERATED_ADMIN_PASSWORD=1
fi

CURRENCY="$(env_get UCHIHA_FULL_CURRENCY)"; CURRENCY="${CURRENCY:-USD}"
PRICE_MINOR="$(env_get UCHIHA_FULL_PRICE_MINOR)"; PRICE_MINOR="${PRICE_MINOR:-0}"
RENEWAL_PRICE_MINOR="$(env_get UCHIHA_FULL_RENEWAL_PRICE_MINOR)"; RENEWAL_PRICE_MINOR="${RENEWAL_PRICE_MINOR:-$PRICE_MINOR}"
DURATION_COUNT="$(env_get UCHIHA_FULL_DURATION_COUNT)"; DURATION_COUNT="${DURATION_COUNT:-1}"
TRIAL_DAYS="$(env_get UCHIHA_FULL_TRIAL_DAYS)"; TRIAL_DAYS="${TRIAL_DAYS:-0}"
POSTGRES_PASSWORD="$(env_get POSTGRES_PASSWORD)"; [[ -n "$POSTGRES_PASSWORD" ]] || POSTGRES_PASSWORD="$(openssl rand -hex 24)"
APP_ENCRYPTION_KEY="$(env_get APP_ENCRYPTION_KEY)"; [[ -n "$APP_ENCRYPTION_KEY" ]] || APP_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"

info "Installing required packages without depending on an SSH server"
apt-get update
apt-get install -y ca-certificates curl gnupg git jq openssl dnsutils ufw fail2ban unattended-upgrades openssh-client util-linux
if ! command -v gh >/dev/null 2>&1; then
  type -p wget >/dev/null 2>&1 || apt-get install -y wget
  mkdir -p -m 755 /etc/apt/keyrings
  wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" >/etc/apt/sources.list.d/github-cli.list
  apt-get update
  apt-get install -y gh
fi

SSH_PORT=22
if command -v sshd >/dev/null 2>&1; then
  DETECTED_SSH_PORT="$(sshd -T 2>/dev/null | awk '$1=="port"{print $2; exit}' || true)"
  SSH_PORT="${DETECTED_SSH_PORT:-22}"
elif [[ -n "${SSH_CONNECTION:-}" ]]; then
  SSH_PORT="$(awk '{print $4}' <<<"$SSH_CONNECTION")"
  SSH_PORT="${SSH_PORT:-22}"
fi
ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
if command -v sshd >/dev/null 2>&1; then
  cat >/etc/fail2ban/jail.d/uchiha-sshd.local <<EOF
[sshd]
enabled = true
port = $SSH_PORT
maxretry = 5
findtime = 10m
bantime = 1h
EOF
  systemctl enable --now fail2ban >/dev/null 2>&1 || true
else
  echo "sshd is not installed; deployment continues and no SSH jail is created."
fi

info "Installing Docker Engine and Compose"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
fi
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker compose version >/dev/null

info "Inspecting services that own ports 80 and 443"
ss -ltnp 2>/dev/null | awk 'NR==1 || $4 ~ /:80$|:443$/' || true
for service in nginx apache2 caddy; do
  if systemctl is-active --quiet "$service" 2>/dev/null; then
    echo "Stopping old host service: $service"
    systemctl disable --now "$service"
  fi
done
while read -r container_id container_name; do
  [[ -n "$container_id" ]] || continue
  [[ "$container_name" == "uchiha-caddy" ]] && continue
  if [[ "$container_name" =~ (caddy|nginx|apache|traefik) ]]; then
    echo "Stopping old reverse-proxy container: $container_name"
    docker stop "$container_id"
  else
    fail "Container $container_name is using port 80 or 443. Stop it manually before deployment."
  fi
done < <(docker ps --format '{{.ID}} {{.Names}} {{.Ports}}' | awk '$0 ~ /0\.0\.0\.0:80->|0\.0\.0\.0:443->|:::80->|:::443->/ {print $1, $2}')

info "Checking out only $BRANCH"
install -d -m 700 /root/.ssh
touch /root/.ssh/known_hosts
chmod 600 /root/.ssh/known_hosts
ssh-keyscan -H github.com 2>/dev/null | sort -u >>/root/.ssh/known_hosts
sort -u /root/.ssh/known_hosts -o /root/.ssh/known_hosts
if [[ ! -s "$DEPLOY_KEY" ]]; then
  ssh-keygen -t ed25519 -N '' -f "$DEPLOY_KEY" -C "uchiha-vps@$APP_HOST" >/dev/null
  if ! gh auth status --hostname github.com >/dev/null 2>&1; then
    echo "Authenticate GitHub once to register the read-only deploy key."
    gh auth login --hostname github.com --git-protocol https --web </dev/tty >/dev/tty
  fi
  gh repo deploy-key add "$DEPLOY_KEY.pub" --repo "$REPOSITORY" --title "UCHIHA VPS $APP_HOST" >/dev/tty
fi
chmod 600 "$DEPLOY_KEY"; chmod 644 "$DEPLOY_KEY.pub"
GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
export GIT_SSH_COMMAND
if [[ ! -d "$REPO_DIR/.git" ]]; then
  rm -rf "$REPO_DIR"
  git clone --single-branch --branch "$BRANCH" "git@github.com:$REPOSITORY.git" "$REPO_DIR"
else
  git -C "$REPO_DIR" config core.sshCommand "$GIT_SSH_COMMAND"
  git -C "$REPO_DIR" fetch --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
  git -C "$REPO_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
  git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
fi
[[ "$(git -C "$REPO_DIR" branch --show-current)" == "$BRANCH" ]] || fail "Branch safety check failed"
[[ -f "$REPO_DIR/builder/package.json" ]] || fail "builder/package.json is missing"
CURRENT_COMMIT="$(git -C "$REPO_DIR" rev-parse HEAD)"

cat >"$ROOT_DIR/.env" <<EOF
BASE_DOMAIN=$BASE_DOMAIN
APP_HOST=$APP_HOST
ACME_EMAIL=$ACME_EMAIL
NODE_ENV=production
HOST=0.0.0.0
PORT=4100
PREVIEW_MEMORY_MODE=false
REQUIRE_PERSISTENT_DATABASE=true
DATABASE_MODE=postgres
POSTGRES_DB=uchiha_builder
POSTGRES_USER=uchiha
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
DATABASE_URL=postgresql://uchiha:$POSTGRES_PASSWORD@postgres:5432/uchiha_builder
DATABASE_SSL=false
DATABASE_POOL_MAX=10
DATABASE_IDLE_TIMEOUT_MS=30000
DATABASE_CONNECTION_TIMEOUT_MS=10000
DATABASE_STATEMENT_TIMEOUT_MS=30000
APP_BASE_URL=https://$APP_HOST
STORE_BASE_DOMAIN=$BASE_DOMAIN
COOKIE_SECURE=true
APP_ENCRYPTION_KEY=$APP_ENCRYPTION_KEY
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
AUTH_RATE_LIMIT_MAX=12
PURCHASE_RATE_LIMIT_MAX=30
WEBHOOK_RATE_LIMIT_MAX=120
WORKER_LEASE_SECONDS=600
ALLOW_DEMO_BILLING=false
DEMO_SEED=false
TELEGRAM_MODE=live
UCHIHA_API_1_MODE=test
UCHIHA_API_1_ADAPTER=mock
UCHIHA_API_1_TOKEN=
UCHIHA_API_1_BASE_URL=
UCHIHA_FULL_NAME="UCHIHA Full"
UCHIHA_FULL_PRICE_MINOR=$PRICE_MINOR
UCHIHA_FULL_RENEWAL_PRICE_MINOR=$RENEWAL_PRICE_MINOR
UCHIHA_FULL_CURRENCY=$CURRENCY
UCHIHA_FULL_DURATION_UNIT=month
UCHIHA_FULL_DURATION_COUNT=$DURATION_COUNT
UCHIHA_FULL_TRIAL_DAYS=$TRIAL_DAYS
PLATFORM_ADMIN_EMAIL=$ADMIN_EMAIL
PLATFORM_ADMIN_PASSWORD=$ADMIN_PASSWORD
EOF
chmod 600 "$ROOT_DIR/.env"

info "Rendering production runtime and building the image"
bash "$REPO_DIR/builder/scripts/render-vps-runtime.sh"
"${COMPOSE[@]}" config --quiet
docker build --pull -t uchiha-builder:production "$REPO_DIR/builder"
"${COMPOSE[@]}" up -d postgres
for _ in $(seq 1 60); do
  [[ "$(docker inspect -f '{{.State.Health.Status}}' uchiha-postgres 2>/dev/null || true)" == "healthy" ]] && break
  sleep 2
done
[[ "$(docker inspect -f '{{.State.Health.Status}}' uchiha-postgres 2>/dev/null || true)" == "healthy" ]] || fail "PostgreSQL did not become healthy"

info "Applying migrations twice and ensuring the administrator"
"${COMPOSE[@]}" run --rm api npm run bootstrap
"${COMPOSE[@]}" run --rm api npm run bootstrap
if [[ -n "$ADMIN_PASSWORD" ]]; then
  "${COMPOSE[@]}" run --rm api npm run admin:ensure
  if [[ "$GENERATED_ADMIN_PASSWORD" -eq 1 ]]; then
    cat >"/root/UCHIHA-CREDENTIALS.txt" <<EOF
UCHIHA Builder URL: https://$APP_HOST
Platform admin email: $ADMIN_EMAIL
Platform admin password: $ADMIN_PASSWORD
Created at: $(date -Is)
EOF
    chmod 600 /root/UCHIHA-CREDENTIALS.txt
  fi
  sed -i 's/^PLATFORM_ADMIN_PASSWORD=.*/PLATFORM_ADMIN_PASSWORD=/' "$ROOT_DIR/.env"
fi

info "Starting API, worker, TLS authorization, and recreating Caddy"
"${COMPOSE[@]}" up -d --force-recreate --remove-orphans api worker tls-ask caddy
for _ in $(seq 1 60); do
  [[ "$(docker inspect -f '{{.State.Health.Status}}' uchiha-api 2>/dev/null || true)" == "healthy" ]] && break
  sleep 2
done
if [[ "$(docker inspect -f '{{.State.Health.Status}}' uchiha-api 2>/dev/null || true)" != "healthy" ]]; then
  "${COMPOSE[@]}" logs --tail=180 api postgres worker caddy >&2 || true
  fail "API did not become healthy"
fi
"${COMPOSE[@]}" exec -T api npm run verify:production
"${COMPOSE[@]}" exec -T api node -e "fetch('http://127.0.0.1:4100/ready').then(async r=>{console.log(await r.text());if(!r.ok)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})"

info "Installing and testing daily PostgreSQL backups"
install -d -m 700 /var/backups/uchiha
install -m 700 "$REPO_DIR/builder/scripts/backup-postgres.sh" /usr/local/sbin/uchiha-backup
install -m 700 "$REPO_DIR/builder/scripts/restore-test.sh" /usr/local/sbin/uchiha-restore-test
cat >/etc/systemd/system/uchiha-backup.service <<'SERVICE'
[Unit]
Description=UCHIHA PostgreSQL verified backup
Requires=docker.service
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/uchiha-backup
Nice=10
SERVICE
cat >/etc/systemd/system/uchiha-backup.timer <<'TIMER'
[Unit]
Description=Daily UCHIHA PostgreSQL backup
[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true
RandomizedDelaySec=900
[Install]
WantedBy=timers.target
TIMER
systemctl daemon-reload
systemctl enable --now uchiha-backup.timer
BACKUP_FILE="$(/usr/local/sbin/uchiha-backup)"
/usr/local/sbin/uchiha-restore-test "$BACKUP_FILE"

info "Running complete production smoke test"
bash "$REPO_DIR/builder/scripts/smoke-vps.sh"
printf '%s\n' "$CURRENT_COMMIT" >"$ROOT_DIR/current-release"
chmod 600 "$ROOT_DIR/current-release"
"${COMPOSE[@]}" ps
printf '\nDeployment completed from %s at commit %s\n' "$BRANCH" "$CURRENT_COMMIT"
printf 'Application: https://%s\nDemo: https://%s/store/demo\nDemo subdomain: https://demo.%s\n' "$APP_HOST" "$APP_HOST" "$BASE_DOMAIN"
printf 'Backups: /var/backups/uchiha\n'
[[ -f /root/UCHIHA-CREDENTIALS.txt ]] && printf 'Administrator credentials: /root/UCHIHA-CREDENTIALS.txt\n'
