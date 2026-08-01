#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export DEBIAN_FRONTEND=noninteractive

ROOT_DIR="/opt/uchiha-builder"
REPO_DIR="$ROOT_DIR/repo"
DEPLOY_KEY="/root/.ssh/uchiha_vps_ed25519"
REPOSITORY="yaminuchiha1245-png/UCHIHA"
BRANCH="builder/v1-platform"
COMPOSE="docker compose -f $ROOT_DIR/compose.yml --project-directory $ROOT_DIR"

fail() { echo "❌ $*" >&2; exit 1; }
info() { echo; echo "▶ $*"; }
ask_required() {
  local message="$1" value=""
  while [[ -z "$value" ]]; do
    printf '%s' "$message" >/dev/tty
    IFS= read -r value </dev/tty
  done
  printf '%s' "$value"
}
ask_default() {
  local message="$1" default="$2" value=""
  printf '%s [%s]: ' "$message" "$default" >/dev/tty
  IFS= read -r value </dev/tty
  printf '%s' "${value:-$default}"
}
env_get() {
  local key="$1" file="$ROOT_DIR/.env"
  [[ -f "$file" ]] || return 0
  grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true
}
normalize_domain() {
  local value="${1,,}"
  value="${value#http://}"
  value="${value#https://}"
  value="${value%%/*}"
  value="${value%.}"
  printf '%s' "$value"
}
valid_domain() {
  [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]
}
valid_email() {
  [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]
}

[[ ${EUID:-$(id -u)} -eq 0 ]] || fail "شغّل السكربت كمستخدم root."
[[ -r /etc/os-release ]] || fail "تعذر تحديد نظام التشغيل."
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || fail "هذا السكربت مخصص لـ Ubuntu."

mkdir -p "$ROOT_DIR"
FIRST_INSTALL=0
[[ -f "$ROOT_DIR/.env" ]] || FIRST_INSTALL=1

OLD_BASE_DOMAIN="$(env_get BASE_DOMAIN)"
if [[ -n "$OLD_BASE_DOMAIN" ]]; then
  BASE_DOMAIN="$(ask_default "اكتب الدومين الأساسي الذي تملكه" "$OLD_BASE_DOMAIN")"
else
  BASE_DOMAIN="$(ask_required "اكتب الدومين الأساسي الذي تملكه، مثال yourdomain.com: ")"
fi
BASE_DOMAIN="$(normalize_domain "$BASE_DOMAIN")"
valid_domain "$BASE_DOMAIN" || fail "صيغة الدومين غير صحيحة."

OLD_APP_HOST="$(env_get APP_HOST)"
DEFAULT_APP_HOST="${OLD_APP_HOST:-builder.$BASE_DOMAIN}"
APP_HOST="$(ask_default "اكتب دومين منصة UCHIHA Builder" "$DEFAULT_APP_HOST")"
APP_HOST="$(normalize_domain "$APP_HOST")"
valid_domain "$APP_HOST" || fail "صيغة دومين المنصة غير صحيحة."

OLD_ACME_EMAIL="$(env_get ACME_EMAIL)"
if [[ -n "$OLD_ACME_EMAIL" ]]; then
  ACME_EMAIL="$(ask_default "اكتب بريدك لإصدار شهادة HTTPS" "$OLD_ACME_EMAIL")"
else
  ACME_EMAIL="$(ask_required "اكتب بريدك الحقيقي لإصدار شهادة HTTPS: ")"
fi
valid_email "$ACME_EMAIL" || fail "صيغة بريد HTTPS غير صحيحة."

OLD_ADMIN_EMAIL="$(env_get PLATFORM_ADMIN_EMAIL)"
ADMIN_EMAIL="$(ask_default "اكتب بريد مدير منصة UCHIHA" "${OLD_ADMIN_EMAIL:-$ACME_EMAIL}")"
valid_email "$ADMIN_EMAIL" || fail "صيغة بريد المدير غير صحيحة."

