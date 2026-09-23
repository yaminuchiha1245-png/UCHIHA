import { randomBytes } from "node:crypto";
import { API_ERROR_CODES, PERMISSIONS } from "@uchiha-radius/contracts";
import { decryptSecret, encryptSecret } from "./security.js";
import { AppError, notFound, validationError } from "./errors.js";
import { requireCapacity, requirePermission, requireWrite } from "./guards.js";
import { writeAudit } from "./audit.js";
import { id, nowIso, pageFromQuery, parseJson, toJson } from "./utils.js";

function conflict(message) {
  return new AppError(409, API_ERROR_CODES.CONFLICT, message);
}

function rethrowUnique(error, message) {
  if (/unique|duplicate/i.test(String(error?.message ?? ""))) throw conflict(message);
  throw error;
}

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function siteView(row) {
  return { id: row.id, name: row.name, code: row.code, address: row.address,
    latitude: numberOrNull(row.latitude), longitude: numberOrNull(row.longitude), status: row.status,
    devices: Number(row.device_count ?? 0), onlineDevices: Number(row.online_device_count ?? 0),
    activeSessions: Number(row.active_session_count ?? 0), createdAt: row.created_at, updatedAt: row.updated_at };
}

function poolView(row) {
  return { id: row.id, siteId: row.site_id, siteName: row.site_name ?? null, name: row.name, cidr: row.cidr,
    gateway: row.gateway, dns: parseJson(row.dns_json, []), purpose: row.purpose, status: row.status,
    assignedSubscribers: Number(row.assigned_subscribers ?? 0), createdAt: row.created_at, updatedAt: row.updated_at };
}

