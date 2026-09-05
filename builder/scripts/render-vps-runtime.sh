#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
REPO_DIR="${UCHIHA_REPO_DIR:-$ROOT_DIR/repo}"
ENV_FILE="$ROOT_DIR/.env"
RELEASE_ENV_FILE="$ROOT_DIR/release.env"
AUTODEPLOY_SOURCE="$REPO_DIR/builder/scripts/vps-autodeploy.sh"
[[ -r "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }
[[ -d "$REPO_DIR/.git" ]] || { echo "Missing repository at $REPO_DIR" >&2; exit 1; }

env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
APP_HOST="$(env_value APP_HOST)"
BASE_DOMAIN="$(env_value BASE_DOMAIN)"
RELEASE_SHA="$(git -C "$REPO_DIR" rev-parse HEAD)"
[[ -n "$APP_HOST" && -n "$BASE_DOMAIN" ]] || { echo "APP_HOST and BASE_DOMAIN are required" >&2; exit 1; }
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Unable to resolve a valid UCHIHA release SHA" >&2; exit 1; }

# Self-heal the systemd timer wrapper as soon as a new target commit reaches the
# VPS. Keeping this outside the final success-only section means a later build
# or smoke failure cannot trap the host on an updater that predates the fix.
if [[ ${EUID:-$(id -u)} -eq 0 && -f "$AUTODEPLOY_SOURCE" ]]; then
  install -m 700 "$AUTODEPLOY_SOURCE" /usr/local/sbin/uchiha-autodeploy
fi

printf 'UCHIHA_RELEASE_SHA=%s\n' "$RELEASE_SHA" >"$RELEASE_ENV_FILE"
chmod 600 "$RELEASE_ENV_FILE"

cat >"$ROOT_DIR/tls-ask.mjs" <<'TLSASK'
import http from "node:http";
import pg from "pg";

const appHost = String(process.env.APP_HOST || "").toLowerCase();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 3000 });
const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://tls-ask");
  if (request.method !== "GET" || url.pathname !== "/allow") return response.writeHead(404).end();
  const domain = String(url.searchParams.get("domain") || "").toLowerCase().replace(/\.$/, "");
  if (!hostnamePattern.test(domain)) return response.writeHead(403).end();
  if (domain === appHost) return response.writeHead(204).end();
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
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
  server.close();
  await pool.end();
  process.exit(0);
});
TLSASK

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

  @storeRoot {
    header_regexp storefront Host ^(?P<slug>[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.{$BASE_DOMAIN}$
    path /
  }
  redir @storeRoot /store/{re.storefront.slug} 302

  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    -Server
  }
  reverse_proxy api:4100
}
CADDYFILE

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
    security_opt: ["no-new-privileges:true"]
    shm_size: 256mb

  # Production application services are deliberately pinned to the exact local
  # image that update-vps.sh builds, verifies and retags during rollback. A stale
  # UCHIHA_IMAGE value in the host .env must never override the verified release.
  api:
    image: uchiha-builder:production
    container_name: uchiha-api
    restart: unless-stopped
    env_file:
      - .env
      - release.env
    depends_on:
      postgres:
        condition: service_healthy
    expose: ["4100"]
    networks: [backend, edge]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4100/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 20s
    security_opt: ["no-new-privileges:true"]

  worker:
    image: uchiha-builder:production
    container_name: uchiha-worker
    restart: unless-stopped
    command: ["node", "src/worker-runner.mjs"]
    env_file:
      - .env
      - release.env
    depends_on:
      postgres:
        condition: service_healthy
    networks: [backend]
    security_opt: ["no-new-privileges:true"]

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
    expose: ["3000"]
    networks: [backend, edge]
    security_opt: ["no-new-privileges:true"]

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
    security_opt: ["no-new-privileges:true"]

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
chmod 644 "$ROOT_DIR/Caddyfile" "$ROOT_DIR/tls-ask.mjs"