if [[ "$FIRST_INSTALL" -eq 1 ]]; then
  CURRENCY="$(ask_default "عملة الاشتراك من 3 أحرف" "USD")"
  CURRENCY="${CURRENCY^^}"
  [[ "$CURRENCY" =~ ^[A-Z]{3}$ ]] || fail "العملة يجب أن تكون 3 أحرف مثل USD."
  PRICE_MINOR="$(ask_required "اكتب سعر الاشتراك بأصغر وحدة (مثال 1000 = 10.00 USD): ")"
  [[ "$PRICE_MINOR" =~ ^[0-9]+$ ]] || fail "السعر يجب أن يكون رقمًا صحيحًا."
  RENEWAL_PRICE_MINOR="$(ask_default "سعر التجديد بأصغر وحدة" "$PRICE_MINOR")"
  [[ "$RENEWAL_PRICE_MINOR" =~ ^[0-9]+$ ]] || fail "سعر التجديد يجب أن يكون رقمًا صحيحًا."
  DURATION_COUNT="$(ask_default "مدة الاشتراك بالأشهر" "1")"
  [[ "$DURATION_COUNT" =~ ^[1-9][0-9]*$ ]] || fail "مدة الاشتراك غير صحيحة."
  TRIAL_DAYS="$(ask_default "عدد أيام التجربة" "0")"
  [[ "$TRIAL_DAYS" =~ ^[0-9]+$ ]] || fail "عدد أيام التجربة غير صحيح."
  ADMIN_PASSWORD="$(openssl rand -hex 18)"
else
  CURRENCY="$(env_get UCHIHA_FULL_CURRENCY)"; CURRENCY="${CURRENCY:-USD}"
  PRICE_MINOR="$(env_get UCHIHA_FULL_PRICE_MINOR)"; PRICE_MINOR="${PRICE_MINOR:-0}"
  RENEWAL_PRICE_MINOR="$(env_get UCHIHA_FULL_RENEWAL_PRICE_MINOR)"; RENEWAL_PRICE_MINOR="${RENEWAL_PRICE_MINOR:-$PRICE_MINOR}"
  DURATION_COUNT="$(env_get UCHIHA_FULL_DURATION_COUNT)"; DURATION_COUNT="${DURATION_COUNT:-1}"
  TRIAL_DAYS="$(env_get UCHIHA_FULL_TRIAL_DAYS)"; TRIAL_DAYS="${TRIAL_DAYS:-0}"
  ADMIN_PASSWORD="$(env_get PLATFORM_ADMIN_PASSWORD)"
fi

PUBLIC_IP="$(curl -4fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
[[ -n "$PUBLIC_IP" ]] || PUBLIC_IP="$(hostname -I | awk '{print $1}')"
[[ -n "$PUBLIC_IP" ]] || fail "تعذر اكتشاف IP العام."

echo
printf 'سيتم تجهيز:\n- الخادم: %s\n- المنصة: https://%s\n- المتاجر: *.%s\n- الفرع: %s\n' "$PUBLIC_IP" "$APP_HOST" "$BASE_DOMAIN" "$BRANCH"
printf 'اضغط Enter للبدء أو Ctrl+C للإلغاء...' >/dev/tty
IFS= read -r _ </dev/tty

info "تحديث Ubuntu وتثبيت أدوات الحماية"
apt-get update
apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg git jq openssl dnsutils ufw fail2ban unattended-upgrades gh

cat >/etc/apt/apt.conf.d/20auto-upgrades <<'AUTOUPDATES'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
AUTOUPDATES
systemctl enable --now unattended-upgrades.service >/dev/null 2>&1 || true

SSH_PORT="$(sshd -T 2>/dev/null | awk '$1=="port"{print $2; exit}')"
SSH_PORT="${SSH_PORT:-22}"
ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

cat >/etc/fail2ban/jail.d/uchiha-sshd.local <<EOF
[sshd]
enabled = true
port = $SSH_PORT
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban

if ! swapon --show --noheadings | grep -q .; then
  MEM_MB="$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)"
  if (( MEM_MB < 8192 )); then
    info "إضافة Swap آمن بحجم 2GB"
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  fi
fi

info "تثبيت Docker الرسمي وDocker Compose"
if ! dpkg -s docker-ce >/dev/null 2>&1; then
  apt-get remove -y docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc >/dev/null 2>&1 || true
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