function policyView(row) {
  return { id: row.id, name: row.name, authMethods: parseJson(row.auth_methods_json, []),
    simultaneousUse: Number(row.simultaneous_use), idleTimeoutSeconds: numberOrNull(row.idle_timeout_seconds),
    sessionTimeoutSeconds: numberOrNull(row.session_timeout_seconds), interimIntervalSeconds: Number(row.interim_interval_seconds),
    rateLimitDownMbps: numberOrNull(row.rate_limit_down_mbps), rateLimitUpMbps: numberOrNull(row.rate_limit_up_mbps),
    status: row.status, assignedPlans: Number(row.assigned_plans ?? 0), assignedSubscribers: Number(row.assigned_subscribers ?? 0),
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function resellerView(row) {
  return { id: row.id, siteId: row.site_id, siteName: row.site_name ?? null, name: row.name, phone: row.phone,
    email: row.email, commissionBps: Number(row.commission_bps), status: row.status, balanceMinor: Number(row.balance_minor),
    voucherBatches: Number(row.batch_count ?? 0), createdAt: row.created_at, updatedAt: row.updated_at };
}

function batchView(row) {
  return { id: row.id, code: row.code, planId: row.plan_id, planName: row.plan_name ?? null,
    resellerId: row.reseller_id, resellerName: row.reseller_name ?? null, quantity: Number(row.quantity),
    validDays: Number(row.valid_days), expiresAt: row.expires_at, status: row.status,
    available: Number(row.available_count ?? 0), active: Number(row.active_count ?? 0), used: Number(row.used_count ?? 0),
    revoked: Number(row.revoked_count ?? 0), createdAt: row.created_at, updatedAt: row.updated_at };
}

function ticketView(row) {
  return { id: row.id, number: row.number, category: row.category, priority: row.priority, status: row.status,
    title: row.title, description: row.description, subscriberId: row.subscriber_id,
    subscriberName: row.subscriber_name ?? null, deviceId: row.device_id, deviceName: row.device_name ?? null,
    assignedUserId: row.assigned_user_id, assignedUserName: row.assigned_user_name ?? null,
    createdByUserId: row.created_by_user_id, resolvedAt: row.resolved_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

function randomCode(length, alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789") {
  const bytes = randomBytes(length);
  let output = "";
  for (let index = 0; index < length; index += 1) output += alphabet[bytes[index] % alphabet.length];
  return output;
}

async function validateSite(db, tenantId, siteId) {
  if (!siteId) return;
  const site = await db.get("SELECT id FROM network_sites WHERE id = ? AND tenant_id = ? AND status = 'active'", [siteId, tenantId]);
  if (!site) throw validationError("الموقع المختار غير صالح");
}

export class OperationalService {
  constructor({ db, config }) {
    this.db = db;
    this.config = config;
  }

  async listSites(context) {
    requirePermission(context, PERMISSIONS.SITE_READ);
    const rows = await this.db.all(`SELECT s.*,
      (SELECT COUNT(*) FROM network_devices d WHERE d.tenant_id=s.tenant_id AND d.site_id=s.id) AS device_count,
      (SELECT COUNT(*) FROM network_devices d WHERE d.tenant_id=s.tenant_id AND d.site_id=s.id AND d.status='online' AND d.last_seen_at >= ?) AS online_device_count,
      (SELECT COUNT(*) FROM radius_sessions r JOIN network_devices d ON d.id=r.device_id
        WHERE r.tenant_id=s.tenant_id AND d.site_id=s.id AND r.status='active') AS active_session_count
      FROM network_sites s WHERE s.tenant_id=? ORDER BY s.status, s.name`, [new Date(Date.now() - 60_000).toISOString(), context.tenantId]);
    return { items: rows.map(siteView) };
  }

  async createSite(context, input, db = this.db) {
    requireWrite(context, PERMISSIONS.SITE_WRITE);
    const siteId = id("sit"); const now = nowIso();
    try {
      await db.run(`INSERT INTO network_sites (id,tenant_id,name,code,address,latitude,longitude,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'active',?,?)`, [siteId, context.tenantId, input.name, input.code.toUpperCase(),
        input.address ?? null, input.latitude ?? null, input.longitude ?? null, now, now]);
    } catch (error) { rethrowUnique(error, "اسم الموقع أو رمزه مستخدم بالفعل"); }
    const row = await db.get("SELECT * FROM network_sites WHERE id=? AND tenant_id=?", [siteId, context.tenantId]);
    await writeAudit(db, context, { action: "site.create", entityType: "network_site", entityId: siteId, after: siteView(row) });
    return siteView(row);
  }

  async updateSite(context, siteId, input, db = this.db) {
    requireWrite(context, PERMISSIONS.SITE_WRITE);
    const before = await db.get("SELECT * FROM network_sites WHERE id=? AND tenant_id=?", [siteId, context.tenantId]);
    if (!before) throw notFound("الموقع غير موجود");
    const values = { name: input.name ?? before.name, code: input.code?.toUpperCase() ?? before.code,
      address: input.address === undefined ? before.address : input.address,
      latitude: input.latitude === undefined ? before.latitude : input.latitude,
      longitude: input.longitude === undefined ? before.longitude : input.longitude, status: input.status ?? before.status };
    try {
      await db.run(`UPDATE network_sites SET name=?,code=?,address=?,latitude=?,longitude=?,status=?,updated_at=? WHERE id=? AND tenant_id=?`,
        [values.name, values.code, values.address, values.latitude, values.longitude, values.status, nowIso(), siteId, context.tenantId]);
    } catch (error) { rethrowUnique(error, "اسم الموقع أو رمزه مستخدم بالفعل"); }
    const after = await db.get("SELECT * FROM network_sites WHERE id=? AND tenant_id=?", [siteId, context.tenantId]);
    await writeAudit(db, context, { action: "site.update", entityType: "network_site", entityId: siteId, reason: input.reason, before: siteView(before), after: siteView(after) });
    return siteView(after);
  }

  async topology(context) {
    requirePermission(context, PERMISSIONS.SITE_READ);
    const [sites, devices] = await Promise.all([this.listSites(context), this.db.all(`SELECT d.id,d.site_id,d.name,d.host,d.status,d.connection_method,d.last_seen_at,
      (SELECT COUNT(*) FROM radius_sessions r WHERE r.tenant_id=d.tenant_id AND r.device_id=d.id AND r.status='active') AS active_sessions
      FROM network_devices d WHERE d.tenant_id=? ORDER BY d.name`, [context.tenantId])]);
    return { sites: sites.items, devices: devices.map((row) => ({ id: row.id, siteId: row.site_id, name: row.name,
      host: row.host, status: row.status, connectionMethod: row.connection_method,
      activeSessions: Number(row.active_sessions ?? 0), lastSeenAt: row.last_seen_at })),
    links: devices.filter((row) => row.site_id).map((row) => ({ from: row.site_id, to: row.id, status: row.status === "online" ? "healthy" : "attention" })) };
  }

  async listPools(context) {
    requirePermission(context, PERMISSIONS.IP_POOL_READ);
    const rows = await this.db.all(`SELECT p.*,s.name AS site_name,
      (SELECT COUNT(*) FROM subscribers sub LEFT JOIN plans pl ON pl.id=sub.plan_id
        WHERE sub.tenant_id=p.tenant_id AND COALESCE(sub.ip_pool_id,pl.ip_pool_id)=p.id) AS assigned_subscribers
      FROM ip_pools p LEFT JOIN network_sites s ON s.id=p.site_id WHERE p.tenant_id=? ORDER BY p.status,p.name`, [context.tenantId]);
    return { items: rows.map(poolView) };
  }

  async createPool(context, input, db = this.db) {
    requireWrite(context, PERMISSIONS.IP_POOL_WRITE); await validateSite(db, context.tenantId, input.siteId);
    const poolId = id("pool"); const now = nowIso();
    try {
      await db.run(`INSERT INTO ip_pools (id,tenant_id,site_id,name,cidr,gateway,dns_json,purpose,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,'active',?,?)`, [poolId, context.tenantId, input.siteId ?? null, input.name,
        input.cidr, input.gateway ?? null, toJson(input.dns ?? []), input.purpose, now, now]);
    } catch (error) { rethrowUnique(error, "اسم تجمع العناوين أو نطاقه مستخدم بالفعل"); }
    const row = await db.get("SELECT * FROM ip_pools WHERE id=? AND tenant_id=?", [poolId, context.tenantId]);
    await writeAudit(db, context, { action: "ip_pool.create", entityType: "ip_pool", entityId: poolId, after: poolView(row) });
    return poolView(row);
  }

  async updatePool(context, poolId, input, db = this.db) {
    requireWrite(context, PERMISSIONS.IP_POOL_WRITE);
    const before = await db.get("SELECT * FROM ip_pools WHERE id=? AND tenant_id=?", [poolId, context.tenantId]);
    if (!before) throw notFound("تجمع عناوين IP غير موجود");
    const siteId = input.siteId === undefined ? before.site_id : input.siteId; await validateSite(db, context.tenantId, siteId);
    const values = { siteId, name: input.name ?? before.name, cidr: input.cidr ?? before.cidr,
      gateway: input.gateway === undefined ? before.gateway : input.gateway,
      dns: input.dns === undefined ? before.dns_json : toJson(input.dns), purpose: input.purpose ?? before.purpose,
      status: input.status ?? before.status };
    try {
      await db.run(`UPDATE ip_pools SET site_id=?,name=?,cidr=?,gateway=?,dns_json=?,purpose=?,status=?,updated_at=? WHERE id=? AND tenant_id=?`,
        [values.siteId, values.name, values.cidr, values.gateway, values.dns, values.purpose, values.status, nowIso(), poolId, context.tenantId]);
    } catch (error) { rethrowUnique(error, "اسم تجمع العناوين أو نطاقه مستخدم بالفعل"); }
    const after = await db.get("SELECT * FROM ip_pools WHERE id=? AND tenant_id=?", [poolId, context.tenantId]);
    await writeAudit(db, context, { action: "ip_pool.update", entityType: "ip_pool", entityId: poolId, reason: input.reason, before: poolView(before), after: poolView(after) });
    return poolView(after);
  }

  async listPolicies(context) {
    requirePermission(context, PERMISSIONS.POLICY_READ);
    const rows = await this.db.all(`SELECT p.*,
      (SELECT COUNT(*) FROM plans pl WHERE pl.tenant_id=p.tenant_id AND pl.policy_id=p.id) AS assigned_plans,
      (SELECT COUNT(*) FROM subscribers sub LEFT JOIN plans pl ON pl.id=sub.plan_id
        WHERE sub.tenant_id=p.tenant_id AND COALESCE(sub.policy_id,pl.policy_id)=p.id) AS assigned_subscribers
      FROM radius_policies p WHERE p.tenant_id=? ORDER BY p.status,p.name`, [context.tenantId]);
    return { items: rows.map(policyView) };
  }

  async createPolicy(context, input, db = this.db) {
    requireWrite(context, PERMISSIONS.POLICY_WRITE);
    const policyId = id("pol"); const now = nowIso();
    try {
      await db.run(`INSERT INTO radius_policies (id,tenant_id,name,auth_methods_json,simultaneous_use,idle_timeout_seconds,
        session_timeout_seconds,interim_interval_seconds,rate_limit_down_mbps,rate_limit_up_mbps,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'active',?,?)`, [policyId, context.tenantId, input.name, toJson(input.authMethods),
        input.simultaneousUse, input.idleTimeoutSeconds ?? null, input.sessionTimeoutSeconds ?? null,
        input.interimIntervalSeconds, input.rateLimitDownMbps ?? null, input.rateLimitUpMbps ?? null, now, now]);
    } catch (error) { rethrowUnique(error, "اسم السياسة مستخدم بالفعل"); }
    const row = await db.get("SELECT * FROM radius_policies WHERE id=? AND tenant_id=?", [policyId, context.tenantId]);
    await writeAudit(db, context, { action: "radius_policy.create", entityType: "radius_policy", entityId: policyId, after: policyView(row) });
    return policyView(row);
  }

  async updatePolicy(context, policyId, input, db = this.db) {
    requireWrite(context, PERMISSIONS.POLICY_WRITE);
    const before = await db.get("SELECT * FROM radius_policies WHERE id=? AND tenant_id=?", [policyId, context.tenantId]);
    if (!before) throw notFound("سياسة RADIUS غير موجودة");
    const values = { name: input.name ?? before.name,
      authMethods: input.authMethods === undefined ? before.auth_methods_json : toJson(input.authMethods),
      simultaneousUse: input.simultaneousUse ?? before.simultaneous_use,
      idleTimeoutSeconds: input.idleTimeoutSeconds === undefined ? before.idle_timeout_seconds : input.idleTimeoutSeconds,
      sessionTimeoutSeconds: input.sessionTimeoutSeconds === undefined ? before.session_timeout_seconds : input.sessionTimeoutSeconds,
      interimIntervalSeconds: input.interimIntervalSeconds ?? before.interim_interval_seconds,
      rateLimitDownMbps: input.rateLimitDownMbps === undefined ? before.rate_limit_down_mbps : input.rateLimitDownMbps,
      rateLimitUpMbps: input.rateLimitUpMbps === undefined ? before.rate_limit_up_mbps : input.rateLimitUpMbps,
      status: input.status ?? before.status };
    try {
      await db.run(`UPDATE radius_policies SET name=?,auth_methods_json=?,simultaneous_use=?,idle_timeout_seconds=?,
        session_timeout_seconds=?,interim_interval_seconds=?,rate_limit_down_mbps=?,rate_limit_up_mbps=?,status=?,updated_at=?
        WHERE id=? AND tenant_id=?`, [values.name, values.authMethods, values.simultaneousUse, values.idleTimeoutSeconds,
        values.sessionTimeoutSeconds, values.interimIntervalSeconds, values.rateLimitDownMbps, values.rateLimitUpMbps,
        values.status, nowIso(), policyId, context.tenantId]);
    } catch (error) { rethrowUnique(error, "اسم السياسة مستخدم بالفعل"); }
    const after = await db.get("SELECT * FROM radius_policies WHERE id=? AND tenant_id=?", [policyId, context.tenantId]);
    await writeAudit(db, context, { action: "radius_policy.update", entityType: "radius_policy", entityId: policyId, reason: input.reason, before: policyView(before), after: policyView(after) });
    return policyView(after);
  }

  async listResellers(context) {
    requirePermission(context, PERMISSIONS.RESELLER_READ);
    const rows = await this.db.all(`SELECT r.*,s.name AS site_name,
      (SELECT COUNT(*) FROM voucher_batches b WHERE b.tenant_id=r.tenant_id AND b.reseller_id=r.id) AS batch_count
      FROM resellers r LEFT JOIN network_sites s ON s.id=r.site_id WHERE r.tenant_id=? ORDER BY r.status,r.name`, [context.tenantId]);
    return { items: rows.map(resellerView) };
  }

  async createReseller(context, input, db = this.db) {
    requireWrite(context, PERMISSIONS.RESELLER_WRITE); await validateSite(db, context.tenantId, input.siteId);
    const resellerId = id("rsl"); const now = nowIso();
    try {
      await db.run(`INSERT INTO resellers (id,tenant_id,site_id,name,phone,email,commission_bps,status,balance_minor,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'active',0,?,?)`, [resellerId, context.tenantId, input.siteId ?? null, input.name,
        input.phone ?? null, input.email ?? null, input.commissionBps, now, now]);
    } catch (error) { rethrowUnique(error, "اسم الوكيل مستخدم بالفعل"); }
    const row = await db.get("SELECT * FROM resellers WHERE id=? AND tenant_id=?", [resellerId, context.tenantId]);
    await writeAudit(db, context, { action: "reseller.create", entityType: "reseller", entityId: resellerId, after: resellerView(row) });
    return resellerView(row);
  }

  async updateReseller(context, resellerId, input, db = this.db) {
    requireWrite(context, PERMISSIONS.RESELLER_WRITE);
    const before = await db.get("SELECT * FROM resellers WHERE id=? AND tenant_id=?", [resellerId, context.tenantId]);
    if (!before) throw notFound("الوكيل غير موجود");
    const siteId = input.siteId === undefined ? before.site_id : input.siteId; await validateSite(db, context.tenantId, siteId);
    const values = { siteId, name: input.name ?? before.name, phone: input.phone === undefined ? before.phone : input.phone,
      email: input.email === undefined ? before.email : input.email,
      commissionBps: input.commissionBps ?? before.commission_bps, status: input.status ?? before.status };
    try {
      await db.run(`UPDATE resellers SET site_id=?,name=?,phone=?,email=?,commission_bps=?,status=?,updated_at=? WHERE id=? AND tenant_id=?`,
        [values.siteId, values.name, values.phone, values.email, values.commissionBps, values.status, nowIso(), resellerId, context.tenantId]);
    } catch (error) { rethrowUnique(error, "اسم الوكيل مستخدم بالفعل"); }
    const after = await db.get("SELECT * FROM resellers WHERE id=? AND tenant_id=?", [resellerId, context.tenantId]);
    await writeAudit(db, context, { action: "reseller.update", entityType: "reseller", entityId: resellerId, reason: input.reason, before: resellerView(before), after: resellerView(after) });
    return resellerView(after);
  }

  async listVoucherBatches(context, query = {}) {
    requirePermission(context, PERMISSIONS.VOUCHER_READ); const { limit, offset } = pageFromQuery(query);
    const rows = await this.db.all(`SELECT b.*,p.name AS plan_name,r.name AS reseller_name,
      SUM(CASE WHEN v.status='available' THEN 1 ELSE 0 END) AS available_count,
      SUM(CASE WHEN v.status='active' THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN v.status='used' THEN 1 ELSE 0 END) AS used_count,
      SUM(CASE WHEN v.status='revoked' THEN 1 ELSE 0 END) AS revoked_count
      FROM voucher_batches b JOIN plans p ON p.id=b.plan_id LEFT JOIN resellers r ON r.id=b.reseller_id
      LEFT JOIN vouchers v ON v.batch_id=b.id WHERE b.tenant_id=? GROUP BY b.id,p.name,r.name
      ORDER BY b.created_at DESC LIMIT ? OFFSET ?`, [context.tenantId, limit, offset]);
    const count = await this.db.get("SELECT COUNT(*) AS total FROM voucher_batches WHERE tenant_id=?", [context.tenantId]);
    return { items: rows.map(batchView), pagination: { limit, offset, total: Number(count.total) } };
  }

  async createVoucherBatch(context, input, db = this.db) {
    requireWrite(context, PERMISSIONS.VOUCHER_WRITE);
    await requireCapacity(db, context, "subscribers", input.quantity);
    const plan = await db.get("SELECT id,name FROM plans WHERE id=? AND tenant_id=? AND status='active'", [input.planId, context.tenantId]);
    if (!plan) throw validationError("الباقة المختارة غير صالحة");
    if (input.resellerId) {
      const reseller = await db.get("SELECT id FROM resellers WHERE id=? AND tenant_id=? AND status='active'", [input.resellerId, context.tenantId]);
      if (!reseller) throw validationError("الوكيل المختار غير صالح");
    }
    const batchId = id("vbt"); const now = nowIso();
    const batchCode = input.code?.toUpperCase() ?? `B-${now.slice(0, 10).replaceAll("-", "")}-${randomCode(5)}`;
    try {
      await db.run(`INSERT INTO voucher_batches (id,tenant_id,code,plan_id,reseller_id,quantity,valid_days,expires_at,status,created_by_user_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,'active',?,?,?)`, [batchId, context.tenantId, batchCode, input.planId, input.resellerId ?? null,
        input.quantity, input.validDays, input.expiresAt ?? null, context.user.id, now, now]);
      const prefix = input.usernamePrefix?.toUpperCase() ?? "UCR";
      for (let index = 0; index < input.quantity; index += 1) {
        let username;
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const candidate = `${prefix}-${randomCode(8)}`;
          const collision = await db.get(`SELECT username FROM subscribers WHERE tenant_id=? AND username=?
            UNION ALL SELECT username FROM vouchers WHERE tenant_id=? AND username=? LIMIT 1`, [context.tenantId, candidate, context.tenantId, candidate]);
          if (!collision) { username = candidate; break; }
        }
        if (!username) throw conflict("تعذر إنشاء أسماء بطاقات فريدة؛ أعد المحاولة");
        const password = randomCode(12, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789");
        await db.run(`INSERT INTO vouchers (id,tenant_id,batch_id,username,secret_ciphertext,status,subscriber_id,activated_at,expires_at,created_at,updated_at)
          VALUES (?,?,?,?,?,'available',NULL,NULL,?,?,?)`, [id("vch"), context.tenantId, batchId, username,
          encryptSecret(password, this.config.encryptionKey), input.expiresAt ?? null, now, now]);
      }
    } catch (error) { rethrowUnique(error, "رمز الدفعة مستخدم بالفعل؛ أعد المحاولة"); }
    await writeAudit(db, context, { action: "voucher_batch.create", entityType: "voucher_batch", entityId: batchId,
      after: { code: batchCode, planId: input.planId, resellerId: input.resellerId ?? null, quantity: input.quantity, validDays: input.validDays } });
    return { id: batchId, code: batchCode, planId: input.planId, planName: plan.name, quantity: input.quantity,
      validDays: input.validDays, status: "active", credentialsReadyForExport: true };
  }

  async voucherBatch(context, batchId) {
    requirePermission(context, PERMISSIONS.VOUCHER_READ);
    const row = await this.db.get(`SELECT b.*,p.name AS plan_name,r.name AS reseller_name,
      (SELECT COUNT(*) FROM vouchers v WHERE v.batch_id=b.id AND v.status='available') AS available_count,
      (SELECT COUNT(*) FROM vouchers v WHERE v.batch_id=b.id AND v.status='active') AS active_count,
      (SELECT COUNT(*) FROM vouchers v WHERE v.batch_id=b.id AND v.status='used') AS used_count,
      (SELECT COUNT(*) FROM vouchers v WHERE v.batch_id=b.id AND v.status='revoked') AS revoked_count
      FROM voucher_batches b JOIN plans p ON p.id=b.plan_id LEFT JOIN resellers r ON r.id=b.reseller_id
      WHERE b.id=? AND b.tenant_id=?`, [batchId, context.tenantId]);
    if (!row) throw notFound("دفعة البطاقات غير موجودة");
    const vouchers = await this.db.all(`SELECT id,username,status,subscriber_id,activated_at,expires_at,created_at,updated_at
      FROM vouchers WHERE batch_id=? AND tenant_id=? ORDER BY created_at,username`, [batchId, context.tenantId]);
    return { ...batchView(row), vouchers: vouchers.map((item) => ({ id: item.id, username: item.username, status: item.status,
      subscriberId: item.subscriber_id, activatedAt: item.activated_at, expiresAt: item.expires_at,
      createdAt: item.created_at, updatedAt: item.updated_at })) };
  }

  async exportVoucherBatch(context, batchId, reason, db = this.db) {
    requireWrite(context, PERMISSIONS.VOUCHER_WRITE);
    const batch = await db.get(`SELECT b.id,b.code,b.valid_days,b.expires_at,p.name AS plan_name FROM voucher_batches b
      JOIN plans p ON p.id=b.plan_id WHERE b.id=? AND b.tenant_id=?`, [batchId, context.tenantId]);
    if (!batch) throw notFound("دفعة البطاقات غير موجودة");
    const rows = await db.all(`SELECT id,username,secret_ciphertext,status,expires_at FROM vouchers
      WHERE batch_id=? AND tenant_id=? AND status<>'revoked' ORDER BY created_at,username`, [batchId, context.tenantId]);
    const vouchers = rows.map((row) => ({ id: row.id, username: row.username,
      password: decryptSecret(row.secret_ciphertext, this.config.encryptionKey), status: row.status,
      validDays: Number(batch.valid_days), expiresAt: row.expires_at ?? batch.expires_at }));
    await writeAudit(db, context, { action: "voucher_batch.credentials.export", entityType: "voucher_batch", entityId: batchId,
      reason, after: { code: batch.code, count: vouchers.length } });
    return { batchId, code: batch.code, planName: batch.plan_name, exportedAt: nowIso(), vouchers };
  }

  async revokeVoucher(context, voucherId, reason, db = this.db) {
    requireWrite(context, PERMISSIONS.VOUCHER_WRITE);
    const before = await db.get("SELECT id,username,status FROM vouchers WHERE id=? AND tenant_id=?", [voucherId, context.tenantId]);
    if (!before) throw notFound("البطاقة غير موجودة");
    if (before.status === "used") throw conflict("لا يمكن إلغاء بطاقة مستخدمة ومنتهية");
    if (before.status === "revoked") return { id: voucherId, status: "revoked", changed: false };
    await db.run("UPDATE vouchers SET status='revoked',updated_at=? WHERE id=? AND tenant_id=?", [nowIso(), voucherId, context.tenantId]);
    await writeAudit(db, context, { action: "voucher.revoke", entityType: "voucher", entityId: voucherId, reason,
      before: { username: before.username, status: before.status }, after: { status: "revoked" } });
    return { id: voucherId, status: "revoked", changed: true };
  }

  async listTickets(context, query = {}) {
    requirePermission(context, PERMISSIONS.SUPPORT_READ); const { limit, offset } = pageFromQuery(query);
    const conditions = ["t.tenant_id=?"]; const params = [context.tenantId];
    if (query.status && query.status !== "all") { conditions.push("t.status=?"); params.push(query.status); }
    if (query.priority && query.priority !== "all") { conditions.push("t.priority=?"); params.push(query.priority); }
    const where = conditions.join(" AND ");
    const rows = await this.db.all(`SELECT t.*,s.full_name AS subscriber_name,d.name AS device_name,u.display_name AS assigned_user_name
      FROM support_tickets t LEFT JOIN subscribers s ON s.id=t.subscriber_id LEFT JOIN network_devices d ON d.id=t.device_id
      LEFT JOIN users u ON u.id=t.assigned_user_id WHERE ${where}
      ORDER BY CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,t.updated_at DESC
      LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const count = await this.db.get(`SELECT COUNT(*) AS total FROM support_tickets t WHERE ${where}`, params);
    return { items: rows.map(ticketView), pagination: { limit, offset, total: Number(count.total) } };
  }

  async createTicket(context, input, db = this.db) {
    requireWrite(context, PERMISSIONS.SUPPORT_WRITE);
    if (input.subscriberId && !await db.get("SELECT id FROM subscribers WHERE id=? AND tenant_id=?", [input.subscriberId, context.tenantId])) throw validationError("المشترك المختار غير صالح");
    if (input.deviceId && !await db.get("SELECT id FROM network_devices WHERE id=? AND tenant_id=?", [input.deviceId, context.tenantId])) throw validationError("الجهاز المختار غير صالح");
    const ticketId = id("tkt"); const number = `SUP-${new Date().getUTCFullYear()}-${randomCode(6)}`; const now = nowIso();
    await db.run(`INSERT INTO support_tickets (id,tenant_id,number,category,priority,status,title,description,subscriber_id,device_id,
      assigned_user_id,created_by_user_id,resolved_at,created_at,updated_at) VALUES (?,?,?,?,?,'open',?,?,?,?,NULL,?,NULL,?,?)`,
    [ticketId, context.tenantId, number, input.category, input.priority, input.title, input.description,
      input.subscriberId ?? null, input.deviceId ?? null, context.user.id, now, now]);
    await db.run(`INSERT INTO support_ticket_events (id,tenant_id,ticket_id,actor_user_id,event_type,body,created_at)
      VALUES (?,?,?,?,'created',?,?)`, [id("tev"), context.tenantId, ticketId, context.user.id, input.description, now]);
    await writeAudit(db, context, { action: "support_ticket.create", entityType: "support_ticket", entityId: ticketId,
      after: { number, title: input.title, category: input.category, priority: input.priority } });
    return ticketView(await db.get("SELECT * FROM support_tickets WHERE id=? AND tenant_id=?", [ticketId, context.tenantId]));
  }

  async ticket(context, ticketId) {
    requirePermission(context, PERMISSIONS.SUPPORT_READ);
    const row = await this.db.get(`SELECT t.*,s.full_name AS subscriber_name,d.name AS device_name,u.display_name AS assigned_user_name
      FROM support_tickets t LEFT JOIN subscribers s ON s.id=t.subscriber_id LEFT JOIN network_devices d ON d.id=t.device_id
      LEFT JOIN users u ON u.id=t.assigned_user_id WHERE t.id=? AND t.tenant_id=?`, [ticketId, context.tenantId]);
    if (!row) throw notFound("تذكرة الدعم غير موجودة");
    const events = await this.db.all(`SELECT e.id,e.event_type,e.body,e.created_at,u.display_name AS actor_name
      FROM support_ticket_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.ticket_id=? AND e.tenant_id=? ORDER BY e.created_at`,
    [ticketId, context.tenantId]);
    return { ...ticketView(row), events: events.map((event) => ({ id: event.id, eventType: event.event_type,
      body: event.body, actorName: event.actor_name, createdAt: event.created_at })) };
  }

  async addTicketMessage(context, ticketId, body, db = this.db) {
    requireWrite(context, PERMISSIONS.SUPPORT_WRITE);
    const ticket = await db.get("SELECT id,status FROM support_tickets WHERE id=? AND tenant_id=?", [ticketId, context.tenantId]);
    if (!ticket) throw notFound("تذكرة الدعم غير موجودة");
    if (ticket.status === "closed") throw conflict("التذكرة مغلقة؛ أعد فتحها قبل إضافة رد");
    const eventId = id("tev"); const now = nowIso();
    await db.run(`INSERT INTO support_ticket_events (id,tenant_id,ticket_id,actor_user_id,event_type,body,created_at)
      VALUES (?,?,?,?,'message',?,?)`, [eventId, context.tenantId, ticketId, context.user.id, body, now]);
    await db.run("UPDATE support_tickets SET status=CASE WHEN status='open' THEN 'in_progress' ELSE status END,updated_at=? WHERE id=? AND tenant_id=?",
      [now, ticketId, context.tenantId]);
    await writeAudit(db, context, { action: "support_ticket.message", entityType: "support_ticket", entityId: ticketId, after: { eventId } });
    return { id: eventId, ticketId, body, createdAt: now };
  }

  async updateTicket(context, ticketId, input, db = this.db) {
    requireWrite(context, PERMISSIONS.SUPPORT_WRITE);
    const before = await db.get("SELECT * FROM support_tickets WHERE id=? AND tenant_id=?", [ticketId, context.tenantId]);
    if (!before) throw notFound("تذكرة الدعم غير موجودة");
    if (input.assignedUserId && !await db.get("SELECT user_id FROM memberships WHERE tenant_id=? AND user_id=? AND status='active'", [context.tenantId, input.assignedUserId])) throw validationError("الموظف المختار ليس عضواً فعالاً");
    const status = input.status ?? before.status;
    const priority = input.priority ?? before.priority;
    const assignedUserId = input.assignedUserId === undefined ? before.assigned_user_id : input.assignedUserId;
    const now = nowIso(); const resolvedAt = ["resolved", "closed"].includes(status) ? before.resolved_at ?? now : null;
    await db.run(`UPDATE support_tickets SET status=?,priority=?,assigned_user_id=?,resolved_at=?,updated_at=? WHERE id=? AND tenant_id=?`,
      [status, priority, assignedUserId, resolvedAt, now, ticketId, context.tenantId]);
    const details = [];
    const states = { open: "مفتوحة", in_progress: "قيد المعالجة", resolved: "محلولة", closed: "مغلقة" };
    const priorities = { low: "منخفضة", medium: "متوسطة", high: "عالية", critical: "حرجة" };
    if (status !== before.status) details.push(`الحالة: ${states[before.status]} ← ${states[status]}`);
    if (priority !== before.priority) details.push(`الأولوية: ${priorities[before.priority]} ← ${priorities[priority]}`);
    if (assignedUserId !== before.assigned_user_id) details.push(assignedUserId ? "تم تحديث المسؤول" : "تم إلغاء تعيين المسؤول");
    details.push(`السبب: ${input.reason}`);
    await db.run(`INSERT INTO support_ticket_events (id,tenant_id,ticket_id,actor_user_id,event_type,body,created_at)
      VALUES (?,?,?,?,'status',?,?)`, [id("tev"), context.tenantId, ticketId, context.user.id, details.join(" · "), now]);
    await writeAudit(db, context, { action: "support_ticket.update", entityType: "support_ticket", entityId: ticketId, reason: input.reason,
      before: { status: before.status, priority: before.priority, assignedUserId: before.assigned_user_id }, after: { status, priority, assignedUserId } });
    return { id: ticketId, status, priority, assignedUserId, resolvedAt };
  }

  async radiusOverview(context) {
    requirePermission(context, PERMISSIONS.INTEGRATION_READ); const since = new Date(Date.now() - 86_400_000).toISOString();
    const [integration, auth, accounting, sessions, devices, agents] = await Promise.all([
      this.db.get("SELECT status,secret_ciphertext,last_seen_at,last_error FROM integrations WHERE tenant_id=? AND type='radius'", [context.tenantId]),
      this.db.get(`SELECT COUNT(*) AS total,SUM(CASE WHEN result='accept' THEN 1 ELSE 0 END) AS accepted,
        SUM(CASE WHEN result='reject' THEN 1 ELSE 0 END) AS rejected FROM radius_auth_events WHERE tenant_id=? AND occurred_at>=?`, [context.tenantId, since]),
      this.db.get("SELECT COUNT(*) AS total FROM radius_accounting_events WHERE tenant_id=? AND occurred_at>=?", [context.tenantId, since]),
      this.db.get("SELECT COUNT(*) AS total FROM radius_sessions WHERE tenant_id=? AND status='active'", [context.tenantId]),
      this.db.get("SELECT COUNT(*) AS total,SUM(CASE WHEN status='online' AND last_seen_at >= ? THEN 1 ELSE 0 END) AS online FROM network_devices WHERE tenant_id=?", [new Date(Date.now() - 60_000).toISOString(), context.tenantId]),
      this.db.get(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status IN ('healthy','degraded') AND last_seen_at >= ? THEN 1 ELSE 0 END) AS online,
        SUM(CASE WHEN status='degraded' AND last_seen_at >= ? THEN 1 ELSE 0 END) AS degraded
        FROM radius_nodes WHERE tenant_id=?`,
        [new Date(Date.now() - 45_000).toISOString(), new Date(Date.now() - 45_000).toISOString(), context.tenantId])
    ]);
    return { status: integration?.status ?? "not_configured",
      credentialConfigured: Boolean(integration?.secret_ciphertext),
      agentConnected: Number(agents?.online ?? 0) > 0,
      agentsTotal: Number(agents?.total ?? 0), agentsOnline: Number(agents?.online ?? 0),
      agentsDegraded: Number(agents?.degraded ?? 0),
      lastSeenAt: integration?.last_seen_at ?? null,
      lastError: integration?.last_error ?? null, activeSessions: Number(sessions?.total ?? 0), devices: Number(devices?.total ?? 0),
      onlineDevices: Number(devices?.online ?? 0), last24Hours: { authenticationRequests: Number(auth?.total ?? 0),
        accepted: Number(auth?.accepted ?? 0), rejected: Number(auth?.rejected ?? 0), accountingEvents: Number(accounting?.total ?? 0) } };
  }

  async sessionsTimeline(context, requestedPeriod = "day") {
    requirePermission(context, PERMISSIONS.REPORT_READ);
    if (requestedPeriod !== "day" && requestedPeriod !== "week") {
      throw validationError("الفترة المطلوبة غير مدعومة");
    }
    // Actual session starts, not an interpolated illustration or a guess
    // about historical concurrency. UTC buckets are explicit in the response.
    const hourly = requestedPeriod === "day";
    const step = hourly ? 3_600_000 : 86_400_000;
    const end = new Date();
    if (hourly) end.setUTCMinutes(0, 0, 0);
    else end.setUTCHours(0, 0, 0, 0);
    const first = new Date(end.getTime() - step * (hourly ? 23 : 6));
    const chars = hourly ? 13 : 10;
    // PostgreSQL stores TIMESTAMPTZ; SQLite stores ISO text. Always aggregate
    // in UTC and never apply substr() to PostgreSQL timestamp columns.
    const bucketSql = this.db.driver === "postgres"
      ? `to_char(started_at AT TIME ZONE 'UTC', '${hourly ? 'YYYY-MM-DD"T"HH24' : 'YYYY-MM-DD'}')`
      : `substr(started_at, 1, ${chars})`;
    const records = await this.db.all(
      `SELECT ${bucketSql} AS bucket, COUNT(*) AS started
       FROM radius_sessions WHERE tenant_id=? AND started_at >= ?
       GROUP BY ${bucketSql} ORDER BY bucket`,
      [context.tenantId, first.toISOString()]
    );
    const counts = new Map(records.map(row => [row.bucket, Number(row.started)]));
    const buckets = Array.from({ length: hourly ? 24 : 7 }, (_, index) => {
      const at = new Date(first.getTime() + step * index).toISOString();
      return { at, starts: counts.get(at.slice(0, chars)) ?? 0 };
    });
    return { period: requestedPeriod, timeZone: "UTC", metric: "session_starts",
      totalStarts: buckets.reduce((sum, item) => sum + item.starts, 0), buckets };
  }

  async radiusNodes(context) {
    requirePermission(context, PERMISSIONS.INTEGRATION_READ);
    const rows = await this.db.all(`SELECT n.*,s.name AS site_name FROM radius_nodes n
      LEFT JOIN network_sites s ON s.id=n.site_id WHERE n.tenant_id=? ORDER BY
      CASE n.role WHEN 'primary' THEN 1 WHEN 'replica' THEN 2 ELSE 3 END,n.name`, [context.tenantId]);
    const offlineBefore = Date.now() - 45_000;
    return { items: rows.map((row) => {
      const status = new Date(row.last_seen_at).getTime() < offlineBefore ? "offline" : row.status;
      return { id: row.id, agentId: row.agent_id, siteId: row.site_id, siteName: row.site_name ?? null,
        name: row.name, role: row.role, endpoint: row.endpoint, status, version: row.version,
        cachedPrincipals: Number(row.cached_principals), pendingAccounting: Number(row.pending_accounting),
        pendingAuth: Number(row.pending_auth), directorySyncedAt: row.last_directory_sync_at,
        lastError: row.last_error, lastSeenAt: row.last_seen_at, createdAt: row.created_at, updatedAt: row.updated_at };
    }) };
  }

  async listAuthEvents(context, query = {}) {
    requirePermission(context, PERMISSIONS.INTEGRATION_READ); const { limit, offset } = pageFromQuery(query);
    const params = [context.tenantId]; let where = "e.tenant_id=?";
    if (query.result && query.result !== "all") { where += " AND e.result=?"; params.push(query.result); }
    const rows = await this.db.all(`SELECT e.*,s.full_name AS subscriber_name,d.name AS device_name FROM radius_auth_events e
      LEFT JOIN subscribers s ON s.id=e.subscriber_id LEFT JOIN network_devices d ON d.id=e.device_id
      WHERE ${where} ORDER BY e.occurred_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const count = await this.db.get(`SELECT COUNT(*) AS total FROM radius_auth_events e WHERE ${where}`, params);
    return { items: rows.map((row) => ({ id: row.id, eventId: row.event_id, requestId: row.request_id,
      username: row.username, subscriberId: row.subscriber_id, subscriberName: row.subscriber_name,
      deviceId: row.device_id, deviceName: row.device_name, nasIp: row.nas_ip, clientIp: row.client_ip,
      result: row.result, reason: row.reason, latencyMs: numberOrNull(row.latency_ms), occurredAt: row.occurred_at,
      receivedAt: row.received_at })), pagination: { limit, offset, total: Number(count.total) } };
  }

  async listAccountingEvents(context, query = {}) {
    requirePermission(context, PERMISSIONS.INTEGRATION_READ); const { limit, offset } = pageFromQuery(query);
    const rows = await this.db.all(`SELECT e.*,s.full_name AS subscriber_name,d.name AS device_name FROM radius_accounting_events e
      LEFT JOIN subscribers s ON s.id=e.subscriber_id LEFT JOIN network_devices d ON d.id=e.device_id
      WHERE e.tenant_id=? ORDER BY e.occurred_at DESC LIMIT ? OFFSET ?`, [context.tenantId, limit, offset]);
    const count = await this.db.get("SELECT COUNT(*) AS total FROM radius_accounting_events WHERE tenant_id=?", [context.tenantId]);
    return { items: rows.map((row) => ({ id: row.id, eventId: row.event_id, sessionId: row.session_id,
      statusType: row.status_type, username: row.username, subscriberId: row.subscriber_id, subscriberName: row.subscriber_name,
      deviceId: row.device_id, deviceName: row.device_name, framedIp: row.framed_ip, nasIp: row.nas_ip,
      inputBytes: Number(row.input_bytes), outputBytes: Number(row.output_bytes), terminateCause: row.terminate_cause,
      occurredAt: row.occurred_at, receivedAt: row.received_at })), pagination: { limit, offset, total: Number(count.total) } };
  }

  async integrations(context) {
    requirePermission(context, PERMISSIONS.INTEGRATION_READ);
    const rows = await this.db.all(`SELECT id,type,status,config_json,last_error,last_seen_at,created_at,updated_at
      FROM integrations WHERE tenant_id=? ORDER BY type`, [context.tenantId]);
    return { items: rows.map((row) => ({ id: row.id, type: row.type, status: row.status,
      config: parseJson(row.config_json, {}), lastError: row.last_error, lastSeenAt: row.last_seen_at,
      createdAt: row.created_at, updatedAt: row.updated_at })) };
  }

  async reports(context, query = {}) {
    requirePermission(context, PERMISSIONS.REPORT_READ);
    const from = query.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString(); const to = query.to ?? nowIso();
    const [subscribers, sessions, traffic, invoices, payments, tickets, auth] = await Promise.all([
      this.db.get(`SELECT COUNT(*) AS total,SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status IN ('suspended','expired') THEN 1 ELSE 0 END) AS attention FROM subscribers WHERE tenant_id=?`, [context.tenantId]),
      this.db.get(`SELECT COUNT(*) AS total,SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active FROM radius_sessions
        WHERE tenant_id=? AND started_at BETWEEN ? AND ?`, [context.tenantId, from, to]),
      this.db.get(`SELECT COALESCE(SUM(input_bytes),0) AS input_bytes,COALESCE(SUM(output_bytes),0) AS output_bytes
        FROM radius_accounting_events WHERE tenant_id=? AND occurred_at BETWEEN ? AND ?`, [context.tenantId, from, to]),
      this.db.get(`SELECT COUNT(*) AS total,COALESCE(SUM(amount_minor),0) AS billed_minor,COALESCE(SUM(paid_minor),0) AS paid_minor
        FROM invoices WHERE tenant_id=? AND created_at BETWEEN ? AND ?`, [context.tenantId, from, to]),
      this.db.get(`SELECT COUNT(*) AS total,COALESCE(SUM(amount_minor),0) AS collected_minor FROM payments
        WHERE tenant_id=? AND created_at BETWEEN ? AND ?`, [context.tenantId, from, to]),
      this.db.get(`SELECT COUNT(*) AS total,SUM(CASE WHEN status IN ('open','in_progress') THEN 1 ELSE 0 END) AS open
        FROM support_tickets WHERE tenant_id=? AND created_at BETWEEN ? AND ?`, [context.tenantId, from, to]),
      this.db.get(`SELECT COUNT(*) AS total,SUM(CASE WHEN result='accept' THEN 1 ELSE 0 END) AS accepted,
        SUM(CASE WHEN result='reject' THEN 1 ELSE 0 END) AS rejected FROM radius_auth_events
        WHERE tenant_id=? AND occurred_at BETWEEN ? AND ?`, [context.tenantId, from, to])
    ]);
    return { range: { from, to }, subscribers: { total: Number(subscribers?.total ?? 0), active: Number(subscribers?.active ?? 0), attention: Number(subscribers?.attention ?? 0) },
      sessions: { total: Number(sessions?.total ?? 0), active: Number(sessions?.active ?? 0) },
      traffic: { inputBytes: Number(traffic?.input_bytes ?? 0), outputBytes: Number(traffic?.output_bytes ?? 0) },
      billing: { invoices: Number(invoices?.total ?? 0), billedMinor: Number(invoices?.billed_minor ?? 0), invoicePaidMinor: Number(invoices?.paid_minor ?? 0), payments: Number(payments?.total ?? 0), collectedMinor: Number(payments?.collected_minor ?? 0) },
      support: { tickets: Number(tickets?.total ?? 0), open: Number(tickets?.open ?? 0) },
      authentication: { total: Number(auth?.total ?? 0), accepted: Number(auth?.accepted ?? 0), rejected: Number(auth?.rejected ?? 0) } };
  }
}
