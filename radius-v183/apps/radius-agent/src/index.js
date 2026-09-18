import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { APP_VERSION } from "@uchiha-radius/contracts";
import { RouterOsCommandExecutor } from "./routeros.js";
import { normalizeAuthentication, normalizeAuthorization, normalizePostAuth, radiusAuthorizeReply, radiusReply, RadiusDirectory } from "./directory.js";

function value(payload, key, fallback = null) {
  const found = payload[key] ?? payload[key.toLowerCase()] ?? fallback;
  return Array.isArray(found) ? found[0] : found;
}

function number(payload, key, fallback = 0) {
  const result = Number(value(payload, key, fallback));
  return Number.isFinite(result) && result >= 0 ? Math.trunc(result) : fallback;
}

function byteCounter(payload, prefix) {
  return number(payload, `${prefix}-Octets`) + number(payload, `${prefix}-Gigawords`) * 4_294_967_296;
}

function statusType(input) {
  const normalized = String(input ?? "").toLowerCase().replaceAll(/[^a-z]/g, "");
  if (normalized === "start") return "start";
  if (normalized === "stop") return "stop";
  return "interim";
}

function isoDate(input, fallback = new Date().toISOString()) {
  if (!input) return fallback;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

export function normalizeAccounting(payload, now = new Date().toISOString()) {
  const sessionId = String(value(payload, "Acct-Unique-Session-Id") ?? value(payload, "Acct-Session-Id") ?? "").trim();
  const username = String(value(payload, "User-Name") ?? "").trim();
  if (!sessionId || !username) throw new Error("Acct-Session-Id and User-Name are required");
  const status = statusType(value(payload, "Acct-Status-Type"));
  const occurredAt = isoDate(value(payload, "Event-Timestamp"), now);
  const inputBytes = byteCounter(payload, "Acct-Input");
  const outputBytes = byteCounter(payload, "Acct-Output");
  const eventFingerprint = [sessionId, status, number(payload, "Acct-Session-Time"), inputBytes, outputBytes, occurredAt].join("|");
  return {
    eventId: `rae_${createHash("sha256").update(eventFingerprint).digest("hex").slice(0, 40)}`,
    nonce: randomBytes(18).toString("base64url"),
    nonceExpiresAt: new Date(new Date(now).getTime() + 5 * 60_000).toISOString(),
    statusType: status,
    sessionId,
    username,
    nasIp: value(payload, "NAS-IP-Address"),
    framedIp: value(payload, "Framed-IP-Address"),
    startedAt: status === "start" ? occurredAt : null,
    occurredAt,
    inputBytes,
    outputBytes,
    terminateCause: value(payload, "Acct-Terminate-Cause")
  };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(secret, timestamp, body) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

function readJson(request, maximumBytes = 256_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maximumBytes) {
        reject(new Error("payload too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(new Error("invalid JSON")); }
    });
    request.on("error", reject);
  });
}

function respond(response, status, body) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(encoded), "cache-control": "no-store" });
  response.end(encoded);
}

