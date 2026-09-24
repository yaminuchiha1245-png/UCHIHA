import { decryptSecret, sha256, verifySignedPayload } from "./security.js";
import { AppError, notFound } from "./errors.js";
import { API_ERROR_CODES } from "@uchiha-radius/contracts";
import { addDays, id, nowIso, parseJson, toJson } from "./utils.js";
import { writeAudit } from "./audit.js";
import { calculateSubscriberUsage } from "./quota.js";

const CONNECTOR_NONCE_MAX_LIFETIME_MS = 10 * 60_000;
const CONNECTOR_NONCE_MIN_REMAINING_MS = 30_000;

function stablePayload(value) {
  if (Array.isArray(value)) return value.map(stablePayload);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stablePayload(value[key])]));
  }
  return value;
}

async function queueUniqueRadiusCommand(db, tenantId, topic, payload, matches) {
  const existing = await db.all(`SELECT id, payload_json FROM outbox
    WHERE tenant_id = ? AND topic = ? AND status IN ('pending', 'processing', 'failed')`, [tenantId, topic]);
  if (existing.some((row) => matches(parseJson(row.payload_json, {})))) return false;
  const now = nowIso();
  await db.run(`INSERT INTO outbox
    (id, tenant_id, topic, payload_json, status, attempts, available_at, locked_at, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?)`, [
    id("job"), tenantId, topic, toJson(payload), now, now, now
  ]);
  return true;
}

export class ConnectorService {
  constructor({ db, config }) {
    this.db = db;
    this.config = config;
  }

  async tenantBySlug(slug) {
    const tenant = await this.db.get("SELECT id, name, slug, status, time_zone FROM tenants WHERE slug = ?", [slug]);
    if (!tenant || tenant.status !== "active") throw notFound("موصل الشبكة غير موجود");
    return tenant;
  }

  async verifyRadiusSignature(tenantId, { timestamp, rawBody, signature }) {
    const integration = await this.db.get("SELECT secret_ciphertext FROM integrations WHERE tenant_id = ? AND type = 'radius' AND status = 'active'", [tenantId]);
    let secret = null;
    if (integration?.secret_ciphertext) {
      try {
        const decrypted = decryptSecret(integration.secret_ciphertext, this.config.encryptionKey);
        const decoded = parseJson(decrypted, {});
        secret = decoded.signingSecret ?? null;
      } catch {
        throw new AppError(503, API_ERROR_CODES.INTEGRATION_NOT_CONFIGURED, "بيانات موصل RADIUS تالفة وتحتاج تدويرًا");
      }
    }
    // A shared development key must never authenticate a staging or production tenant.
    // Each deployed provider requires its own explicitly rotated signing key.
    if (!secret && ["development", "test"].includes(this.config.nodeEnv)) secret = this.config.connectorSigningSecret;
    if (!secret || secret.length < 32) throw new AppError(503, API_ERROR_CODES.INTEGRATION_NOT_CONFIGURED, "أصدر مفتاحًا خاصًا لموصل RADIUS أولًا");
    return verifySignedPayload({ secret, timestamp, rawBody, signature });
  }