if [[ ! -f /etc/docker/daemon.json ]]; then
  cat >/etc/docker/daemon.json <<'DOCKER_DAEMON'
{
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": {"max-size": "10m", "max-file": "5"}
}
DOCKER_DAEMON
  systemctl restart docker
fi

docker compose version >/dev/null

info "ربط VPS بالمستودع الخاص باستخدام Deploy Key للقراءة فقط"
install -d -m 700 /root/.ssh
touch /root/.ssh/known_hosts
chmod 600 /root/.ssh/known_hosts
ssh-keyscan -H github.com 2>/dev/null | sort -u >>/root/.ssh/known_hosts
sort -u /root/.ssh/known_hosts -o /root/.ssh/known_hosts

if [[ ! -s "$DEPLOY_KEY" ]]; then
  ssh-keygen -t ed25519 -N '' -f "$DEPLOY_KEY" -C "uchiha-vps@$PUBLIC_IP" >/dev/null
  if ! gh auth status --hostname github.com >/dev/null 2>&1; then
    echo
    echo "سيظهر الآن كود GitHub لمرة واحدة. افتح الرابط، أدخل الكود، ثم وافق على الدخول."
    gh auth login --hostname github.com --git-protocol https --web </dev/tty >/dev/tty 2>&1
  fi
  gh repo deploy-key add "$DEPLOY_KEY.pub" --repo "$REPOSITORY" --title "UCHIHA VPS $PUBLIC_IP" >/dev/tty
  printf 'y\n' | gh auth logout --hostname github.com >/dev/null 2>&1 || true
fi
chmod 600 "$DEPLOY_KEY"
chmod 644 "$DEPLOY_KEY.pub"
GIT_SSH="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  rm -rf "$REPO_DIR"
  GIT_SSH_COMMAND="$GIT_SSH" git clone --single-branch --branch "$BRANCH" "git@github.com:$REPOSITORY.git" "$REPO_DIR"
else
  git -C "$REPO_DIR" config core.sshCommand "$GIT_SSH"
  git -C "$REPO_DIR" fetch origin "$BRANCH"
  git -C "$REPO_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
fi
git -C "$REPO_DIR" config core.sshCommand "$GIT_SSH"
CURRENT_COMMIT="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
[[ -f "$REPO_DIR/builder/package.json" ]] || fail "مجلد builder غير موجود في الفرع المطلوب."

POSTGRES_PASSWORD="$(env_get POSTGRES_PASSWORD)"
[[ -n "$POSTGRES_PASSWORD" ]] || POSTGRES_PASSWORD="$(openssl rand -hex 24)"
APP_ENCRYPTION_KEY="$(env_get APP_ENCRYPTION_KEY)"
[[ -n "$APP_ENCRYPTION_KEY" ]] || APP_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"

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

cat >"$ROOT_DIR/tls-ask.mjs" <<'TLS_ASK'
import http from "node:http";
import pg from "pg";

const appHost = String(process.env.APP_HOST || "").toLowerCase();
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 10000
});
const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://tls-ask");
  if (request.method !== "GET" || url.pathname !== "/allow") {
    response.writeHead(404).end();
    return;
  }
  const domain = String(url.searchParams.get("domain") || "").toLowerCase().replace(/\.$/, "");
  if (!hostnamePattern.test(domain)) {
    response.writeHead(403).end();
    return;
  }
  if (domain === appHost) {
    response.writeHead(204).end();
    return;
  }
  try {
    const result = await pool.query(
      "SELECT 1 FROM domains WHERE lower(hostname)=lower($1) AND status IN ('verified','active') LIMIT 1",
      [domain]
    );
    response.writeHead(result.rowCount ? 204 : 403).end();
  } catch (error) {
    console.error("TLS authorization lookup failed", error.message);
    response.writeHead(503).end();
  }
});

server.listen(3000, "0.0.0.0", () => console.log("TLS authorization service is ready"));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    server.close();
    await pool.end();
    process.exit(0);
  });
}
TLS_ASK
chmod 644 "$ROOT_DIR/tls-ask.mjs"

cat >"$ROOT_DIR/Caddyfile" <<'CADDYFILE'
{
  email {$ACME_EMAIL}
  admin off
  on_demand_tls {
    ask http://tls-ask:3000/allow
  }
}