export function loadAgentConfig(env = process.env) {
  const tenantSlug = env.UCHIHA_TENANT_SLUG ?? "";
  const defaultAgentId = `${tenantSlug || "unconfigured"}:${os.hostname()}`.replaceAll(/[^A-Za-z0-9._:-]/g, "-").slice(0, 120);
  const configuredPort = Number(env.RADIUS_AGENT_PORT ?? 8790);
  const configuredPollInterval = Number(env.RADIUS_COMMAND_POLL_MS ?? 2_000);
  const configuredDirectoryInterval = Number(env.RADIUS_DIRECTORY_SYNC_MS ?? 60_000);
  const configuredHeartbeatInterval = Number(env.RADIUS_HEARTBEAT_MS ?? 15_000);
  const config = {
    host: env.RADIUS_AGENT_HOST ?? "127.0.0.1",
    port: configuredPort,
    databasePath: path.resolve(process.cwd(), env.RADIUS_AGENT_DB ?? "./data/radius-agent-spool.sqlite"),
    localSecret: env.RADIUS_AGENT_LOCAL_SECRET ?? "",
    cacheKey: env.RADIUS_AGENT_CACHE_KEY ?? "",
    apiUrl: String(env.UCHIHA_API_URL ?? "").replace(/\/$/, ""),
    tenantSlug,
    connectorSecret: env.RADIUS_AGENT_SIGNING_SECRET ?? env.CONNECTOR_SIGNING_SECRET ?? "",
    agentId: env.RADIUS_AGENT_ID ?? defaultAgentId,
    name: String(env.RADIUS_AGENT_NAME ?? os.hostname()).trim(),
    siteId: String(env.RADIUS_AGENT_SITE_ID ?? "").trim() || null,
    role: env.RADIUS_AGENT_ROLE ?? "primary",
    advertisedEndpoint: String(env.RADIUS_AGENT_ENDPOINT ?? `${env.RADIUS_AGENT_HOST ?? "127.0.0.1"}:${configuredPort}`).trim(),
    commandAdapter: env.RADIUS_COMMAND_ADAPTER ?? "disabled",
    routersFile: env.RADIUS_ROUTERS_FILE ? path.resolve(env.RADIUS_ROUTERS_FILE) : "",
    pollIntervalMs: Math.max(1_000, Math.min(30_000, configuredPollInterval)),
    directorySyncMs: Math.max(10_000, Math.min(3_600_000, configuredDirectoryInterval)),
    heartbeatMs: Math.max(5_000, Math.min(300_000, configuredHeartbeatInterval))
  };
  const missing = Object.entries({ RADIUS_AGENT_LOCAL_SECRET: config.localSecret, RADIUS_AGENT_CACHE_KEY: config.cacheKey, UCHIHA_API_URL: config.apiUrl, UCHIHA_TENANT_SLUG: config.tenantSlug, RADIUS_AGENT_SIGNING_SECRET: config.connectorSecret }).filter(([, item]) => !item || String(item).startsWith("replace-")).map(([key]) => key);
  if (missing.length) throw new Error(`Missing agent configuration: ${missing.join(", ")}`);
  if (config.localSecret.length < 24 || config.connectorSecret.length < 32) throw new Error("Agent secrets are too short");
  if (!/^[a-f0-9]{64}$/i.test(config.cacheKey)) throw new Error("RADIUS_AGENT_CACHE_KEY must be exactly 64 hexadecimal characters");
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) throw new Error("RADIUS_AGENT_PORT must be an integer between 1 and 65535");
  if (!Number.isFinite(configuredPollInterval)) throw new Error("RADIUS_COMMAND_POLL_MS must be a number");
  if (!Number.isFinite(configuredDirectoryInterval)) throw new Error("RADIUS_DIRECTORY_SYNC_MS must be a number");
  if (!Number.isFinite(configuredHeartbeatInterval)) throw new Error("RADIUS_HEARTBEAT_MS must be a number");
  if (!/^[A-Za-z0-9._:-]{3,120}$/.test(config.agentId)) throw new Error("RADIUS_AGENT_ID is invalid");
  if (config.name.length < 2 || config.name.length > 120) throw new Error("RADIUS_AGENT_NAME is invalid");
  if (!['primary', 'replica', 'standby'].includes(config.role)) throw new Error("RADIUS_AGENT_ROLE is invalid");
  if (config.advertisedEndpoint.length > 253) throw new Error("RADIUS_AGENT_ENDPOINT is invalid");
  if (!/^https:\/\//.test(config.apiUrl) && !/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(config.apiUrl)) throw new Error("UCHIHA_API_URL must use HTTPS");
  if (!["disabled", "routeros"].includes(config.commandAdapter)) throw new Error("RADIUS_COMMAND_ADAPTER must be disabled or routeros");
  if (config.commandAdapter === "routeros" && !config.routersFile) throw new Error("RADIUS_ROUTERS_FILE is required for the routeros adapter");
  return config;
}