  async acceptNonce(tenantId, nonce, expiresAt, db = this.db) {
    const now = Date.now();
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < now + CONNECTOR_NONCE_MIN_REMAINING_MS || expiresAtMs > now + CONNECTOR_NONCE_MAX_LIFETIME_MS) {
      throw new AppError(400, API_ERROR_CODES.VALIDATION_ERROR, "مدة صلاحية طلب الموصل غير مقبولة");
    }
    await db.run("DELETE FROM connector_nonces WHERE tenant_id = ? AND expires_at < ?", [tenantId, new Date(now).toISOString()]);
    try {
      await db.run("INSERT INTO connector_nonces (tenant_id, nonce, expires_at, created_at) VALUES (?, ?, ?, ?)",
        [tenantId, nonce, new Date(expiresAtMs).toISOString(), new Date(now).toISOString()]);
    } catch (error) {
      if (/unique|duplicate/i.test(String(error?.message))) {
        throw new AppError(409, API_ERROR_CODES.CONFLICT, "تم رفض طلب موصل مكرر");
      }
      throw error;
    }
  }

  async claimWebhookEvent(db, provider, externalId, payload) {
    const payloadHash = sha256(toJson(stablePayload(payload)));
    const inserted = await db.run(`INSERT INTO webhook_events (id, provider, external_id, payload_hash, processed_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT (provider, external_id) DO NOTHING`,
    [id("evt"), provider, externalId, payloadHash, nowIso()]);
    if (inserted.changes === 1) return { duplicate: false };
    const existing = await db.get("SELECT payload_hash FROM webhook_events WHERE provider = ? AND external_id = ?", [provider, externalId]);
    if (existing?.payload_hash === payloadHash) return { duplicate: true };
    throw new AppError(409, API_ERROR_CODES.CONFLICT, "معرّف الحدث مستخدم مع محتوى مختلف");
  }

  async claimRadiusCommand(tenant, request) {
    return this.db.transaction(async (tx) => {
      await this.acceptNonce(tenant.id, request.nonce, request.nonceExpiresAt, tx);
      const now = nowIso();
      const staleBefore = new Date(Date.now() - 2 * 60_000).toISOString();
      const lock = tx.driver === "postgres" ? " FOR UPDATE SKIP LOCKED" : "";
      const job = await tx.get(`SELECT * FROM outbox
        WHERE tenant_id = ?
          AND topic IN ('radius.subscriber.sync', 'radius.session.disconnect', 'radius.directory.refresh')
          AND attempts < 20
          AND ((status IN ('pending', 'failed') AND available_at <= ?)
            OR (status = 'processing' AND locked_at <= ?))
        ORDER BY created_at ASC LIMIT 1${lock}`, [tenant.id, now, staleBefore]);
      if (!job) {
        await tx.run("UPDATE integrations SET last_seen_at = ?, last_error = NULL, updated_at = ? WHERE tenant_id = ? AND type = 'radius'", [now, now, tenant.id]);
        return { command: null, pollAfterMs: 2_000 };
      }
      const claimed = await tx.run(`UPDATE outbox SET status = 'processing', locked_at = ?, attempts = attempts + 1,
        last_error = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?`, [now, now, job.id, tenant.id]);
      if (claimed.changes !== 1) return { command: null, pollAfterMs: 500 };
      await tx.run("UPDATE integrations SET last_seen_at = ?, last_error = NULL, updated_at = ? WHERE tenant_id = ? AND type = 'radius'", [now, now, tenant.id]);
      return {
        command: {
          id: job.id,
          topic: job.topic,
          payload: parseJson(job.payload_json, {}),
          attempt: Number(job.attempts) + 1,
          claimedAt: now
        },
        pollAfterMs: 0
      };
    });
  }

  async completeRadiusCommand(tenant, result) {
    return this.db.transaction(async (tx) => {
      await this.acceptNonce(tenant.id, result.nonce, result.nonceExpiresAt, tx);
      const job = await tx.get(`SELECT * FROM outbox WHERE id = ? AND tenant_id = ?
        AND topic IN ('radius.subscriber.sync', 'radius.session.disconnect', 'radius.directory.refresh')`, [result.jobId, tenant.id]);
      if (!job) throw notFound("مهمة الموصل غير موجودة");
      if (job.status === "sent") return { id: job.id, status: "sent", duplicate: true };
      if (job.status !== "processing") throw new AppError(409, API_ERROR_CODES.CONFLICT, "مهمة الموصل ليست قيد التنفيذ");
      const now = nowIso();
      if (result.status === "succeeded") {
        await tx.run("UPDATE outbox SET status = 'sent', locked_at = NULL, last_error = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?", [now, job.id, tenant.id]);
        if (job.topic === "radius.session.disconnect") {
          const payload = parseJson(job.payload_json, {});
          await tx.run(`UPDATE radius_sessions SET status = 'stopped', stopped_at = ?, terminate_cause = 'Admin-Reset', updated_at = ?
            WHERE id = ? AND tenant_id = ? AND status = 'active'`, [now, now, payload.sessionId, tenant.id]);
        }
      } else {
        const delaySeconds = Math.min(300, 2 ** Math.min(Number(job.attempts) + 1, 8));
        const availableAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
        await tx.run(`UPDATE outbox SET status = 'failed', locked_at = NULL, last_error = ?, available_at = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ?`, [String(result.detail ?? "فشل تنفيذ الموصل").slice(0, 500), availableAt, now, job.id, tenant.id]);
      }
      await tx.run("UPDATE integrations SET last_seen_at = ?, last_error = ?, updated_at = ? WHERE tenant_id = ? AND type = 'radius'",
        [now, result.status === "failed" ? String(result.detail ?? "فشل تنفيذ الأمر").slice(0, 500) : null, now, tenant.id]);
      await writeAudit(tx, null, {
        tenantId: tenant.id,
        actorType: "connector",
        action: result.status === "succeeded" ? "radius.command.succeeded" : "radius.command.failed",
        entityType: "outbox_job",
        entityId: job.id,
        after: { topic: job.topic, agentId: result.agentId, detail: result.detail ?? null }
      });
      return { id: job.id, status: result.status === "succeeded" ? "sent" : "failed", duplicate: false };
    });
  }

  async radiusDirectory(tenant, request) {
    return this.db.transaction(async (tx) => {
      await this.acceptNonce(tenant.id, request.nonce, request.nonceExpiresAt, tx);
      const afterUsername = request.afterUsername ?? "";
      const limit = Math.max(1, Math.min(500, Number(request.limit ?? 250)));
      const rows = await tx.all(`SELECT * FROM (
        SELECT 'subscriber' AS principal_type, s.id AS principal_id, s.username, s.radius_secret_ciphertext AS secret_ciphertext,
          s.id AS usage_subscriber_id, s.credential_version, s.status, s.service_expires_at AS expires_at,
          p.speed_down_mbps, p.speed_up_mbps, p.quota_bytes, p.quota_period, p.quota_action,
          p.throttle_down_mbps, p.throttle_up_mbps, p.simultaneous_use AS plan_simultaneous_use,
          p.scope_type, p.scope_id,
          rp.auth_methods_json, rp.simultaneous_use, rp.idle_timeout_seconds, rp.session_timeout_seconds, rp.interim_interval_seconds,
          rp.rate_limit_down_mbps, rp.rate_limit_up_mbps, ip.name AS pool_name
        FROM subscribers s
        LEFT JOIN plans p ON p.id = s.plan_id
        LEFT JOIN radius_policies rp ON rp.id = COALESCE(s.policy_id, p.policy_id)
        LEFT JOIN ip_pools ip ON ip.id = COALESCE(s.ip_pool_id, p.ip_pool_id)
        WHERE s.tenant_id = ? AND s.radius_secret_ciphertext IS NOT NULL
        UNION ALL
        SELECT 'voucher' AS principal_type, v.id AS principal_id, v.username, v.secret_ciphertext,
          NULL AS usage_subscriber_id, 1 AS credential_version, v.status, COALESCE(v.expires_at, b.expires_at) AS expires_at,
          p.speed_down_mbps, p.speed_up_mbps, p.quota_bytes, p.quota_period, p.quota_action,
          p.throttle_down_mbps, p.throttle_up_mbps, p.simultaneous_use AS plan_simultaneous_use,
          p.scope_type, p.scope_id,
          rp.auth_methods_json, rp.simultaneous_use, rp.idle_timeout_seconds, rp.session_timeout_seconds, rp.interim_interval_seconds,
          rp.rate_limit_down_mbps, rp.rate_limit_up_mbps, ip.name AS pool_name
        FROM vouchers v
        JOIN voucher_batches b ON b.id = v.batch_id
        JOIN plans p ON p.id = b.plan_id
        LEFT JOIN radius_policies rp ON rp.id = p.policy_id
        LEFT JOIN ip_pools ip ON ip.id = p.ip_pool_id
        WHERE v.tenant_id = ? AND v.subscriber_id IS NULL AND v.status IN ('available', 'assigned', 'active')
      ) directory WHERE username > ? ORDER BY username ASC LIMIT ?`, [tenant.id, tenant.id, afterUsername, limit + 1]);
      const page = rows.slice(0, limit);
      const devices = await tx.all("SELECT id, site_id, host FROM network_devices WHERE tenant_id = ?", [tenant.id]);
      const now = nowIso();
      await tx.run("UPDATE integrations SET last_seen_at = ?, last_error = NULL, updated_at = ? WHERE tenant_id = ? AND type = 'radius'", [now, now, tenant.id]);
      const principals = await Promise.all(page.map(async (row) => {
        const usage = row.usage_subscriber_id
          ? await calculateSubscriberUsage(tx, {
            tenantId: tenant.id,
            subscriberId: row.usage_subscriber_id,
            quotaBytes: row.quota_bytes,
            quotaPeriod: row.quota_period,
            timeZone: tenant.time_zone ?? "UTC"
          })
          : null;
        const quotaExceeded = Boolean(usage?.exceeded);
        const quotaBlocked = quotaExceeded && row.quota_action === "block";
        const throttled = quotaExceeded && row.quota_action === "throttle";
        const down = Number(throttled ? row.throttle_down_mbps : (row.rate_limit_down_mbps ?? row.speed_down_mbps ?? 0)) || null;
        const up = Number(throttled ? row.throttle_up_mbps : (row.rate_limit_up_mbps ?? row.speed_up_mbps ?? 0)) || null;
        const allowedNasIps = row.scope_type === "device"
          ? devices.filter((device) => device.id === row.scope_id).map((device) => device.host)
          : row.scope_type === "site"
            ? devices.filter((device) => device.site_id === row.scope_id).map((device) => device.host)
            : null;
        return {
          principalType: row.principal_type,
          principalId: row.principal_id,
          username: row.username,
          password: decryptSecret(row.secret_ciphertext, this.config.encryptionKey),
          credentialVersion: Number(row.credential_version ?? 1),
          status: quotaBlocked ? "quota_blocked" : row.status,
          expiresAt: row.expires_at,
          attributes: {
            authMethods: parseJson(row.auth_methods_json, ["pap", "chap", "mschap", "mschapv2"]),
            simultaneousUse: Number(row.plan_simultaneous_use ?? row.simultaneous_use ?? 1),
            idleTimeoutSeconds: row.idle_timeout_seconds === null ? null : Number(row.idle_timeout_seconds),
            sessionTimeoutSeconds: row.session_timeout_seconds === null ? null : Number(row.session_timeout_seconds),
            interimIntervalSeconds: Number(row.interim_interval_seconds ?? 300),
            rateLimitDownMbps: down,
            rateLimitUpMbps: up,
            framedPool: row.pool_name ?? null,
            scopeType: row.scope_type ?? "all",
            scopeId: row.scope_id ?? null,
            allowedNasIps,
            quota: usage ? { ...usage, action: row.quota_action, throttled } : null
          }
        };
      }));
      return {
        version: 2,
        generatedAt: now,
        fullSnapshot: afterUsername === "",
        principals,
        hasMore: rows.length > limit,
        nextAfterUsername: rows.length > limit ? page.at(-1)?.username ?? null : null
      };
    });
  }

  async radiusHeartbeat(tenant, heartbeat) {
    return this.db.transaction(async (tx) => {
      await this.acceptNonce(tenant.id, heartbeat.nonce, heartbeat.nonceExpiresAt, tx);
      if (heartbeat.siteId) {
        const site = await tx.get("SELECT id FROM network_sites WHERE id = ? AND tenant_id = ?", [heartbeat.siteId, tenant.id]);
        if (!site) throw new AppError(400, API_ERROR_CODES.VALIDATION_ERROR, "موقع عقدة RADIUS غير صالح");
      }
      const now = nowIso();
      const existing = await tx.get("SELECT id FROM radius_nodes WHERE tenant_id = ? AND agent_id = ?", [tenant.id, heartbeat.agentId]);
      const status = heartbeat.lastError ? "degraded" : "healthy";
      if (existing) {
        await tx.run(`UPDATE radius_nodes SET site_id = ?, name = ?, role = ?, endpoint = ?, status = ?, version = ?,
          cached_principals = ?, pending_accounting = ?, pending_auth = ?, last_directory_sync_at = ?, last_error = ?,
          last_seen_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, [heartbeat.siteId ?? null, heartbeat.name,
          heartbeat.role, heartbeat.endpoint ?? null, status, heartbeat.version, heartbeat.cachedPrincipals,
          heartbeat.pendingAccounting, heartbeat.pendingAuth, heartbeat.directorySyncedAt ?? null,
          heartbeat.lastError ?? null, now, now, existing.id, tenant.id]);
      } else {
        await tx.run(`INSERT INTO radius_nodes
          (id, tenant_id, agent_id, site_id, name, role, endpoint, status, version, cached_principals,
           pending_accounting, pending_auth, last_directory_sync_at, last_error, last_seen_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id("rno"), tenant.id, heartbeat.agentId,
          heartbeat.siteId ?? null, heartbeat.name, heartbeat.role, heartbeat.endpoint ?? null, status, heartbeat.version,
          heartbeat.cachedPrincipals, heartbeat.pendingAccounting, heartbeat.pendingAuth, heartbeat.directorySyncedAt ?? null,
          heartbeat.lastError ?? null, now, now, now]);
      }
      await tx.run("UPDATE integrations SET last_seen_at = ?, last_error = ?, updated_at = ? WHERE tenant_id = ? AND type = 'radius'",
        [now, heartbeat.lastError ?? null, now, tenant.id]);
      // A valid agent HMAC proves the tenant, but the RouterOS online flag
      // additionally requires an authenticated TLS probe of that exact device.
      // Never turn a device online simply because the agent is heartbeat-alive.
      const seen = new Set();
      let verifiedRouters = 0;
      for (const router of heartbeat.routers ?? []) {
        if (seen.has(router.deviceId)) continue;
        seen.add(router.deviceId);
        const match = await tx.get("SELECT id,site_id,host,api_port FROM network_devices WHERE id=? AND tenant_id=?",
          [router.deviceId, tenant.id]);
        if (!match || match.host !== router.host || Number(match.api_port) !== router.port) continue;
        // Two independent ISP sites can both use 192.168.88.1. Only an agent
        // explicitly bound to the same site may verify its own router.
        if ((match.site_id ?? null) !== (heartbeat.siteId ?? null)) continue;
        // Older releases allowed identical unassigned endpoints; do not grant
        // "online" to either until the operator separates the site assignments.
        const collision = await tx.get(
          "SELECT id FROM network_devices WHERE tenant_id=? AND id<>? AND host=? AND api_port=? AND ((site_id IS NULL AND ? IS NULL) OR site_id=?) LIMIT 1",
          [tenant.id, match.id, match.host, match.api_port, match.site_id ?? null, match.site_id ?? null]);
        if (collision) continue;
        if (router.status === "online") {
          await tx.run("UPDATE network_devices SET status='online',last_seen_at=?,updated_at=? WHERE id=? AND tenant_id=?",
            [now, now, match.id, tenant.id]);
          verifiedRouters += 1;
        } else {
          await tx.run("UPDATE network_devices SET status='error',updated_at=? WHERE id=? AND tenant_id=?",
            [now, match.id, tenant.id]);
        }
      }
      return { accepted: true, status, receivedAt: now, verifiedRouters };
    });
  }

  async activateVoucher(tx, tenant, voucher, occurredAt) {
    if (!voucher || voucher.subscriber_id) return voucher?.subscriber_id ?? null;
    if (tx.driver === "postgres") {
      await tx.get("SELECT pg_advisory_xact_lock(hashtextextended(?, 0)) AS locked", [`voucher:${tenant.id}:${voucher.username}`]);
      voucher = await tx.get("SELECT * FROM vouchers WHERE id = ? AND tenant_id = ?", [voucher.id, tenant.id]);
      if (!voucher || voucher.subscriber_id) return voucher?.subscriber_id ?? null;
    }
    if (!["available", "assigned", "active"].includes(voucher.status)) return null;
    const existing = await tx.get("SELECT id FROM subscribers WHERE tenant_id = ? AND username = ?", [tenant.id, voucher.username]);
    if (existing) {
      await tx.run("UPDATE vouchers SET subscriber_id = ?, status = 'active', activated_at = COALESCE(activated_at, ?), updated_at = ? WHERE id = ? AND tenant_id = ?",
        [existing.id, occurredAt, nowIso(), voucher.id, tenant.id]);
      return existing.id;
    }
    const batch = await tx.get(`SELECT b.plan_id, b.valid_days, b.expires_at FROM voucher_batches b
      WHERE b.id = ? AND b.tenant_id = ? AND b.status IN ('active','exhausted')`, [voucher.batch_id, tenant.id]);
    if (!batch) return null;
    const calculatedExpiry = addDays(occurredAt, Number(batch.valid_days));
    const expiresAt = batch.expires_at && batch.expires_at < calculatedExpiry ? batch.expires_at : calculatedExpiry;
    const subscriberId = id("cus");
    const now = nowIso();
    await tx.run(`INSERT INTO subscribers
      (id, tenant_id, plan_id, policy_id, ip_pool_id, username, radius_secret_ciphertext, credential_version,
       full_name, phone, address, status, balance_minor, service_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, NULL, NULL, ?, ?, 1, ?, NULL, NULL, 'active', 0, ?, ?, ?)`, [subscriberId, tenant.id,
      batch.plan_id, voucher.username, voucher.secret_ciphertext, `بطاقة ${voucher.username}`, expiresAt, now, now]);
    await tx.run(`UPDATE vouchers SET subscriber_id = ?, status = 'active', activated_at = ?, expires_at = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?`, [subscriberId, occurredAt, expiresAt, now, voucher.id, tenant.id]);
    const remaining = await tx.get("SELECT COUNT(*) AS total FROM vouchers WHERE batch_id = ? AND status IN ('available','assigned')", [voucher.batch_id]);
    if (Number(remaining?.total ?? 0) === 0) {
      await tx.run("UPDATE voucher_batches SET status = 'exhausted', updated_at = ? WHERE id = ? AND tenant_id = ?", [now, voucher.batch_id, tenant.id]);
    }
    return subscriberId;
  }

  async radiusAuthEvent(tenant, event) {
    return this.db.transaction(async (tx) => {
      await this.acceptNonce(tenant.id, event.nonce, event.nonceExpiresAt, tx);
      if (tx.driver === "postgres") {
        await tx.get("SELECT pg_advisory_xact_lock(hashtextextended(?, 0)) AS locked", [`radius-auth:${tenant.id}:${event.eventId}`]);
      }
      const existingEvent = await tx.get("SELECT id FROM radius_auth_events WHERE tenant_id = ? AND event_id = ?", [tenant.id, event.eventId]);
      if (existingEvent) return { accepted: true, duplicate: true };
      let subscriber = await tx.get("SELECT id FROM subscribers WHERE tenant_id = ? AND username = ?", [tenant.id, event.username]);
      const voucher = !subscriber && event.principalType === "voucher"
        ? await tx.get("SELECT * FROM vouchers WHERE tenant_id = ? AND id = ? AND username = ?", [tenant.id, event.principalId, event.username])
        : null;
      if (event.result === "accept" && voucher) {
        const subscriberId = await this.activateVoucher(tx, tenant, voucher, event.occurredAt);
        if (subscriberId) subscriber = { id: subscriberId };
      }
      const device = event.nasIp
        ? await tx.get("SELECT id FROM network_devices WHERE tenant_id = ? AND host = ?", [tenant.id, event.nasIp])
        : null;
      const receivedAt = nowIso();
      await tx.run(`INSERT INTO radius_auth_events
        (id, tenant_id, event_id, request_id, username, subscriber_id, device_id, nas_ip, client_ip,
         result, reason, latency_ms, occurred_at, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id("rau"), tenant.id, event.eventId, event.requestId,
        event.username, subscriber?.id ?? null, device?.id ?? null, event.nasIp ?? null, event.clientIp ?? null,
        event.result, event.reason ?? null, event.latencyMs ?? null, event.occurredAt, receivedAt]);
      await tx.run("UPDATE integrations SET last_seen_at = ?, last_error = ?, updated_at = ? WHERE tenant_id = ? AND type = 'radius'",
        [receivedAt, event.result === "error" ? String(event.reason ?? "authentication error").slice(0, 500) : null, receivedAt, tenant.id]);
      return { accepted: true, duplicate: false, subscriberMatched: Boolean(subscriber) };
    });
  }

  async radiusAccounting(tenant, event) {
    return this.db.transaction(async (tx) => {
      await this.acceptNonce(tenant.id, event.nonce, event.nonceExpiresAt, tx);
      // A retry has a fresh transport nonce, but the accounting event is unchanged.
      const { nonce, nonceExpiresAt, ...accountingPayload } = event;
      const claimed = await this.claimWebhookEvent(tx, `radius:${tenant.id}`, event.eventId, accountingPayload);
      if (claimed.duplicate) return { accepted: true, duplicate: true };

      let subscriber = await tx.get("SELECT id FROM subscribers WHERE tenant_id = ? AND username = ?", [tenant.id, event.username]);
      if (!subscriber && event.statusType === "start") {
        const voucher = await tx.get(`SELECT v.* FROM vouchers v JOIN voucher_batches b ON b.id = v.batch_id
          WHERE v.tenant_id = ? AND v.username = ? AND v.subscriber_id IS NULL
            AND v.status IN ('available','assigned','active') AND (COALESCE(v.expires_at, b.expires_at) IS NULL OR COALESCE(v.expires_at, b.expires_at) > ?)`,
        [tenant.id, event.username, event.occurredAt]);
        const subscriberId = await this.activateVoucher(tx, tenant, voucher, event.occurredAt);
        if (subscriberId) subscriber = { id: subscriberId };
      }
      const device = event.nasIp
        ? await tx.get("SELECT id FROM network_devices WHERE tenant_id = ? AND host = ?", [tenant.id, event.nasIp])
        : null;
      if (tx.driver === "postgres") {
        await tx.get("SELECT pg_advisory_xact_lock(hashtextextended(?, 0)) AS locked", [`radius-session:${tenant.id}:${event.sessionId}`]);
      }
      const existing = await tx.get("SELECT * FROM radius_sessions WHERE tenant_id = ? AND external_session_id = ?",
        [tenant.id, event.sessionId]);
      const now = nowIso();
      const stopped = event.statusType === "stop";
      await tx.run(`INSERT INTO radius_accounting_events
        (id, tenant_id, event_id, session_id, status_type, username, subscriber_id, device_id, framed_ip, nas_ip,
         input_bytes, output_bytes, terminate_cause, occurred_at, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id("rac"), tenant.id, event.eventId, event.sessionId,
        event.statusType, event.username, subscriber?.id ?? null, device?.id ?? null, event.framedIp ?? null, event.nasIp ?? null,
        event.inputBytes ?? 0, event.outputBytes ?? 0, event.terminateCause ?? null, event.occurredAt, now]);
      if (existing) {
        const remainsStopped = existing.status === "stopped";
        await tx.run(`UPDATE radius_sessions SET subscriber_id = ?, device_id = ?, framed_ip = ?, nas_ip = ?,
          stopped_at = ?, input_bytes = ?, output_bytes = ?, terminate_cause = ?, status = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ?`, [
          subscriber?.id ?? existing.subscriber_id, device?.id ?? existing.device_id, event.framedIp ?? existing.framed_ip,
          event.nasIp ?? existing.nas_ip, (stopped && !remainsStopped) ? (event.occurredAt ?? now) : existing.stopped_at,
          Math.max(Number(existing.input_bytes), event.inputBytes ?? 0), Math.max(Number(existing.output_bytes), event.outputBytes ?? 0),
          event.terminateCause ?? existing.terminate_cause, (stopped || remainsStopped) ? "stopped" : "active", now, existing.id, tenant.id
        ]);
      } else {
        await tx.run(`INSERT INTO radius_sessions
          (id, tenant_id, subscriber_id, device_id, external_session_id, username, framed_ip, nas_ip, started_at, stopped_at,
           input_bytes, output_bytes, terminate_cause, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          id("rad"), tenant.id, subscriber?.id ?? null, device?.id ?? null, event.sessionId, event.username,
          event.framedIp ?? null, event.nasIp ?? null, event.startedAt ?? event.occurredAt ?? now,
          stopped ? (event.occurredAt ?? now) : null, event.inputBytes ?? 0, event.outputBytes ?? 0,
          event.terminateCause ?? null, stopped ? "stopped" : "active", now
        ]);
      }
      // Accounting proves traffic on a NAS IP, not an authenticated RouterOS
      // management connection. Only the Site Agent's verified TLS probe may
      // mark a network device online; still associate accounting with its ID.
      let quotaEnforcement = null;
      if (subscriber) {
        const quotaPlan = await tx.get(`SELECT p.quota_bytes, p.quota_period, p.quota_action
          FROM subscribers s JOIN plans p ON p.id = s.plan_id
          WHERE s.id = ? AND s.tenant_id = ?`, [subscriber.id, tenant.id]);
        if (quotaPlan?.quota_period && quotaPlan.quota_period !== "none" && quotaPlan.quota_bytes) {
          const usage = await calculateSubscriberUsage(tx, {
            tenantId: tenant.id,
            subscriberId: subscriber.id,
            quotaBytes: quotaPlan.quota_bytes,
            quotaPeriod: quotaPlan.quota_period,
            timeZone: tenant.time_zone ?? "UTC",
            at: new Date(event.occurredAt ?? now)
          });
          if (usage.exceeded) {
            const refreshQueued = await queueUniqueRadiusCommand(tx, tenant.id, "radius.directory.refresh",
              { reason: "quota_exceeded", subscriberId: subscriber.id }, () => true);
            const activeSessions = await tx.all(`SELECT id, external_session_id, username, framed_ip, nas_ip, device_id
              FROM radius_sessions WHERE tenant_id = ? AND subscriber_id = ? AND status = 'active'`, [tenant.id, subscriber.id]);
            let disconnectsQueued = 0;
            for (const session of activeSessions) {
              const queued = await queueUniqueRadiusCommand(tx, tenant.id, "radius.session.disconnect", {
                sessionId: session.id,
                externalSessionId: session.external_session_id,
                username: session.username,
                framedIp: session.framed_ip,
                nasIp: session.nas_ip,
                deviceId: session.device_id,
                reason: quotaPlan.quota_action === "throttle" ? "quota_throttle" : "quota_exceeded"
              }, (payload) => payload.sessionId === session.id);
              if (queued) disconnectsQueued += 1;
            }
            quotaEnforcement = { ...usage, action: quotaPlan.quota_action, refreshQueued, disconnectsQueued };
            if (refreshQueued || disconnectsQueued > 0) {
              await writeAudit(tx, null, {
                tenantId: tenant.id,
                actorType: "system",
                action: quotaPlan.quota_action === "throttle" ? "subscriber.quota.throttle" : "subscriber.quota.block",
                entityType: "subscriber",
                entityId: subscriber.id,
                after: quotaEnforcement
              });
            }
          }
        }
      }
      if (!subscriber) await this.createUnknownSubscriberAlert(tx, tenant, event);
      await writeAudit(tx, null, {
        tenantId: tenant.id, actorType: "connector", action: `radius.accounting.${event.statusType}`,
        entityType: "radius_session", entityId: event.sessionId, after: { username: event.username, nasIp: event.nasIp }
      });
      return { accepted: true, duplicate: false, subscriberMatched: Boolean(subscriber), quotaEnforcement };
    });
  }

  async createUnknownSubscriberAlert(db, tenant, event) {
    const now = nowIso();
    const alertId = id("alt");
    await db.run(`INSERT INTO alerts
      (id, tenant_id, severity, category, title, body, status, acknowledged_by_user_id, acknowledged_at, created_at, updated_at)
      VALUES (?, ?, 'warning', 'radius', 'جلسة باسم غير معروف', ?, 'open', NULL, NULL, ?, ?)`,
    [alertId, tenant.id, `وصلت جلسة RADIUS باسم ${event.username} ولم تطابق مشتركًا.`, now, now]);
    await db.run(`INSERT INTO outbox
      (id, tenant_id, topic, payload_json, status, attempts, available_at, locked_at, last_error, created_at, updated_at)
      VALUES (?, ?, 'telegram.alert', ?, 'pending', 0, ?, NULL, NULL, ?, ?)`,
    [id("job"), tenant.id, toJson({ alertId, severity: "warning", title: "جلسة باسم غير معروف", body: `المستخدم: ${event.username}` }), now, now, now]);
  }

  async billingEvent(event) {
    return this.db.transaction(async (tx) => {
      const claimed = await this.claimWebhookEvent(tx, "billing", event.id, event);
      if (claimed.duplicate) return { accepted: true, duplicate: true };
      const tenant = await tx.get("SELECT id FROM tenants WHERE id = ?", [event.tenantId]);
      if (!tenant) throw notFound("الشبكة غير موجودة");
      let subscription = event.subscriptionId
        ? await tx.get("SELECT * FROM tenant_subscriptions WHERE id = ? AND tenant_id = ?", [event.subscriptionId, event.tenantId])
        : null;
      if (!subscription && event.externalSubscriptionId) {
        subscription = await tx.get("SELECT * FROM tenant_subscriptions WHERE external_id = ? AND tenant_id = ?", [event.externalSubscriptionId, event.tenantId]);
      }
      if (!subscription) throw notFound("الاشتراك غير موجود");
      if (["trialing", "active", "grace"].includes(event.status)) {
        const now = nowIso();
        await tx.run(`UPDATE tenant_subscriptions SET status = 'canceled', ends_at = COALESCE(ends_at, ?), updated_at = ?
          WHERE tenant_id = ? AND id <> ? AND status IN ('trialing', 'active', 'grace')`, [now, now, event.tenantId, subscription.id]);
      }
      await tx.run(`UPDATE tenant_subscriptions SET status = ?, provider = ?, external_id = ?, starts_at = ?, ends_at = ?,
        checkout_url = NULL, checkout_expires_at = NULL, updated_at = ?
        WHERE id = ? AND tenant_id = ?`, [
        event.status, event.provider, event.externalSubscriptionId ?? subscription.external_id,
        event.startsAt ?? subscription.starts_at, event.endsAt ?? subscription.ends_at, nowIso(), subscription.id, event.tenantId
      ]);
      await writeAudit(tx, null, { tenantId: event.tenantId, actorType: "webhook", action: "subscription.webhook.update", entityType: "tenant_subscription", entityId: subscription.id, before: { status: subscription.status }, after: { status: event.status, provider: event.provider } });
      return { accepted: true, duplicate: false, subscriptionId: subscription.id, status: event.status };
    });
  }

  async telegramUpdate(update) {
    if (!update || typeof update !== "object" || Array.isArray(update)) {
      throw new AppError(400, API_ERROR_CODES.VALIDATION_ERROR, "تحديث Telegram غير صالح");
    }
    if (update.update_id !== undefined && !Number.isSafeInteger(update.update_id)) {
      throw new AppError(400, API_ERROR_CODES.VALIDATION_ERROR, "معرّف تحديث Telegram غير صالح");
    }
    return this.db.transaction(async (tx) => {
      if (Number.isSafeInteger(update.update_id)) {
        const claimed = await this.claimWebhookEvent(tx, "telegram", String(update.update_id), update);
        if (claimed.duplicate) return { accepted: true, ignored: true, duplicate: true };
      }
      const message = update.message ?? update.edited_message;
      if (!message?.chat?.id || !message.text) return { accepted: true, ignored: true, duplicate: false };
      const integrations = await tx.all("SELECT * FROM integrations WHERE type = 'telegram' AND status = 'active'");
      let integration = null;
      for (const candidate of integrations) {
        try {
          const secret = JSON.parse(decryptSecret(candidate.secret_ciphertext, this.config.encryptionKey));
          if (String(secret.chatId) === String(message.chat.id)) {
            integration = candidate;
            break;
          }
        } catch {
          // A malformed secret is isolated to its integration and reported in the owner job view.
        }
      }
      if (!integration) return { accepted: true, ignored: true };
      const text = String(message.text).trim();
      let reply;
      if (text === "/start" || text === "/help") {
        reply = "أوامر UCHIHA RADIUS:\n/status حالة الشبكة\n/alerts آخر التنبيهات\n/subscriber اسم_المستخدم";
      } else if (text === "/status") {
        const [subscribers, sessions, alerts] = await Promise.all([
          tx.get("SELECT COUNT(*) AS total FROM subscribers WHERE tenant_id = ? AND status = 'active'", [integration.tenant_id]),
          tx.get("SELECT COUNT(*) AS total FROM radius_sessions WHERE tenant_id = ? AND status = 'active'", [integration.tenant_id]),
          tx.get("SELECT COUNT(*) AS total FROM alerts WHERE tenant_id = ? AND status = 'open'", [integration.tenant_id])
        ]);
        reply = `الحالة الآن\nالمشتركون الفعالون: ${subscribers.total}\nالجلسات: ${sessions.total}\nالتنبيهات المفتوحة: ${alerts.total}`;
      } else if (text === "/alerts") {
        const alerts = await tx.all("SELECT severity, title FROM alerts WHERE tenant_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 5", [integration.tenant_id]);
        reply = alerts.length ? alerts.map((alert) => `• ${alert.title} (${alert.severity})`).join("\n") : "لا توجد تنبيهات مفتوحة.";
      } else if (text.startsWith("/subscriber ")) {
        const username = text.slice(12).trim();
        const subscriber = await tx.get(`SELECT s.full_name, s.username, s.status, s.balance_minor, p.name AS plan_name
          FROM subscribers s LEFT JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = ? AND s.username = ?`, [integration.tenant_id, username]);
        reply = subscriber
          ? `${subscriber.full_name}\nالحساب: ${subscriber.username}\nالحالة: ${subscriber.status}\nالباقة: ${subscriber.plan_name ?? "—"}\nالرصيد: ${subscriber.balance_minor}`
          : "لم أجد مشتركًا بهذا الاسم.";
      } else {
        reply = "الأمر غير معروف. أرسل /help لعرض الأوامر.";
      }
      const now = nowIso();
      await tx.run(`INSERT INTO outbox
        (id, tenant_id, topic, payload_json, status, attempts, available_at, locked_at, last_error, created_at, updated_at)
        VALUES (?, ?, 'telegram.message', ?, 'pending', 0, ?, NULL, NULL, ?, ?)`,
      [id("job"), integration.tenant_id, toJson({ chatId: message.chat.id, text: reply, replyToMessageId: message.message_id }), now, now, now]);
      await tx.run("UPDATE integrations SET last_seen_at = ?, last_error = NULL, updated_at = ? WHERE id = ?", [now, now, integration.id]);
      return { accepted: true, ignored: false, duplicate: false };
    });
  }
}