https:// {
  tls {
    on_demand
  }
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    -Server
  }
  reverse_proxy api:4100
}
CADDYFILE
chmod 644 "$ROOT_DIR/Caddyfile"

cat >"$ROOT_DIR/compose.yml" <<'COMPOSE'
name: uchiha

services:
  postgres:
    image: postgres:16-alpine
    container_name: uchiha-postgres
    restart: unless-stopped
    env_file: .env
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_INITDB_ARGS: --data-checksums
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks: [backend]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 30
    security_opt:
      - no-new-privileges:true
    shm_size: 256mb

  api:
    image: uchiha-builder:production
    build:
      context: ./repo/builder
      dockerfile: Dockerfile
    container_name: uchiha-api
    restart: unless-stopped
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    expose:
      - "4100"
    networks: [backend, edge]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4100/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 20s
    security_opt:
      - no-new-privileges:true

  worker:
    image: uchiha-builder:production
    container_name: uchiha-worker
    restart: unless-stopped
    command: ["node", "src/worker-runner.mjs"]
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    networks: [backend, edge]
    security_opt:
      - no-new-privileges:true

  tls-ask:
    image: uchiha-builder:production
    container_name: uchiha-tls-ask
    restart: unless-stopped
    command: ["node", "/app/tls-ask.mjs"]
    env_file: .env
    volumes:
      - ./tls-ask.mjs:/app/tls-ask.mjs:ro
    depends_on:
      postgres:
        condition: service_healthy
    expose:
      - "3000"
    networks: [backend, edge]
    security_opt:
      - no-new-privileges:true

  caddy:
    image: caddy:2-alpine
    container_name: uchiha-caddy
    restart: unless-stopped
    env_file: .env
    depends_on:
      api:
        condition: service_healthy
      tls-ask:
        condition: service_started
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks: [edge]
    security_opt:
      - no-new-privileges:true

volumes:
  postgres_data:
    name: uchiha_postgres_data
  caddy_data:
    name: uchiha_caddy_data
  caddy_config:
    name: uchiha_caddy_config

networks:
  backend:
    name: uchiha_backend
    internal: true
  edge:
    name: uchiha_edge
COMPOSE
chmod 600 "$ROOT_DIR/compose.yml"

info "فحص إعداد Docker وبناء UCHIHA Builder"
cd "$ROOT_DIR"
$COMPOSE config --quiet
$COMPOSE build --pull api
$COMPOSE up -d postgres

for _ in $(seq 1 60); do
  STATUS="$(docker inspect -f '{{.State.Health.Status}}' uchiha-postgres 2>/dev/null || true)"
  [[ "$STATUS" == "healthy" ]] && break
  sleep 2
done
[[ "$(docker inspect -f '{{.State.Health.Status}}' uchiha-postgres 2>/dev/null || true)" == "healthy" ]] || fail "PostgreSQL لم تصبح جاهزة."

info "تشغيل Migrations وإنشاء مدير المنصة"
$COMPOSE run --rm api npm run bootstrap

if [[ -n "$ADMIN_PASSWORD" ]]; then
  cat >"/root/UCHIHA-CREDENTIALS.txt" <<EOF
UCHIHA Builder URL: https://$APP_HOST
Platform admin email: $ADMIN_EMAIL
Platform admin password: $ADMIN_PASSWORD
Created at: $(date -Is)
EOF
  chmod 600 /root/UCHIHA-CREDENTIALS.txt
  sed -i 's/^PLATFORM_ADMIN_PASSWORD=.*/PLATFORM_ADMIN_PASSWORD=/' "$ROOT_DIR/.env"
fi

info "تشغيل API وWorker وHTTPS"
$COMPOSE up -d --remove-orphans

for _ in $(seq 1 60); do
  STATUS="$(docker inspect -f '{{.State.Health.Status}}' uchiha-api 2>/dev/null || true)"
  [[ "$STATUS" == "healthy" ]] && break
  sleep 2
done
[[ "$(docker inspect -f '{{.State.Health.Status}}' uchiha-api 2>/dev/null || true)" == "healthy" ]] || {
  $COMPOSE logs --tail=120 api postgres >&2
  fail "API لم تصبح جاهزة."
}