export function loadRouters(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error("RADIUS_ROUTERS_FILE does not exist");
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("RADIUS_ROUTERS_FILE must be a regular file");
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error("RADIUS_ROUTERS_FILE permissions must be 0600 or stricter");
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const routers = Array.isArray(parsed) ? parsed : parsed.routers;
  if (!Array.isArray(routers) || !routers.length) throw new Error("RADIUS_ROUTERS_FILE must contain at least one router");
  return routers.map((router, index) => {
    const idValue = String(router.id ?? "").trim();
    const host = String(router.host ?? "").trim();
    const username = String(router.username ?? "").trim();
    const password = String(router.password ?? "");
    const port = Number(router.port ?? 8729);
    if (!/^[A-Za-z0-9._:-]{3,120}$/.test(idValue)) throw new Error(`Invalid router id at index ${index}`);
    if (!host || host.length > 253 || !username || username.length > 100 || password.length < 8) throw new Error(`Invalid RouterOS credentials at index ${index}`);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid RouterOS TLS port at index ${index}`);
    const caFile = router.caFile ? path.resolve(path.dirname(filePath), String(router.caFile)) : null;
    if (caFile && (!fs.existsSync(caFile) || !fs.statSync(caFile).isFile())) throw new Error(`Invalid RouterOS CA file at index ${index}`);
    return {
      id: idValue,
      host,
      port,
      username,
      password,
      caFile,
      serverName: router.serverName ? String(router.serverName) : null,
      nasIps: [...new Set([host, ...(Array.isArray(router.nasIps) ? router.nasIps.map(String) : [])])]
    };
  });
}

export function createSpool(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS accounting_spool (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS accounting_spool_pending ON accounting_spool(status, available_at);`);
  db.exec(`CREATE TABLE IF NOT EXISTS auth_spool (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_spool_pending ON auth_spool(status, available_at);
    CREATE TABLE IF NOT EXISTS radius_directory (
      username TEXT PRIMARY KEY,
      principal_type TEXT NOT NULL CHECK(principal_type IN ('subscriber','voucher')),
      principal_id TEXT NOT NULL,
      secret_ciphertext TEXT NOT NULL,
      credential_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      expires_at TEXT,
      attributes_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
  const recoveredAt = new Date().toISOString();
  db.prepare("UPDATE accounting_spool SET status='failed',available_at=?,last_error='recovered after agent restart',updated_at=? WHERE status='sending'")
    .run(recoveredAt, recoveredAt);
  db.prepare("UPDATE auth_spool SET status='failed',available_at=?,last_error='recovered after agent restart',updated_at=? WHERE status='sending'")
    .run(recoveredAt, recoveredAt);
  return db;
}

export function createAgent({ config, fetchImpl = globalThis.fetch, logger = console, commandExecutor = null }) {
  const db = createSpool(config.databasePath);
  const directory = new RadiusDirectory(db, config.cacheKey);
  const executor = commandExecutor ?? (config.commandAdapter === "routeros" ? new RouterOsCommandExecutor({ routers: loadRouters(config.routersFile) }) : null);
  let timer = null;
  let tickRunning = false;
  let activeTick = Promise.resolve();
  let closing = false;
  const backgroundTasks = new Set();
  let lastCommandAt = null;
  let lastCommandError = null;
  let lastDirectoryAt = directory.syncedAt();
  let lastDirectoryError = null;
  let nextDirectorySyncAt = 0;
  let nextHeartbeatAt = 0;
  let lastHeartbeatAt = null;
  let lastHeartbeatError = null;

  function runBackground(callback) {
    if (closing) return;
    const task = Promise.resolve().then(callback).catch((error) => logger.error?.(error));
    backgroundTasks.add(task);
    task.finally(() => backgroundTasks.delete(task));
  }

  async function signedPost(route, payload) {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await fetchImpl(`${config.apiUrl}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-uchiha-timestamp": timestamp, "x-uchiha-signature": sign(config.connectorSecret, timestamp, body) },
      body,
      signal: AbortSignal.timeout(15_000)
    });
    const decoded = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`central API returned ${response.status}`);
    return decoded.data;
  }

  async function forwardOne() {
    const now = new Date().toISOString();
    const row = db.prepare("SELECT * FROM accounting_spool WHERE status IN ('pending','failed') AND attempts < 20 AND available_at <= ? ORDER BY created_at ASC LIMIT 1").get(now);
    if (!row) return null;
    db.prepare("UPDATE accounting_spool SET status='sending', attempts=attempts+1, updated_at=? WHERE id=?").run(now, row.id);
    try {
      const stored = JSON.parse(row.payload_json);
      const body = JSON.stringify({ ...stored, nonce: randomBytes(18).toString("base64url"), nonceExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString() });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const response = await fetchImpl(`${config.apiUrl}/connectors/radius/${encodeURIComponent(config.tenantSlug)}/accounting`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-uchiha-timestamp": timestamp, "x-uchiha-signature": sign(config.connectorSecret, timestamp, body) },
        body,
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) throw new Error(`central API returned ${response.status}`);
      db.prepare("UPDATE accounting_spool SET status='sent', last_error=NULL, updated_at=? WHERE id=?").run(new Date().toISOString(), row.id);
      db.prepare("DELETE FROM accounting_spool WHERE status='sent' AND created_at < ?").run(new Date(Date.now() - 7 * 86_400_000).toISOString());
      return { id: row.id, status: "sent" };
    } catch (error) {
      const attempts = Number(row.attempts) + 1;
      const next = new Date(Date.now() + Math.min(300, 2 ** Math.min(attempts, 8)) * 1000).toISOString();
      db.prepare("UPDATE accounting_spool SET status='failed', available_at=?, last_error=?, updated_at=? WHERE id=?").run(next, String(error.message).slice(0, 300), new Date().toISOString(), row.id);
      return { id: row.id, status: "failed" };
    }
  }

  async function forwardAuthOne() {
    const now = new Date().toISOString();
    const row = db.prepare("SELECT * FROM auth_spool WHERE status IN ('pending','failed') AND attempts < 20 AND available_at <= ? ORDER BY created_at ASC LIMIT 1").get(now);
    if (!row) return null;
    db.prepare("UPDATE auth_spool SET status='sending', attempts=attempts+1, updated_at=? WHERE id=?").run(now, row.id);
    try {
      const payload = JSON.parse(row.payload_json);
      await signedPost(`/connectors/radius/${encodeURIComponent(config.tenantSlug)}/auth-events`, connectorEnvelope(payload));
      db.prepare("UPDATE auth_spool SET status='sent', last_error=NULL, updated_at=? WHERE id=?").run(new Date().toISOString(), row.id);
      db.prepare("DELETE FROM auth_spool WHERE status='sent' AND created_at < ?").run(new Date(Date.now() - 7 * 86_400_000).toISOString());
      return { id: row.id, status: "sent" };
    } catch (error) {
      const attempts = Number(row.attempts) + 1;
      const next = new Date(Date.now() + Math.min(300, 2 ** Math.min(attempts, 8)) * 1000).toISOString();
      db.prepare("UPDATE auth_spool SET status='failed', available_at=?, last_error=?, updated_at=? WHERE id=?").run(next, String(error.message).slice(0, 300), new Date().toISOString(), row.id);
      return { id: row.id, status: "failed" };
    }
  }

  function queueAuthEvent(auth, startedAt = null) {
    const eventId = `rau_${createHash("sha256").update(`${auth.requestId}|${auth.username}|${auth.result}|${auth.occurredAt}`).digest("hex").slice(0, 40)}`;
    const event = { eventId, requestId: auth.requestId, username: auth.username, principalType: auth.principalType ?? null,
      principalId: auth.principalId ?? null, nasIp: auth.nasIp ?? null, clientIp: auth.clientIp ?? null,
      result: auth.result, reason: auth.reason ?? null,
      latencyMs: startedAt === null ? undefined : Math.max(0, Math.round(performance.now() - startedAt)), occurredAt: auth.occurredAt };
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO auth_spool (id,payload_json,status,attempts,available_at,last_error,created_at,updated_at)
      VALUES (?,?, 'pending',0,?,NULL,?,?) ON CONFLICT(id) DO NOTHING`).run(eventId, JSON.stringify(event), now, now, now);
    queueMicrotask(() => runBackground(forwardAuthOne));
    return eventId;
  }

  function connectorEnvelope(extra = {}) {
    const now = new Date();
    return {
      agentId: config.agentId,
      nonce: randomBytes(18).toString("base64url"),
      nonceExpiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      ...extra
    };
  }

  async function syncDirectory(force = false) {
    if (!force && Date.now() < nextDirectorySyncAt) return null;
    nextDirectorySyncAt = Date.now() + config.directorySyncMs;
    try {
      const principals = [];
      let afterUsername = "";
      let generatedAt = new Date().toISOString();
      for (let page = 0; page < 100; page += 1) {
        const result = await signedPost(`/connectors/radius/${encodeURIComponent(config.tenantSlug)}/directory`, connectorEnvelope({ afterUsername, limit: 500 }));
        if (![1, 2].includes(result?.version) || !Array.isArray(result.principals)) throw new Error("central directory response is invalid");
        principals.push(...result.principals);
        generatedAt = result.generatedAt ?? generatedAt;
        if (!result.hasMore) break;
        if (!result.nextAfterUsername || result.nextAfterUsername === afterUsername) throw new Error("central directory cursor did not advance");
        afterUsername = result.nextAfterUsername;
        if (page === 99) throw new Error("central directory exceeded the safety page limit");
      }
      directory.replace(principals, generatedAt);
      lastDirectoryAt = generatedAt;
      lastDirectoryError = null;
      return { principals: principals.length, syncedAt: generatedAt };
    } catch (error) {
      lastDirectoryError = String(error?.message ?? error).slice(0, 300);
      throw error;
    }
  }

  async function heartbeat(force = false) {
    if (!force && Date.now() < nextHeartbeatAt) return null;
    nextHeartbeatAt = Date.now() + config.heartbeatMs;
    const pendingAccounting = Number(db.prepare("SELECT COUNT(*) AS total FROM accounting_spool WHERE status IN ('pending','sending','failed')").get().total);
    const pendingAuth = Number(db.prepare("SELECT COUNT(*) AS total FROM auth_spool WHERE status IN ('pending','sending','failed')").get().total);
    try {
      const result = await signedPost(`/connectors/radius/${encodeURIComponent(config.tenantSlug)}/heartbeat`, connectorEnvelope({
        name: config.name, siteId: config.siteId, role: config.role, endpoint: config.advertisedEndpoint,
        version: APP_VERSION, cachedPrincipals: directory.count(), pendingAccounting, pendingAuth,
        directorySyncedAt: directory.syncedAt(), lastError: lastDirectoryError ?? lastCommandError
      }));
      lastHeartbeatAt = result?.receivedAt ?? new Date().toISOString();
      lastHeartbeatError = null;
      return result;
    } catch (error) {
      lastHeartbeatError = String(error?.message ?? error).slice(0, 300);
      throw error;
    }
  }

  async function pollCommand() {
    const claimed = await signedPost(`/connectors/radius/${encodeURIComponent(config.tenantSlug)}/commands/claim`, connectorEnvelope());
    if (!claimed?.command) return null;
    const command = claimed.command;
    let status = "succeeded";
    let detail = null;
    try {
      const result = command.topic === "radius.directory.refresh"
        ? await syncDirectory(true)
        : executor
          ? await executor.execute(command)
          : (() => { throw new Error("RouterOS command adapter is disabled"); })();
      detail = JSON.stringify(result).slice(0, 500);
      lastCommandError = null;
    } catch (error) {
      status = "failed";
      detail = String(error?.message ?? error).slice(0, 500);
      lastCommandError = detail;
    }
    await signedPost(`/connectors/radius/${encodeURIComponent(config.tenantSlug)}/commands/result`, connectorEnvelope({ jobId: command.id, status, detail }));
    lastCommandAt = new Date().toISOString();
    return { id: command.id, status };
  }

  function tick() {
    if (closing) return Promise.resolve();
    if (tickRunning) return activeTick;
    tickRunning = true;
    activeTick = (async () => {
      const results = await Promise.allSettled([forwardOne(), forwardAuthOne(), pollCommand(), syncDirectory(), heartbeat()]);
      for (const result of results) if (result.status === "rejected") logger.error?.(result.reason);
    })().finally(() => {
      tickRunning = false;
    });
    return activeTick;
  }

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        const pending = db.prepare("SELECT COUNT(*) AS total FROM accounting_spool WHERE status IN ('pending','failed')").get().total;
        const pendingAuth = db.prepare("SELECT COUNT(*) AS total FROM auth_spool WHERE status IN ('pending','failed')").get().total;
        return respond(response, 200, { status: "ok", pendingAccounting: pending, pendingAuth, cachedPrincipals: directory.count(),
          directorySyncedAt: lastDirectoryAt, directoryError: lastDirectoryError, lastHeartbeatAt, heartbeatError: lastHeartbeatError,
          commandsEnabled: Boolean(executor), lastCommandAt, lastCommandError });
      }
      if (request.method === "GET" && request.url === "/ready") {
        const syncedAt = directory.syncedAt();
        return respond(response, syncedAt ? 200 : 503, {
          ready: Boolean(syncedAt), cachedPrincipals: directory.count(), directorySyncedAt: syncedAt,
          directoryError: lastDirectoryError
        });
      }
      if (request.method !== "POST" || !["/accounting", "/authorize", "/authenticate", "/post-auth"].includes(request.url)) return respond(response, 404, { error: "not found" });
      if (!safeEqual(request.headers["x-agent-secret"], config.localSecret)) return respond(response, 401, { error: "unauthorized" });
      if (request.url === "/authorize") {
        const authorization = directory.authorize(normalizeAuthorization(await readJson(request)));
        if (authorization.result === "ok") return respond(response, 200, radiusAuthorizeReply(authorization.password, authorization.attributes));
        return respond(response, authorization.result === "error" ? 503 : 401, {});
      }
      if (request.url === "/authenticate") {
        const startedAt = performance.now();
        const auth = directory.authenticate(normalizeAuthentication(await readJson(request)));
        queueAuthEvent(auth, startedAt);
        if (auth.result === "accept") return respond(response, 200, radiusReply(auth.attributes));
        return respond(response, auth.result === "error" ? 503 : 401, {});
      }
      if (request.url === "/post-auth") {
        const result = normalizePostAuth(await readJson(request));
        const principal = directory.authorize(result);
        queueAuthEvent({ ...result, principalType: principal.principalType, principalId: principal.principalId });
        return respond(response, 200, {});
      }
      const event = normalizeAccounting(await readJson(request));
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO accounting_spool (id,payload_json,status,attempts,available_at,last_error,created_at,updated_at)
        VALUES (?,?, 'pending',0,?,NULL,?,?) ON CONFLICT(id) DO NOTHING`).run(event.eventId, JSON.stringify(event), now, now, now);
      respond(response, 202, { accepted: true, eventId: event.eventId });
      queueMicrotask(() => runBackground(forwardOne));
    } catch (error) {
      respond(response, /required|invalid|large/i.test(error.message) ? 400 : 500, { error: error.message });
    }
  });

  return {
    server,
    db,
    forwardOne,
    forwardAuthOne,
    pollCommand,
    syncDirectory,
    heartbeat,
    directory,
    async start() {
      await new Promise((resolve) => server.listen(config.port, config.host, resolve));
      await tick();
      timer = setInterval(() => tick().catch((error) => logger.error(error)), config.pollIntervalMs);
      timer.unref();
      logger.log(`UCHIHA RADIUS agent listening on ${config.host}:${config.port}`);
    },
    async close() {
      if (closing) return;
      closing = true;
      if (timer) clearInterval(timer);
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await activeTick;
      await Promise.allSettled([...backgroundTasks]);
      db.close();
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const agent = createAgent({ config: loadAgentConfig() });
  await agent.start();
  let stopping = false;
  const stop = async (signal, exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    try { await agent.close(); } catch (error) { console.error("Agent shutdown failed", { signal, message: error?.message }); exitCode = 1; }
    process.exit(exitCode);
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
  process.once("uncaughtException", (error) => { console.error("Agent uncaught exception", { message: error?.message }); void stop("uncaughtException", 1); });
  process.once("unhandledRejection", (error) => { console.error("Agent unhandled rejection", { message: error instanceof Error ? error.message : String(error) }); void stop("unhandledRejection", 1); });
}