info "فحص Production Readiness"
$COMPOSE exec -T api npm run verify:production
$COMPOSE exec -T api node -e "fetch('http://127.0.0.1:4100/ready').then(async r=>{console.log(await r.text());if(!r.ok)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})"

info "إعداد نسخ احتياطي يومي لقاعدة البيانات"
install -d -m 700 /var/backups/uchiha
cat >/usr/local/sbin/uchiha-backup <<'BACKUP'
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ENV_FILE=/opt/uchiha-builder/.env
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
POSTGRES_PASSWORD="$(env_value POSTGRES_PASSWORD)"
POSTGRES_USER="$(env_value POSTGRES_USER)"
POSTGRES_DB="$(env_value POSTGRES_DB)"
BACKUP_DIR=/var/backups/uchiha
mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/uchiha-$(date -u +%Y%m%dT%H%M%SZ).dump"
TMP="$FILE.tmp"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" uchiha-postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc >"$TMP"
[[ -s "$TMP" ]]
cat "$TMP" | docker exec -i uchiha-postgres pg_restore -l >/dev/null
mv "$TMP" "$FILE"
find "$BACKUP_DIR" -type f -name 'uchiha-*.dump' -mtime +14 -delete
BACKUP
chmod 700 /usr/local/sbin/uchiha-backup

cat >/etc/systemd/system/uchiha-backup.service <<'BACKUP_SERVICE'
[Unit]
Description=UCHIHA PostgreSQL backup
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/uchiha-backup
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
BACKUP_SERVICE

cat >/etc/systemd/system/uchiha-backup.timer <<'BACKUP_TIMER'
[Unit]
Description=Daily UCHIHA PostgreSQL backup

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true
RandomizedDelaySec=900

[Install]
WantedBy=timers.target
BACKUP_TIMER
systemctl daemon-reload
systemctl enable --now uchiha-backup.timer
/usr/local/sbin/uchiha-backup

APP_DNS="$(dig +short A "$APP_HOST" | tail -n1 || true)"
WILDCARD_TEST="probe-$(openssl rand -hex 3).$BASE_DOMAIN"
WILDCARD_DNS="$(dig +short A "$WILDCARD_TEST" | tail -n1 || true)"

info "النتيجة النهائية"
$COMPOSE ps
printf '\n✅ UCHIHA Builder نُشرت من الفرع %s عند commit %s.\n' "$BRANCH" "$CURRENT_COMMIT"
printf '🌐 رابط المنصة: https://%s\n' "$APP_HOST"
printf '👤 بريد المدير: %s\n' "$ADMIN_EMAIL"
if [[ -n "$ADMIN_PASSWORD" ]]; then
  printf '🔑 كلمة مرور المدير: %s\n' "$ADMIN_PASSWORD"
fi
[[ -f /root/UCHIHA-CREDENTIALS.txt ]] && printf '🔐 بيانات الدخول محفوظة في: /root/UCHIHA-CREDENTIALS.txt\n'
printf '💾 النسخ الاحتياطية: /var/backups/uchiha\n'
printf '📦 ملفات التشغيل: %s\n' "$ROOT_DIR"

if [[ -z "$APP_DNS" || -z "$WILDCARD_DNS" ]]; then
  printf '\n⚠️ بقي ربط DNS فقط. أضف لدى شركة الدومين السجلين التاليين:\n'
  printf 'A  builder  -> %s\n' "$PUBLIC_IP"
  printf 'A  *        -> %s\n' "$PUBLIC_IP"
  printf 'ثم انتظر انتشار DNS وافتح: https://%s\n' "$APP_HOST"
else
  echo "⏳ فحص HTTPS العام..."
  for _ in $(seq 1 24); do
    if curl -fsS --max-time 15 "https://$APP_HOST/ready" >/tmp/uchiha-public-ready 2>/dev/null; then
      echo "✅ HTTPS يعمل والدومين متصل."
      cat /tmp/uchiha-public-ready
      break
    fi
    sleep 5
  done
fi

echo
echo "مهم: UCHIHA API 1 بقي في وضع test آمن. لا تحوله إلى live إلا بعد وضع بيانات المزود الحقيقية من لوحة المنصة."
