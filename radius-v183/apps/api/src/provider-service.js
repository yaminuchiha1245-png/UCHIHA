import { PERMISSIONS } from "@uchiha-radius/contracts";
import { createOpaqueToken, decryptSecret, encryptSecret, hashActivationCode } from "./security.js";
import { AppError, forbidden, notFound, validationError } from "./errors.js";
import { requireCapacity, requirePermission, requireWrite } from "./guards.js";
import { writeAudit } from "./audit.js";
import { connectionDiagnostics } from "./device-diagnostics.js";
import { addDays, id, nowIso, pageFromQuery, parseJson, timestampMillis, toJson } from "./utils.js";
import { calculateSubscriberUsage } from "./quota.js";
import { readAccessProfile, saveAccessProfile } from "./subscriber-access-profile.js";
import { lockDeviceEndpoint } from "./device-endpoint-lock.js";

function planView(row) {
  return {
    id: row.id,
    policyId: row.policy_id ?? null,
    ipPoolId: row.ip_pool_id ?? null,
    name: row.name,
    speedDownMbps: row.speed_down_mbps,
    speedUpMbps: row.speed_up_mbps,
    priceMinor: row.price_minor,
    billingCycle: row.billing_cycle,
    quotaBytes: row.quota_bytes === null ? null : Number(row.quota_bytes),
    quotaPeriod: row.quota_period ?? "none",
    quotaAction: row.quota_action ?? "block",
    throttleDownMbps: row.throttle_down_mbps === null ? null : Number(row.throttle_down_mbps),
    throttleUpMbps: row.throttle_up_mbps === null ? null : Number(row.throttle_up_mbps),
    durationDays: Number(row.duration_days ?? 30),
    simultaneousUse: Number(row.simultaneous_use ?? 1),
    scopeType: row.scope_type ?? "all",
    scopeId: row.scope_id ?? null,
    status: row.status
  };
}

function subscriberView(row) {
  return {
    id: row.id,
    username: row.username,
    policyId: row.policy_id ?? null,
    ipPoolId: row.ip_pool_id ?? null,
    credentialConfigured: Boolean(row.radius_secret_ciphertext),
    credentialVersion: Number(row.credential_version ?? 0),
    fullName: row.full_name,
    phone: row.phone,
    address: row.address,
    status: row.status,
    balanceMinor: row.balance_minor,
    serviceExpiresAt: row.service_expires_at,
    plan: row.plan_name ? {
      id: row.plan_id,
      name: row.plan_name,
      speedDownMbps: row.speed_down_mbps,
      speedUpMbps: row.speed_up_mbps,
      priceMinor: row.plan_price_minor,
      quotaBytes: row.quota_bytes === null ? null : Number(row.quota_bytes),
      quotaPeriod: row.quota_period ?? "none",
      quotaAction: row.quota_action ?? "block",
      durationDays: Number(row.duration_days ?? 30)
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizedPlanValues(input, before = {}) {
  const values = {
    name: input.name ?? before.name,
    speedDownMbps: input.speedDownMbps ?? before.speed_down_mbps,
    speedUpMbps: input.speedUpMbps ?? before.speed_up_mbps,
    priceMinor: input.priceMinor ?? before.price_minor,
    billingCycle: input.billingCycle ?? before.billing_cycle ?? "monthly",
    policyId: input.policyId === undefined ? before.policy_id ?? null : input.policyId,
    ipPoolId: input.ipPoolId === undefined ? before.ip_pool_id ?? null : input.ipPoolId,
    quotaBytes: input.quotaBytes === undefined ? before.quota_bytes ?? null : input.quotaBytes,
    quotaPeriod: input.quotaPeriod ?? before.quota_period ?? "none",
    quotaAction: input.quotaAction ?? before.quota_action ?? "block",
    throttleDownMbps: input.throttleDownMbps === undefined ? before.throttle_down_mbps ?? null : input.throttleDownMbps,
    throttleUpMbps: input.throttleUpMbps === undefined ? before.throttle_up_mbps ?? null : input.throttleUpMbps,
    durationDays: input.durationDays ?? before.duration_days ?? 30,
    simultaneousUse: input.simultaneousUse ?? before.simultaneous_use ?? 1,
    scopeType: input.scopeType ?? before.scope_type ?? "all",
    scopeId: input.scopeId === undefined ? before.scope_id ?? null : input.scopeId,
    status: input.status ?? before.status ?? "active"
  };
  if (values.quotaPeriod === "none") {
    values.quotaBytes = null;
    values.quotaAction = "block";
    values.throttleDownMbps = null;
    values.throttleUpMbps = null;
  } else if (!Number.isFinite(Number(values.quotaBytes)) || Number(values.quotaBytes) <= 0) {
    throw validationError("حدد حجم الحصة للباقة");
  }
  if (values.quotaAction === "throttle" &&
      (!Number.isFinite(Number(values.throttleDownMbps)) || Number(values.throttleDownMbps) <= 0 ||
       !Number.isFinite(Number(values.throttleUpMbps)) || Number(values.throttleUpMbps) <= 0)) {
    throw validationError("حدد سرعة التنزيل والرفع بعد انتهاء الحصة");
  }
  if (values.quotaAction === "block") {
    values.throttleDownMbps = null;
    values.throttleUpMbps = null;
  }
  if (values.scopeType === "all") values.scopeId = null;
  if (values.scopeType !== "all" && !values.scopeId) throw validationError("حدد الراوتر أو الفرع الذي تطبق عليه الباقة");
  return values;
}

async function validatePlanReferences(db, tenantId, values) {
  if (values.policyId) {
    const policy = await db.get("SELECT id FROM radius_policies WHERE id = ? AND tenant_id = ? AND status = 'active'", [values.policyId, tenantId]);
    if (!policy) throw validationError("سياسة RADIUS المختارة غير صالحة");
  }
  if (values.ipPoolId) {
    const pool = await db.get("SELECT id FROM ip_pools WHERE id = ? AND tenant_id = ? AND status = 'active'", [values.ipPoolId, tenantId]);
    if (!pool) throw validationError("تجمع عناوين IP المختار غير صالح");
  }
  if (values.scopeType === "device") {
    const device = await db.get("SELECT id FROM network_devices WHERE id = ? AND tenant_id = ?", [values.scopeId, tenantId]);
    if (!device) throw validationError("الراوتر المحدد للباقة غير موجود");
  }
  if (values.scopeType === "site") {
    const site = await db.get("SELECT id FROM network_sites WHERE id = ? AND tenant_id = ? AND status = 'active'", [values.scopeId, tenantId]);
    if (!site) throw validationError("الفرع المحدد للباقة غير موجود");
  }
}

async function subscriberViewWithUsage(db, tenantId, timeZone, row) {
  const profile = await readAccessProfile(db, tenantId, row.id);
  const view = { ...subscriberView(row), accessProfile: profile };
  const usage = await calculateSubscriberUsage(db, {
    tenantId,
    subscriberId: row.id,
    quotaBytes: profile?.dailyQuotaBytes ?? row.quota_bytes,
    quotaPeriod: profile?.dailyQuotaBytes != null ? "daily" : row.quota_period,
    timeZone
  });
  return { ...view, usage };
}

async function queueSubscriberDirectoryRefresh(db, tenantId, subscriberId) {
  const now = nowIso();
  await db.run(`INSERT INTO outbox
    (id,tenant_id,topic,payload_json,status,attempts,available_at,locked_at,last_error,created_at,updated_at)
    VALUES (?,?,'radius.directory.refresh',?,'pending',0,?,NULL,NULL,?,?)`,
    [id("job"),tenantId,toJson({subscriberId,reason:"subscriber_access_changed"}),now,now,now]);
}

function checkoutStatus(row, adapterConfigured) {
  if (row?.checkout_url && (!row.checkout_expires_at || timestampMillis(row.checkout_expires_at) > Date.now())) return "ready";
  return adapterConfigured ? "processing" : "manual_review";
}

export class ProviderService {
  constructor({ db, config }) {
    this.db = db;
    this.config = config;
  }

  async dashboard(context) {
    requirePermission(context, PERMISSIONS.TENANT_READ);
    const tenantId = context.tenantId;
    const [subscribers, activeSessions, invoices, alerts, devices] = await Promise.all([
      this.db.get(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status IN ('suspended', 'expired') THEN 1 ELSE 0 END) AS attention
        FROM subscribers WHERE tenant_id = ?`, [tenantId]),
      this.db.get("SELECT COUNT(*) AS total FROM radius_sessions WHERE tenant_id = ? AND status = 'active'", [tenantId]),
      this.db.get(`SELECT COUNT(*) AS total, COALESCE(SUM(amount_minor - paid_minor), 0) AS outstanding_minor
        FROM invoices WHERE tenant_id = ? AND status IN ('unpaid', 'partial', 'overdue')`, [tenantId]),
      this.db.all(`SELECT id, severity, category, title, body, status, created_at
        FROM alerts WHERE tenant_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 5`, [tenantId]),
      this.db.get(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'online' AND last_seen_at >= ? THEN 1 ELSE 0 END) AS online
        FROM network_devices WHERE tenant_id = ?`, [new Date(Date.now() - 60_000).toISOString(), tenantId])
    ]);
    return {
      tenant: { id: tenantId, name: context.tenantName },
      subscription: context.subscription,
      canWrite: context.canWrite,
      metrics: {
        subscribers: Number(subscribers?.total ?? 0),
        activeSubscribers: Number(subscribers?.active ?? 0),
        subscribersNeedingAttention: Number(subscribers?.attention ?? 0),
        activeSessions: Number(activeSessions?.total ?? 0),
        openInvoices: Number(invoices?.total ?? 0),
        outstandingMinor: Number(invoices?.outstanding_minor ?? 0),
        devices: Number(devices?.total ?? 0),
        onlineDevices: Number(devices?.online ?? 0)
      },
      alerts: alerts.map((row) => ({
        id: row.id, severity: row.severity, category: row.category, title: row.title,
        body: row.body, status: row.status, createdAt: row.created_at
      }))
    };
  }

  async redeemActivationCode(context, activationCode, db = this.db) {
    if (!context?.user?.id || !context.installationHash) throw validationError("يلزم تشغيل الطلب من تثبيت التطبيق الحالي");
    const codeHash = hashActivationCode(activationCode);
    if (db.driver === "postgres") {
      await db.get("SELECT pg_advisory_xact_lock(hashtextextended(?, 0)) AS locked", [`activation:${codeHash}`]);
    }
    const code = await db.get(`SELECT ac.*, p.code AS product_code, p.name_ar AS product_name, p.limits_json
      FROM activation_codes ac JOIN subscription_products p ON p.id = ac.product_id
      WHERE ac.code_hash = ?`, [codeHash]);
    const now = nowIso();
    if (!code || code.status !== "active") throw validationError("كود التفعيل غير صالح أو استُخدم سابقًا");
    if (timestampMillis(code.expires_at) <= timestampMillis(now)) throw validationError("انتهت صلاحية إدخال كود التفعيل");
    if (!context.memberships.some((membership) => membership.tenantId === code.tenant_id)) {
      throw validationError("كود التفعيل لا يخص شبكة مرتبطة بهذا الحساب");
    }
    if (code.issued_to_email && code.issued_to_email.toLowerCase() !== context.user.email.toLowerCase()) {
      throw validationError("كود التفعيل صادر لحساب مختلف");
    }
    const installation = await db.get("SELECT * FROM app_installations WHERE installation_hash = ?", [context.installationHash]);
    if (!installation || installation.status !== "active" || (installation.user_id && installation.user_id !== context.user.id)) {
      throw validationError("تعذر ربط كود التفعيل بهذا التثبيت");
    }
    if (installation.tenant_id && installation.tenant_id !== code.tenant_id) {
      throw validationError("هذا التثبيت مرتبط مسبقًا بشبكة أخرى");
    }

    const subscriptionId = id("sub");
    const endsAt = addDays(now, Number(code.duration_days));
    await db.run(`UPDATE tenant_subscriptions SET status = 'canceled', ends_at = COALESCE(ends_at, ?), updated_at = ?
      WHERE tenant_id = ? AND status IN ('trialing', 'active', 'grace')`, [now, now, code.tenant_id]);
    await db.run(`INSERT INTO tenant_subscriptions
      (id, tenant_id, product_id, status, provider, external_id, starts_at, ends_at, created_at, updated_at)
      VALUES (?, ?, ?, 'active', 'activation_code', ?, ?, ?, ?, ?)`, [
      subscriptionId, code.tenant_id, code.product_id, code.id, now, endsAt, now, now
    ]);
    const redeemed = await db.run(`UPDATE activation_codes SET status = 'redeemed', redeemed_at = ?, redeemed_by_user_id = ?, updated_at = ?
      WHERE id = ? AND status = 'active'`, [now, context.user.id, now, code.id]);
    if (redeemed.changes !== 1) throw validationError("استُخدم كود التفعيل في طلب آخر");
    await db.run(`UPDATE app_installations SET tenant_id = ?, user_id = ?, activation_code_id = ?, activated_at = ?,
      last_seen_at = ?, revoked_at = NULL, status = 'active', updated_at = ? WHERE id = ?`, [
      code.tenant_id, context.user.id, code.id, now, now, now, installation.id
    ]);
    await writeAudit(db, context, {
      tenantId: code.tenant_id,
      action: "activation_code.redeem",
      entityType: "activation_code",
      entityId: code.id,
      after: { installationId: installation.id, subscriptionId, productCode: code.product_code, endsAt }
    });
    return {
      activated: true,
      tenantId: code.tenant_id,
      installation: { id: installation.id, hint: installation.installation_hint, status: "active", activatedAt: now },
      subscription: { id: subscriptionId, status: "active", productCode: code.product_code, productName: code.product_name, startsAt: now, endsAt }
    };
  }

  async listSubscribers(context, query = {}) {
    requirePermission(context, PERMISSIONS.SUBSCRIBER_READ);
    const { limit, offset } = pageFromQuery(query);
    const where = ["s.tenant_id = ?"];
    const params = [context.tenantId];
    if (query.status && query.status !== "all") {
      where.push("s.status = ?");
      params.push(query.status);
    }
    if (query.q) {
      where.push("(LOWER(s.full_name) LIKE LOWER(?) OR LOWER(s.username) LIKE LOWER(?) OR s.phone LIKE ?)");
      const search = `%${String(query.q).trim()}%`;
      params.push(search, search, search);
    }
    const whereSql = where.join(" AND ");
    const rows = await this.db.all(`SELECT s.*, p.name AS plan_name, p.speed_down_mbps, p.speed_up_mbps, p.price_minor AS plan_price_minor,
        p.quota_bytes, p.quota_period, p.quota_action, p.duration_days
      FROM subscribers s LEFT JOIN plans p ON p.id = s.plan_id
      WHERE ${whereSql} ORDER BY s.updated_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const [count, tenant] = await Promise.all([
      this.db.get(`SELECT COUNT(*) AS total FROM subscribers s WHERE ${whereSql}`, params),
      this.db.get("SELECT time_zone FROM tenants WHERE id = ?", [context.tenantId])
    ]);
    const items = await Promise.all(rows.map((row) => subscriberViewWithUsage(this.db, context.tenantId, tenant?.time_zone ?? "UTC", row)));
    return { items, pagination: { limit, offset, total: Number(count.total) } };
  }

  async getSubscriber(context, subscriberId) {
    requirePermission(context, PERMISSIONS.SUBSCRIBER_READ);
    const row = await this.db.get(`SELECT s.*, p.name AS plan_name, p.speed_down_mbps, p.speed_up_mbps, p.price_minor AS plan_price_minor,
        p.quota_bytes, p.quota_period, p.quota_action, p.duration_days
      FROM subscribers s LEFT JOIN plans p ON p.id = s.plan_id WHERE s.id = ? AND s.tenant_id = ?`,
    [subscriberId, context.tenantId]);
    if (!row) throw notFound("المشترك غير موجود");
    const [invoices, sessions, tenant] = await Promise.all([
      this.db.all(`SELECT id, number, amount_minor, paid_minor, currency, status, due_at, created_at
        FROM invoices WHERE tenant_id = ? AND subscriber_id = ? ORDER BY created_at DESC LIMIT 20`, [context.tenantId, subscriberId]),
      this.db.all(`SELECT id, external_session_id, framed_ip, nas_ip, started_at, stopped_at, input_bytes, output_bytes, status
        FROM radius_sessions WHERE tenant_id = ? AND subscriber_id = ? ORDER BY started_at DESC LIMIT 20`, [context.tenantId, subscriberId]),
      this.db.get("SELECT time_zone FROM tenants WHERE id = ?", [context.tenantId])
    ]);
    return { ...await subscriberViewWithUsage(this.db, context.tenantId, tenant?.time_zone ?? "UTC", row), invoices, sessions };
  }

  async createSubscriber(context, input, db = this.db) {
    requireWrite(context, PERMISSIONS.SUBSCRIBER_WRITE);
    await requireCapacity(db, context, "subscribers");
    const now = nowIso();
    const voucherCollision = await db.get("SELECT id FROM vouchers WHERE tenant_id = ? AND username = ?", [context.tenantId, input.username]);
    if (voucherCollision) throw validationError("اسم المستخدم مستخدم بواسطة بطاقة اشتراك");
    let selectedPlan = null;
    if (input.planId) {
      selectedPlan = await db.get("SELECT id, duration_days, speed_up_mbps FROM plans WHERE id = ? AND tenant_id = ? AND status = 'active'", [input.planId, context.tenantId]);
      if (!selectedPlan) throw validationError("الباقة المختارة غير صالحة");
    }
    if (input.policyId) {
      const policy = await db.get("SELECT id FROM radius_policies WHERE id = ? AND tenant_id = ? AND status = 'active'", [input.policyId, context.tenantId]);
      if (!policy) throw validationError("سياسة RADIUS المختارة غير صالحة");
    }
    if (input.ipPoolId) {
      const pool = await db.get("SELECT id FROM ip_pools WHERE id = ? AND tenant_id = ? AND status = 'active'", [input.ipPoolId, context.tenantId]);
      if (!pool) throw validationError("تجمع عناوين IP المختار غير صالح");
    }
    const subscriberId = id("cus");
    const encryptedCredential = input.radiusPassword ? encryptSecret(input.radiusPassword, this.config.encryptionKey) : null;
    await db.run(`INSERT INTO subscribers
      (id, tenant_id, plan_id, policy_id, ip_pool_id, username, radius_secret_ciphertext, credential_version,
       full_name, phone, address, status, balance_minor, service_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`, [
      subscriberId, context.tenantId, input.planId ?? null, input.policyId ?? null, input.ipPoolId ?? null,
      input.username, encryptedCredential, encryptedCredential ? 1 : 0, input.fullName,
      input.phone ?? null, input.address ?? null,
      input.serviceExpiresAt ?? (selectedPlan ? addDays(now, Number(selectedPlan.duration_days ?? 30)) : null), now, now
    ]);
    if (input.accessProfile !== undefined) await saveAccessProfile(db,context.tenantId,subscriberId,input.accessProfile,selectedPlan);
    if (encryptedCredential) await queueSubscriberDirectoryRefresh(db,context.tenantId,subscriberId);
    const created = await db.get(`SELECT s.*, p.name AS plan_name, p.speed_down_mbps, p.speed_up_mbps, p.price_minor AS plan_price_minor,
        p.quota_bytes, p.quota_period, p.quota_action, p.duration_days
      FROM subscribers s LEFT JOIN plans p ON p.id = s.plan_id WHERE s.id = ? AND s.tenant_id = ?`, [subscriberId, context.tenantId]);
    const tenant = await db.get("SELECT time_zone FROM tenants WHERE id=?",[context.tenantId]);
    const view = await subscriberViewWithUsage(db, context.tenantId, tenant?.time_zone ?? "UTC", created);
    await writeAudit(db, context, { action: "subscriber.create", entityType: "subscriber", entityId: subscriberId, after: view });
    return view;
  }

  async updateSubscriber(context, subscriberId, input, db = this.db) {
    requireWrite(context, PERMISSIONS.SUBSCRIBER_WRITE);
    const before = await db.get("SELECT * FROM subscribers WHERE id = ? AND tenant_id = ?", [subscriberId, context.tenantId]);
    if (!before) throw notFound("المشترك غير موجود");
    const values = {
      fullName: input.fullName ?? before.full_name,
      phone: input.phone === undefined ? before.phone : input.phone,
      address: input.address === undefined ? before.address : input.address,
      planId: input.planId === undefined ? before.plan_id : input.planId,
      policyId: input.policyId === undefined ? before.policy_id : input.policyId,
      ipPoolId: input.ipPoolId === undefined ? before.ip_pool_id : input.ipPoolId,
      serviceExpiresAt: input.serviceExpiresAt === undefined ? before.service_expires_at : input.serviceExpiresAt
    };
    if (values.planId) {
      const plan = await db.get("SELECT id FROM plans WHERE id = ? AND tenant_id = ? AND status = 'active'", [values.planId, context.tenantId]);
      if (!plan) throw validationError("الباقة المختارة غير صالحة");
    }
    if (values.policyId) {
      const policy = await db.get("SELECT id FROM radius_policies WHERE id = ? AND tenant_id = ? AND status = 'active'", [values.policyId, context.tenantId]);
      if (!policy) throw validationError("سياسة RADIUS المختارة غير صالحة");
    }
    if (values.ipPoolId) {
      const pool = await db.get("SELECT id FROM ip_pools WHERE id = ? AND tenant_id = ? AND status = 'active'", [values.ipPoolId, context.tenantId]);
      if (!pool) throw validationError("تجمع عناوين IP المختار غير صالح");
    }
    await db.run(`UPDATE subscribers SET full_name = ?, phone = ?, address = ?, plan_id = ?, policy_id = ?, ip_pool_id = ?, service_expires_at = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?`, [values.fullName, values.phone, values.address, values.planId, values.policyId, values.ipPoolId, values.serviceExpiresAt, nowIso(), subscriberId, context.tenantId]);
    if (input.accessProfile !== undefined) {
      const plan = values.planId ? await db.get("SELECT speed_up_mbps FROM plans WHERE id=? AND tenant_id=?",[values.planId,context.tenantId]) : null;
      await saveAccessProfile(db,context.tenantId,subscriberId,input.accessProfile,plan);
    }
    if (input.accessProfile !== undefined || input.planId !== undefined || input.policyId !== undefined || input.ipPoolId !== undefined)
      await queueSubscriberDirectoryRefresh(db,context.tenantId,subscriberId);
    const after = await db.get("SELECT * FROM subscribers WHERE id = ? AND tenant_id = ?", [subscriberId, context.tenantId]);
    await writeAudit(db, context, { action: "subscriber.update", entityType: "subscriber", entityId: subscriberId,
      before: subscriberView(before), after: subscriberView(after) });
    return this.getSubscriber(context, subscriberId);
  }

  async setSubscriberStatus(context, subscriberId, status, reason, db = this.db) {
    requireWrite(context, PERMISSIONS.SUBSCRIBER_SUSPEND);
    if (!reason || reason.trim().length < 3) throw validationError("اكتب سبب العملية بوضوح");
    const before = await db.get("SELECT * FROM subscribers WHERE id = ? AND tenant_id = ?", [subscriberId, context.tenantId]);
    if (!before) throw notFound("المشترك غير موجود");
    const now = nowIso();
    await db.run("UPDATE subscribers SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?", [status, now, subscriberId, context.tenantId]);
    await db.run(`INSERT INTO outbox
      (id, tenant_id, topic, payload_json, status, attempts, available_at, locked_at, last_error, created_at, updated_at)
      VALUES (?, ?, 'radius.subscriber.sync', ?, 'pending', 0, ?, NULL, NULL, ?, ?)`,
    [id("job"), context.tenantId, toJson({ subscriberId, username: before.username, status }), now, now, now]);
    await writeAudit(db, context, {
      action: status === "suspended" ? "subscriber.suspend" : "subscriber.activate",
      entityType: "subscriber", entityId: subscriberId, reason, before: { status: before.status }, after: { status }
    });
    return { id: subscriberId, status, queued: true };
  }

  async setSubscriberCredential(context, subscriberId, password, reason, db = this.db) {
    requireWrite(context, PERMISSIONS.SUBSCRIBER_WRITE);
    const before = await db.get("SELECT id, username, credential_version, radius_secret_ciphertext FROM subscribers WHERE id = ? AND tenant_id = ?", [subscriberId, context.tenantId]);
    if (!before) throw notFound("المشترك غير موجود");
    const now = nowIso();
    const version = Number(before.credential_version ?? 0) + 1;
    await db.run(`UPDATE subscribers SET radius_secret_ciphertext = ?, credential_version = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?`, [encryptSecret(password, this.config.encryptionKey), version, now, subscriberId, context.tenantId]);
    await queueSubscriberDirectoryRefresh(db,context.tenantId,subscriberId);
    await writeAudit(db, context, {
      action: "subscriber.credential.rotate",
      entityType: "subscriber",
      entityId: subscriberId,
      reason,
      before: { credentialConfigured: Boolean(before.radius_secret_ciphertext), credentialVersion: Number(before.credential_version ?? 0) },
      after: { credentialConfigured: true, credentialVersion: version }
    });
    return { id: subscriberId, credentialConfigured: true, credentialVersion: version };
  }

  async listPlans(context) {
    requirePermission(context, PERMISSIONS.PLAN_READ);
    const rows = await this.db.all("SELECT * FROM plans WHERE tenant_id = ? ORDER BY status ASC, price_minor ASC", [context.tenantId]);
    return { items: rows.map(planView) };
  }

  async createPlan(context, input, db = this.db) {
    requireWrite(context, PERMISSIONS.PLAN_WRITE);
    const values = normalizedPlanValues(input);
    await validatePlanReferences(db, context.tenantId, values);
    const planId = id("pln");
    const now = nowIso();
    await db.run(`INSERT INTO plans
      (id, tenant_id, policy_id, ip_pool_id, name, speed_down_mbps, speed_up_mbps, price_minor, billing_cycle,
       quota_bytes, quota_period, quota_action, throttle_down_mbps, throttle_up_mbps, duration_days, simultaneous_use,
       scope_type, scope_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [planId, context.tenantId, values.policyId, values.ipPoolId, values.name, values.speedDownMbps, values.speedUpMbps,
      values.priceMinor, values.billingCycle, values.quotaBytes, values.quotaPeriod, values.quotaAction,
      values.throttleDownMbps, values.throttleUpMbps, values.durationDays, values.simultaneousUse,
      values.scopeType, values.scopeId, now, now]);
    const row = await db.get("SELECT * FROM plans WHERE id = ? AND tenant_id = ?", [planId, context.tenantId]);
    await writeAudit(db, context, { action: "plan.create", entityType: "plan", entityId: planId, after: planView(row) });
    return planView(row);
  }

  async updatePlan(context, planId, input, db = this.db) {
    requireWrite(context, PERMISSIONS.PLAN_WRITE);
    const before = await db.get("SELECT * FROM plans WHERE id = ? AND tenant_id = ?", [planId, context.tenantId]);
    if (!before) throw notFound("الباقة غير موجودة");
    const values = normalizedPlanValues(input, before);
    await validatePlanReferences(db, context.tenantId, values);
    if (values.status === "archived" && before.status !== "archived") {
      const active = await db.get("SELECT COUNT(*) AS total FROM subscribers WHERE tenant_id = ? AND plan_id = ? AND status = 'active'", [context.tenantId, planId]);
      if (Number(active?.total ?? 0) > 0) throw validationError("انقل المشتركين النشطين إلى باقة أخرى قبل أرشفة هذه الباقة");
    }
    await db.run(`UPDATE plans SET name=?,speed_down_mbps=?,speed_up_mbps=?,price_minor=?,billing_cycle=?,policy_id=?,ip_pool_id=?,
      quota_bytes=?,quota_period=?,quota_action=?,throttle_down_mbps=?,throttle_up_mbps=?,duration_days=?,simultaneous_use=?,
      scope_type=?,scope_id=?,status=?,updated_at=? WHERE id=? AND tenant_id=?`, [
      values.name, values.speedDownMbps, values.speedUpMbps, values.priceMinor, values.billingCycle,
      values.policyId, values.ipPoolId, values.quotaBytes, values.quotaPeriod, values.quotaAction,
      values.throttleDownMbps, values.throttleUpMbps, values.durationDays, values.simultaneousUse,
      values.scopeType, values.scopeId, values.status, nowIso(), planId, context.tenantId
    ]);
    const after = await db.get("SELECT * FROM plans WHERE id = ? AND tenant_id = ?", [planId, context.tenantId]);
    await writeAudit(db, context, { action: "plan.update", entityType: "plan", entityId: planId,
      reason: input.reason, before: planView(before), after: planView(after) });
    return planView(after);
  }

  async renewSubscriber(context, subscriberId, input, db = this.db) {
    requireWrite(context, PERMISSIONS.SUBSCRIBER_WRITE);
    const subscriber = await db.get("SELECT * FROM subscribers WHERE id = ? AND tenant_id = ?", [subscriberId, context.tenantId]);
    if (!subscriber) throw notFound("المشترك غير موجود");
    const planId = input.planId ?? subscriber.plan_id;
    if (!planId) throw validationError("اختر باقة قبل تجديد المشترك");
    const plan = await db.get("SELECT * FROM plans WHERE id = ? AND tenant_id = ? AND status = 'active'", [planId, context.tenantId]);
    if (!plan) throw validationError("الباقة المختارة غير صالحة");
    const now = nowIso();
    const currentExpiry = subscriber.service_expires_at && Date.parse(subscriber.service_expires_at) > Date.parse(now)
      ? subscriber.service_expires_at
      : now;
    const serviceExpiresAt = addDays(currentExpiry, Number(plan.duration_days ?? 30));
    await db.run(`UPDATE subscribers SET plan_id = ?, status = 'active', service_expires_at = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?`, [plan.id, serviceExpiresAt, now, subscriberId, context.tenantId]);
    await db.run(`INSERT INTO outbox
      (id, tenant_id, topic, payload_json, status, attempts, available_at, locked_at, last_error, created_at, updated_at)
      VALUES (?, ?, 'radius.subscriber.sync', ?, 'pending', 0, ?, NULL, NULL, ?, ?)`, [
      id("job"), context.tenantId, toJson({ subscriberId, username: subscriber.username, status: "active", renewed: true }), now, now, now
    ]);
    await writeAudit(db, context, {
      action: "subscriber.renew",
      entityType: "subscriber",
      entityId: subscriberId,
      reason: input.reason,
      before: { planId: subscriber.plan_id, status: subscriber.status, serviceExpiresAt: subscriber.service_expires_at },
      after: { planId: plan.id, status: "active", serviceExpiresAt }
    });
    return { id: subscriberId, planId: plan.id, status: "active", serviceExpiresAt, queued: true };
  }

  async listSessions(context, query = {}) {
    requirePermission(context, PERMISSIONS.SESSION_READ);
    const { limit, offset } = pageFromQuery(query);
    const status = query.status && query.status !== "all" ? query.status : null;
    const params = [context.tenantId];
    let condition = "tenant_id = ?";
    if (status) {
      condition += " AND status = ?";
      params.push(status);
    }
    const items = await this.db.all(`SELECT id, subscriber_id, device_id, external_session_id, username, framed_ip, nas_ip,
      started_at, stopped_at, input_bytes, output_bytes, terminate_cause, status, updated_at
      FROM radius_sessions WHERE ${condition} ORDER BY started_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const count = await this.db.get(`SELECT COUNT(*) AS total FROM radius_sessions WHERE ${condition}`, params);
    return { items, pagination: { limit, offset, total: Number(count.total) } };
  }

  async disconnectSession(context, sessionId, reason, db = this.db) {
    requireWrite(context, PERMISSIONS.SESSION_DISCONNECT);
    if (!reason || reason.trim().length < 3) throw validationError("يلزم سبب فصل الجلسة");
    const session = await db.get("SELECT * FROM radius_sessions WHERE id = ? AND tenant_id = ?", [sessionId, context.tenantId]);
    if (!session) throw notFound("الجلسة غير موجودة");
    if (session.status !== "active") return { id: sessionId, status: session.status, queued: false };
    const now = nowIso();
    const jobId = id("job");
    await db.run(`INSERT INTO outbox
      (id, tenant_id, topic, payload_json, status, attempts, available_at, locked_at, last_error, created_at, updated_at)
      VALUES (?, ?, 'radius.session.disconnect', ?, 'pending', 0, ?, NULL, NULL, ?, ?)`,
    [jobId, context.tenantId, toJson({
      sessionId,
      externalSessionId: session.external_session_id,
      username: session.username,
      framedIp: session.framed_ip,
      nasIp: session.nas_ip,
      deviceId: session.device_id,
      reason
    }), now, now, now]);
    await writeAudit(db, context, { action: "session.disconnect.request", entityType: "radius_session", entityId: sessionId, reason, after: { jobId } });
    return { id: sessionId, status: "disconnect_pending", jobId, queued: true };
  }

  async listInvoices(context, query = {}) {
    requirePermission(context, PERMISSIONS.BILLING_READ);
    const { limit, offset } = pageFromQuery(query);
    const rows = await this.db.all(`SELECT i.*, s.full_name, s.username
      FROM invoices i JOIN subscribers s ON s.id = i.subscriber_id
      WHERE i.tenant_id = ? ORDER BY i.created_at DESC LIMIT ? OFFSET ?`, [context.tenantId, limit, offset]);
    const count = await this.db.get("SELECT COUNT(*) AS total FROM invoices WHERE tenant_id = ?", [context.tenantId]);
    return { items: rows.map((row) => ({
      id: row.id, subscriberId: row.subscriber_id, subscriberName: row.full_name, username: row.username,
      number: row.number, amountMinor: Number(row.amount_minor), paidMinor: Number(row.paid_minor),
      currency: row.currency, status: row.status, dueAt: row.due_at,
      periodStart: row.period_start ?? null, periodEnd: row.period_end ?? null,
      voidReason: row.void_reason ?? null, createdAt: row.created_at, updatedAt: row.updated_at
    })), pagination: { limit, offset, total: Number(count.total) } };
  }

  async recordPayment(context, invoiceId, input, db = this.db) {
    requireWrite(context, PERMISSIONS.BILLING_WRITE);
    const lock = db.driver === "postgres" ? " FOR UPDATE" : "";
    const invoice = await db.get(`SELECT * FROM invoices WHERE id = ? AND tenant_id = ?${lock}`, [invoiceId, context.tenantId]);
    if (!invoice) throw notFound("الفاتورة غير موجودة");
    if (invoice.status === "void") throw validationError("لا يمكن تسجيل دفعة على فاتورة ملغاة");
    if (invoice.status === "paid") throw validationError("الفاتورة مدفوعة بالكامل");
    const remaining = Number(invoice.amount_minor) - Number(invoice.paid_minor);
    if (input.amountMinor > remaining) throw validationError("قيمة الدفعة أكبر من المبلغ المتبقي");
    const paymentId = id("pay");
    const now = nowIso();
    const paidMinor = Number(invoice.paid_minor) + input.amountMinor;
    const status = paidMinor === Number(invoice.amount_minor) ? "paid" : "partial";
    await db.run(`INSERT INTO payments
      (id, tenant_id, invoice_id, amount_minor, method, reference, received_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [paymentId, context.tenantId, invoiceId, input.amountMinor, input.method, input.reference ?? null, context.user.id, now]);
    await db.run("UPDATE invoices SET paid_minor = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
      [paidMinor, status, now, invoiceId, context.tenantId]);
    await db.run(`UPDATE subscribers SET balance_minor=CASE WHEN balance_minor>=? THEN balance_minor-? ELSE 0 END,updated_at=?
      WHERE id=? AND tenant_id=?`, [input.amountMinor, input.amountMinor, now, invoice.subscriber_id, context.tenantId]);
    await writeAudit(db, context, { action: "payment.record", entityType: "payment", entityId: paymentId, reason: input.reason, after: { invoiceId, amountMinor: input.amountMinor, method: input.method } });
    return { id: paymentId, invoiceId, amountMinor: input.amountMinor, invoiceStatus: status, remainingMinor: Number(invoice.amount_minor) - paidMinor };
  }

  async listDevices(context) {
    requirePermission(context, PERMISSIONS.DEVICE_READ);
    const rows = await this.db.all(`SELECT id, site_id, name, branch, host, api_port, connection_method, username, status, last_seen_at, created_at, updated_at
      FROM network_devices WHERE tenant_id = ? ORDER BY created_at DESC`, [context.tenantId]);
    const freshSince = Date.now() - 60_000;
    return { items: rows.map(row => ({
      ...row,
      status: row.status === "online" && (!row.last_seen_at || new Date(row.last_seen_at).getTime() < freshSince)
        ? "offline" : row.status
    })) };
  }

  async deviceConnectionDiagnostics(context) {
    requirePermission(context, PERMISSIONS.DEVICE_READ);
    const [devices, sites, agents] = await Promise.all([
      this.db.all("SELECT id,site_id,name,host,api_port,connection_method,status,last_seen_at FROM network_devices WHERE tenant_id=? ORDER BY created_at ASC",
        [context.tenantId]),
      this.db.all("SELECT id,name FROM network_sites WHERE tenant_id=? AND status='active'", [context.tenantId]),
      this.db.all("SELECT site_id,status,last_seen_at FROM radius_nodes WHERE tenant_id=?", [context.tenantId])
    ]);
    return connectionDiagnostics({ devices, sites, agents, config:this.config });
  }

  async radiusAgentSetup(context, requestedSiteId = null, requestedDeviceId = null) {
    requirePermission(context, PERMISSIONS.DEVICE_READ);
    if (!["owner", "admin"].includes(context.role)) throw forbidden("إعداد الوكيل مخصص لمالك الشبكة وإدارتها");
    const tenant = await this.db.get("SELECT slug,name FROM tenants WHERE id=? AND status='active'", [context.tenantId]);
    if (!tenant) throw notFound("شبكتك غير نشطة");
    // One original ISP router may have been registered twice by a previous
    // failed connection attempt. Export precisely the selected registered ID,
    // not two copies of one endpoint or two invented provider sites.
    if (requestedSiteId && requestedDeviceId) throw validationError("اختر جهازًا أو موقعًا واحدًا، وليس كليهما");
    const selectedDeviceId = requestedDeviceId ? String(requestedDeviceId) : null;
    const selectedUnassigned = requestedSiteId === "unassigned";
    const selectedSiteId = requestedSiteId && !selectedUnassigned ? String(requestedSiteId) : null;
    if (selectedSiteId) {
      const selected = await this.db.get("SELECT id FROM network_sites WHERE tenant_id=? AND id=? AND status='active'",
        [context.tenantId, selectedSiteId]);
      if (!selected) throw validationError("الموقع المختار غير صالح");
    }
    const devices = selectedDeviceId
      ? await this.db.all("SELECT id,name,host,api_port,site_id FROM network_devices WHERE tenant_id=? AND id=?",
          [context.tenantId, selectedDeviceId])
      : selectedSiteId
        ? await this.db.all(`SELECT id,name,host,api_port,site_id FROM network_devices
          WHERE tenant_id=? AND site_id=? ORDER BY created_at ASC`, [context.tenantId, selectedSiteId])
      : selectedUnassigned
        ? await this.db.all("SELECT id,name,host,api_port,site_id FROM network_devices WHERE tenant_id=? AND site_id IS NULL ORDER BY created_at ASC",
            [context.tenantId])
        : await this.db.all(`SELECT id,name,host,api_port,site_id FROM network_devices
          WHERE tenant_id=? ORDER BY created_at ASC`, [context.tenantId]);
    if (selectedDeviceId && devices.length !== 1) throw notFound("هذا الراوتر غير موجود ضمن شبكتك");
    const assignedSiteId = selectedDeviceId ? (devices[0]?.site_id ?? null) : selectedSiteId;
    const routers = devices.map(device => ({
      id: device.id,
      host: device.host,
      port: 8729,
      username: "REPLACE_LOCAL_ROUTER_USER",
      password: "REPLACE_LOCALLY_NEVER_UPLOAD",
      caFile: "router-ca.pem",
      serverName: "REPLACE_WITH_CERTIFICATE_DNS_NAME",
      nasIps: [device.host],
      registeredPort: Number(device.api_port),
      needsTlsPortUpdate: Number(device.api_port) !== 8729
    }));
    const integration = await this.db.get(
      "SELECT secret_ciphertext FROM integrations WHERE tenant_id=? AND type='radius'", [context.tenantId]);
    return {
      tenantId: context.tenantId, tenantName: tenant.name, tenantSlug: tenant.slug,
      selectedSiteId: assignedSiteId, selectedDeviceId, selectedUnassigned, supportedModes: ["lan-agent", "vpn-agent", "docker-agent"],
      apiUrl: "https://radius.uchiha-builder.com",
      credentialConfigured: Boolean(integration?.secret_ciphertext),
      requiresLocalInstall: true, routerCount: routers.length,
      environment: {
        UCHIHA_API_URL: "https://radius.uchiha-builder.com",
        UCHIHA_TENANT_SLUG: tenant.slug,
        RADIUS_AGENT_SIGNING_SECRET: "replace-with-one-time-agent-key",
        RADIUS_AGENT_SITE_ID: assignedSiteId ?? "",
        RADIUS_AGENT_LOCAL_SECRET: "replace-with-locally-generated-secret",
        RADIUS_AGENT_CACHE_KEY: "replace-with-64-character-local-hex-key",
        RADIUS_COMMAND_ADAPTER: "routeros",
        RADIUS_ROUTERS_FILE: "/etc/uchiha-radius/routers.json",
        RADIUS_AGENT_HOST: "127.0.0.1",
        RADIUS_AGENT_PORT: "8790",
        RADIUS_AGENT_DB: "/var/lib/uchiha-radius-agent/spool.sqlite",
        RADIUS_HEARTBEAT_MS: "15000"
      },
      routers,
      warnings: [
        "هذه بيانات إعداد فقط؛ لا تعني اتصال الأجهزة.",
        "كلمات المرور والمفاتيح والشهادات تضاف محليًا على مضيف Site Agent فقط.",
        "أي جهاز مسجل بمنفذ غير 8729 يحتاج تصحيح منفذه داخل واجهة الراديوس."
      ]
    };
  }

  async createDevice(context, input, db = this.db) {
    requireWrite(context, PERMISSIONS.DEVICE_WRITE);
    await requireCapacity(db, context, "devices");
    if (input.siteId) {
      const site = await db.get("SELECT id FROM network_sites WHERE id = ? AND tenant_id = ? AND status = 'active'", [input.siteId, context.tenantId]);
      if (!site) throw validationError("الفرع المختار غير صالح");
    }
    const host = input.host.toLowerCase();
    await lockDeviceEndpoint(db, context.tenantId, input.siteId ?? null, host, input.apiPort);
    const existingHost = await db.get(
      "SELECT id,name FROM network_devices WHERE tenant_id=? AND LOWER(host)=? AND api_port=? AND ((site_id IS NULL AND CAST(? AS TEXT) IS NULL) OR site_id=?) LIMIT 1",
      [context.tenantId, host, input.apiPort, input.siteId ?? null, input.siteId ?? null]);
    if (existingHost) throw validationError("يوجد جهاز مسجل مسبقًا بنفس العنوان والمنفذ. عدّل بيانات الجهاز الموجود بدل إضافة نسخة ثانية.");
    const deviceId = id("dev");
    const now = nowIso();
    await db.run(`INSERT INTO network_devices
      (id, tenant_id, site_id, name, branch, host, api_port, connection_method, username, secret_ciphertext, status, last_seen_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`, [
      deviceId, context.tenantId, input.siteId ?? null, input.name, input.branch ?? null, host, input.apiPort,
      input.connectionMethod, input.username ?? null, encryptSecret(input.secret, this.config.encryptionKey), now, now
    ]);
    await writeAudit(db, context, { action: "device.create", entityType: "network_device", entityId: deviceId, after: { name: input.name, host, apiPort: input.apiPort, connectionMethod: input.connectionMethod } });
    return { id: deviceId, siteId: input.siteId ?? null, name: input.name, branch: input.branch ?? null, host, apiPort: input.apiPort, connectionMethod: input.connectionMethod, status: "pending" };
  }

  async updateDevice(context, deviceId, input, db = this.db) {
    requireWrite(context, PERMISSIONS.DEVICE_WRITE);
    const before = await db.get("SELECT * FROM network_devices WHERE id = ? AND tenant_id = ?", [deviceId, context.tenantId]);
    if (!before) throw notFound("جهاز الشبكة غير موجود");
    const values = {
      siteId: input.siteId === undefined ? before.site_id : input.siteId,
      name: input.name ?? before.name,
      branch: input.branch === undefined ? before.branch : input.branch,
      host: input.host === undefined ? before.host : input.host.toLowerCase(),
      apiPort: input.apiPort ?? before.api_port,
      connectionMethod: input.connectionMethod ?? before.connection_method,
      username: input.username === undefined ? before.username : input.username,
      status: input.status ?? before.status,
      secretCiphertext: input.secret === undefined ? before.secret_ciphertext : encryptSecret(input.secret, this.config.encryptionKey)
    };
    if (values.siteId) {
      const site = await db.get("SELECT id FROM network_sites WHERE id = ? AND tenant_id = ? AND status = 'active'", [values.siteId, context.tenantId]);
      if (!site) throw validationError("الفرع المختار غير صالح");
    }
    const changedEndpoint = values.host !== before.host || Number(values.apiPort) !== Number(before.api_port) ||
      values.connectionMethod !== before.connection_method || values.siteId !== before.site_id;
    // An edited username or replacement secret invalidates the last authenticated
    // identity proof even if the IP/port is unchanged. Never keep a stale online badge.
    const changedCredential = (input.username !== undefined && values.username !== before.username) ||
      input.secret !== undefined;
    // Older releases allowed identical unassigned endpoints; owners must be able
    // to rename those legacy records before assigning each to a distinct site.
    if (changedEndpoint) {
      await lockDeviceEndpoint(db, context.tenantId, values.siteId ?? null, values.host, values.apiPort);
      const duplicate = await db.get(
        "SELECT id FROM network_devices WHERE tenant_id=? AND LOWER(host)=LOWER(?) AND api_port=? AND id<>? AND ((site_id IS NULL AND CAST(? AS TEXT) IS NULL) OR site_id=?) LIMIT 1",
        [context.tenantId, values.host, values.apiPort, deviceId, values.siteId ?? null, values.siteId ?? null]);
      if (duplicate) throw validationError("يوجد جهاز آخر مسجل بنفس العنوان والمنفذ ضمن الموقع نفسه.");
    }
    if (changedEndpoint || changedCredential) values.status = "pending";
    await db.run(`UPDATE network_devices SET site_id=?,name=?,branch=?,host=?,api_port=?,connection_method=?,
      username=?,secret_ciphertext=?,status=?,last_seen_at=?,updated_at=? WHERE id=? AND tenant_id=?`,
      [values.siteId, values.name, values.branch, values.host, values.apiPort,
        values.connectionMethod, values.username, values.secretCiphertext, values.status,
        changedEndpoint || changedCredential ? null : before.last_seen_at, nowIso(), deviceId, context.tenantId]);
    const after = await db.get(`SELECT id,site_id,name,branch,host,api_port,connection_method,username,status,last_seen_at,created_at,updated_at
      FROM network_devices WHERE id=? AND tenant_id=?`, [deviceId, context.tenantId]);
    await writeAudit(db, context, { action: "device.update", entityType: "network_device", entityId: deviceId,
      reason: input.reason,
      before: { siteId: before.site_id, name: before.name, branch: before.branch, host: before.host,
        apiPort: before.api_port, connectionMethod: before.connection_method, username: before.username, status: before.status,
        credentialConfigured: Boolean(before.secret_ciphertext) },
      after: { siteId: after.site_id, name: after.name, branch: after.branch, host: after.host,
        apiPort: after.api_port, connectionMethod: after.connection_method, username: after.username, status: after.status,
        credentialConfigured: Boolean(values.secretCiphertext) } });
    return { id: after.id, siteId: after.site_id, name: after.name, branch: after.branch, host: after.host,
      apiPort: after.api_port, connectionMethod: after.connection_method, username: after.username,
      credentialConfigured: Boolean(values.secretCiphertext), status: after.status, lastSeenAt: after.last_seen_at,
      createdAt: after.created_at, updatedAt: after.updated_at };
  }

  async deleteDevice(context, deviceId, input, db = this.db) {
    requireWrite(context, PERMISSIONS.DEVICE_WRITE);
    if (!["owner", "admin"].includes(context.role))
      throw forbidden("حذف MikroTik متاح فقط لمالك الشبكة والمدير");
    // The confirmation contains the host and last version displayed by the
    // user's own tenant. Reject an old Telegram button instead of deleting a
    // renamed/reconfigured device.
    const rowLock = db.driver === "postgres" ? " FOR UPDATE" : "";
    const before = await db.get("SELECT * FROM network_devices WHERE id=? AND tenant_id=?" + rowLock,
      [deviceId, context.tenantId]);
    if (!before) throw notFound("جهاز MikroTik غير موجود ضمن شبكتك");
    if (before.host !== input.expectedHost ||
        (before.updated_at instanceof Date ? before.updated_at.toISOString() : String(before.updated_at)) !== input.expectedUpdatedAt)
      throw new AppError(409, "CONFLICT", "تغيرت بيانات الجهاز؛ افتح القائمة وراجع السجل قبل الحذف");
    const active = await db.get("SELECT id FROM radius_sessions WHERE tenant_id=? AND device_id=? AND status='active' LIMIT 1",
      [context.tenantId, deviceId]);
    if (active)
      throw new AppError(409, "CONFLICT", "لدى الجهاز جلسات مشترِكين نشطة؛ أنهِ الجلسات بأمان قبل حذف السجل");
    const queued = await db.all(`SELECT id,payload_json FROM outbox
      WHERE tenant_id=? AND topic='radius.session.disconnect' AND status IN ('pending','processing','failed') AND attempts < 20`,
      [context.tenantId]);
    if (queued.some(job => parseJson(job.payload_json, {}).deviceId === deviceId))
      throw new AppError(409, "CONFLICT", "توجد أوامر فصل معلقة على هذا الجهاز؛ أنهِ معالجتها أولًا");
    // All historical session/accounting/ticket FKs use ON DELETE SET NULL:
    // never destroy accounting or invoice history with a device record.
    const removed = await db.run("DELETE FROM network_devices WHERE id=? AND tenant_id=? AND host=? AND updated_at=?",
      [deviceId, context.tenantId, before.host, before.updated_at]);
    if (removed.changes !== 1)
      throw new AppError(409, "CONFLICT", "تغير سجل MikroTik أثناء الحذف؛ أعد فتح القائمة");
    await writeAudit(db, context, {
      action: "device.delete", entityType: "network_device", entityId: deviceId,
      reason: input.reason,
      before: { name: before.name, host: before.host, apiPort: before.api_port,
        siteId: before.site_id, connectionMethod: before.connection_method,
        status: before.status, credentialConfigured: Boolean(before.secret_ciphertext) },
      after: { deleted: true, deviceId }
    });
    return { id: deviceId, deleted: true };
  }

  async listAlerts(context, query = {}) {
    requirePermission(context, PERMISSIONS.ALERT_READ);
    const { limit, offset } = pageFromQuery(query);
    const rows = await this.db.all(`SELECT id, severity, category, title, body, status, acknowledged_at, created_at, updated_at
      FROM alerts WHERE tenant_id = ? ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, created_at DESC LIMIT ? OFFSET ?`,
    [context.tenantId, limit, offset]);
    return { items: rows };
  }

  async acknowledgeAlert(context, alertId, db = this.db) {
    requireWrite(context, PERMISSIONS.ALERT_WRITE);
    const alert = await db.get("SELECT * FROM alerts WHERE id = ? AND tenant_id = ?", [alertId, context.tenantId]);
    if (!alert) throw notFound("التنبيه غير موجود");
    if (alert.status !== "open") return { id: alertId, status: alert.status, acknowledgedAt: alert.acknowledged_at, changed: false };
    const now = nowIso();
    await db.run(`UPDATE alerts SET status = 'acknowledged', acknowledged_by_user_id = ?, acknowledged_at = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?`, [context.user.id, now, now, alertId, context.tenantId]);
    await writeAudit(db, context, { action: "alert.acknowledge", entityType: "alert", entityId: alertId, before: { status: alert.status }, after: { status: "acknowledged" } });
    return { id: alertId, status: "acknowledged", acknowledgedAt: now, changed: true };
  }

  async resolveAlert(context, alertId, reason, db = this.db) {
    requireWrite(context, PERMISSIONS.ALERT_WRITE);
    const alert = await db.get("SELECT * FROM alerts WHERE id = ? AND tenant_id = ?", [alertId, context.tenantId]);
    if (!alert) throw notFound("التنبيه غير موجود");
    if (alert.status === "resolved") return { id: alertId, status: "resolved", resolvedAt: alert.resolved_at, changed: false };
    const now = nowIso();
    await db.run(`UPDATE alerts SET status='resolved',resolved_by_user_id=?,resolved_at=?,updated_at=?
      WHERE id=? AND tenant_id=?`, [context.user.id, now, now, alertId, context.tenantId]);
    await writeAudit(db, context, { action: "alert.resolve", entityType: "alert", entityId: alertId, reason,
      before: { status: alert.status }, after: { status: "resolved" } });
    return { id: alertId, status: "resolved", resolvedAt: now, changed: true };
  }

  async listAudit(context, query = {}) {
    requirePermission(context, PERMISSIONS.AUDIT_READ);
    const { limit, offset } = pageFromQuery(query);
    const rows = await this.db.all(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.reason, a.created_at,
      u.display_name AS actor_name, u.email AS actor_email
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.tenant_id = ? ORDER BY a.created_at DESC LIMIT ? OFFSET ?`, [context.tenantId, limit, offset]);
    const count = await this.db.get("SELECT COUNT(*) AS total FROM audit_logs WHERE tenant_id = ?", [context.tenantId]);
    return { items: rows, pagination: { limit, offset, total: Number(count.total) } };
  }

  async subscriptionProducts(context) {
    const [rows, pending] = await Promise.all([
      this.db.all(`SELECT id, code, name_ar, price_minor, currency, billing_period, limits_json
        FROM subscription_products WHERE active = TRUE ORDER BY price_minor ASC`),
      this.db.get(`SELECT ts.id, ts.status, ts.checkout_url, ts.checkout_expires_at, ts.created_at,
          p.code AS product_code, p.name_ar AS product_name
        FROM tenant_subscriptions ts JOIN subscription_products p ON p.id = ts.product_id
        WHERE ts.tenant_id = ? AND ts.status = 'pending' ORDER BY ts.created_at DESC LIMIT 1`, [context.tenantId])
    ]);
    const canManage = context.permissions.includes(PERMISSIONS.TENANT_MANAGE);
    return { current: context.subscription, canWrite: context.canWrite, pending: pending ? {
      id: pending.id,
      status: pending.status,
      productCode: pending.product_code,
      productName: pending.product_name,
      checkoutStatus: checkoutStatus(pending, Boolean(this.config.billingCheckoutEndpoint)),
      checkoutUrl: canManage ? pending.checkout_url : null,
      checkoutExpiresAt: canManage ? pending.checkout_expires_at : null,
      createdAt: pending.created_at
    } : null, products: rows.map((row) => ({
      id: row.id, code: row.code, nameAr: row.name_ar, priceMinor: row.price_minor,
      currency: row.currency, billingPeriod: row.billing_period, limits: parseJson(row.limits_json, {})
    })) };
  }

  async subscriptionRequest(context, subscriptionId) {
    requirePermission(context, PERMISSIONS.TENANT_MANAGE);
    const row = await this.db.get(`SELECT id, status, checkout_url, checkout_expires_at, created_at
      FROM tenant_subscriptions WHERE id = ? AND tenant_id = ?`, [subscriptionId, context.tenantId]);
    if (!row) throw notFound("طلب الاشتراك غير موجود");
    return {
      id: row.id,
      status: row.status,
      checkoutStatus: row.status === "pending" ? checkoutStatus(row, Boolean(this.config.billingCheckoutEndpoint)) : "completed",
      checkoutUrl: row.status === "pending" ? row.checkout_url : null,
      checkoutExpiresAt: row.checkout_expires_at,
      createdAt: row.created_at
    };
  }

  async queueBillingCheckout(db, context, product, subscriptionId, now = nowIso()) {
    if (!this.config.billingCheckoutEndpoint) return null;
    const queued = await db.all(`SELECT id, payload_json FROM outbox
      WHERE tenant_id = ? AND topic = 'billing.checkout.create' AND status IN ('pending', 'processing', 'failed') AND attempts < 8`, [context.tenantId]);
    const existingJob = queued.find((job) => parseJson(job.payload_json, {}).subscriptionId === subscriptionId);
    if (existingJob) return existingJob.id;
    const jobId = id("job");
    await db.run(`INSERT INTO outbox
      (id, tenant_id, topic, payload_json, status, attempts, available_at, locked_at, last_error, created_at, updated_at)
      VALUES (?, ?, 'billing.checkout.create', ?, 'pending', 0, ?, NULL, NULL, ?, ?)`,
    [jobId, context.tenantId, toJson({
      subscriptionId,
      tenantId: context.tenantId,
      tenantName: context.tenantName,
      customerEmail: context.user.email,
      productCode: product.code,
      productName: product.name_ar,
      amountMinor: product.price_minor,
      currency: product.currency,
      billingPeriod: product.billing_period
    }), now, now, now]);
    return jobId;
  }

  async selectSubscription(context, productId, db = this.db) {
    requirePermission(context, PERMISSIONS.TENANT_MANAGE);
    const product = await db.get("SELECT * FROM subscription_products WHERE id = ? AND active = TRUE", [productId]);
    if (!product) throw notFound("خطة الاشتراك غير موجودة");
    const existing = await db.get(`SELECT * FROM tenant_subscriptions
      WHERE tenant_id = ? AND product_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`, [context.tenantId, productId]);
    if (existing) {
      const jobId = existing.checkout_url ? null : await this.queueBillingCheckout(db, context, product, existing.id);
      return {
        subscriptionId: existing.id,
        status: existing.status,
        checkoutStatus: existing.checkout_url ? checkoutStatus(existing, true) : jobId ? "queued" : "manual_review",
        checkoutUrl: existing.checkout_url ?? null,
        jobId,
        reused: true
      };
    }
    const now = nowIso();
    const subscriptionId = id("sub");
    const inserted = await db.run(`INSERT INTO tenant_subscriptions
      (id, tenant_id, product_id, status, provider, external_id, starts_at, ends_at, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', NULL, NULL, ?, NULL, ?, ?)
      ON CONFLICT DO NOTHING`, [subscriptionId, context.tenantId, productId, now, now, now]);
    if (inserted.changes !== 1) {
      const raced = await db.get(`SELECT * FROM tenant_subscriptions
        WHERE tenant_id = ? AND product_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`, [context.tenantId, productId]);
      if (!raced) throw new Error("Subscription request conflicted without a reusable pending row");
      const jobId = raced.checkout_url ? null : await this.queueBillingCheckout(db, context, product, raced.id);
      return {
        subscriptionId: raced.id,
        status: raced.status,
        checkoutStatus: raced.checkout_url ? checkoutStatus(raced, true) : jobId ? "queued" : "manual_review",
        checkoutUrl: raced.checkout_url ?? null,
        jobId,
        reused: true
      };
    }
    const jobId = await this.queueBillingCheckout(db, context, product, subscriptionId, now);
    await writeAudit(db, context, { action: "subscription.select", entityType: "tenant_subscription", entityId: subscriptionId, after: { productCode: product.code, status: "pending" } });
    return { subscriptionId, status: "pending", checkoutStatus: jobId ? "queued" : "manual_review", checkoutUrl: null, jobId, reused: false };
  }

  async issueOwnRadiusCredential(context, input, db = this.db) {
    requireWrite(context, PERMISSIONS.INTEGRATION_WRITE);
    if (context.role !== "owner") throw forbidden("إصدار مفتاح Site Agent مخصص لصاحب الشبكة");
    const existing = await db.get("SELECT id,secret_ciphertext FROM integrations WHERE tenant_id=? AND type='radius'",
      [context.tenantId]);
    const rotating = Boolean(existing?.secret_ciphertext);
    const expected = rotating ? "ROTATE" : "ISSUE";
    if (input.confirmation !== expected) throw validationError(
      rotating ? "يوجد مفتاح سابق؛ أكّد التدوير بكلمة ROTATE لأن الوكيل القديم سيتوقف حتى تحديث مفتاحه"
        : "أكّد إصدار المفتاح الجديد بكلمة ISSUE");
    const tenant = await db.get("SELECT id,slug,status FROM tenants WHERE id=?", [context.tenantId]);
    if (!tenant || tenant.status !== "active") throw forbidden("شبكة غير نشطة");
    const now = nowIso();
    const signingSecret = createOpaqueToken();
    const encrypted = encryptSecret(toJson({ signingSecret, version: 1, issuedAt: now }), this.config.encryptionKey);
    if (existing) {
      await db.run(`UPDATE integrations SET status='active',config_json=?,secret_ciphertext=?,
        last_error=NULL,last_seen_at=NULL,updated_at=? WHERE id=? AND tenant_id=?`,
      [toJson({ mode: "agent-routeros-tls", version: 2 }), encrypted, now, existing.id, context.tenantId]);
      if (rotating) await db.run(
        "UPDATE radius_nodes SET status='offline',updated_at=? WHERE tenant_id=?",
        [now, context.tenantId]);
    } else {
      await db.run(`INSERT INTO integrations
        (id,tenant_id,type,status,config_json,secret_ciphertext,last_error,last_seen_at,created_at,updated_at)
        VALUES (?,?,'radius','active',?,?,NULL,NULL,?,?)`,
      [id("int"), context.tenantId, toJson({ mode: "agent-routeros-tls", version: 2 }), encrypted, now, now]);
    }
    await writeAudit(db, context, { action: rotating ? "integration.radius.credential.rotate" : "integration.radius.credential.issue",
      entityType: "integration", entityId: existing?.id ?? null, reason: input.reason,
      after: { mode: "agent-routeros-tls", credentialShownOnce: true, oldAgentDisconnected: rotating } });
    return { tenantId: context.tenantId, tenantSlug: tenant.slug, connectorSecret: signingSecret,
      issuedAt: now, rotated: rotating };
  }

  async telegramIntegration(context) {
    requirePermission(context, PERMISSIONS.INTEGRATION_READ);
    const row = await this.db.get("SELECT id, status, config_json, last_error, last_seen_at, updated_at FROM integrations WHERE tenant_id = ? AND type = 'telegram'", [context.tenantId]);
    if (!row) return { status: "not_connected" };
    const config = parseJson(row.config_json, {});
    return { id: row.id, status: row.status, chatLabel: config.chatLabel ?? null, lastError: row.last_error, lastSeenAt: row.last_seen_at, updatedAt: row.updated_at };
  }

  async configureTelegram(context, input, db = this.db) {
    requireWrite(context, PERMISSIONS.INTEGRATION_WRITE);
    const now = nowIso();
    const existing = await db.get("SELECT id FROM integrations WHERE tenant_id = ? AND type = 'telegram'", [context.tenantId]);
    const encrypted = encryptSecret(toJson({ chatId: input.chatId }), this.config.encryptionKey);
    const configJson = toJson({ chatLabel: input.chatLabel ?? "Telegram", enabledSeverities: input.enabledSeverities });
    if (existing) {
      await db.run(`UPDATE integrations SET status = 'active', config_json = ?, secret_ciphertext = ?, last_error = NULL, updated_at = ?
        WHERE id = ? AND tenant_id = ?`, [configJson, encrypted, now, existing.id, context.tenantId]);
    } else {
      await db.run(`INSERT INTO integrations
        (id, tenant_id, type, status, config_json, secret_ciphertext, last_error, last_seen_at, created_at, updated_at)
        VALUES (?, ?, 'telegram', 'active', ?, ?, NULL, NULL, ?, ?)`, [id("int"), context.tenantId, configJson, encrypted, now, now]);
    }
    await writeAudit(db, context, { action: "integration.telegram.configure", entityType: "integration", entityId: existing?.id, after: { chatLabel: input.chatLabel, enabledSeverities: input.enabledSeverities } });
    return { status: "active", chatLabel: input.chatLabel ?? "Telegram" };
  }

  async testTelegram(context, reason, db = this.db) {
    requireWrite(context, PERMISSIONS.INTEGRATION_WRITE);
    const integration = await db.get("SELECT * FROM integrations WHERE tenant_id=? AND type='telegram' AND status='active'", [context.tenantId]);
    if (!integration?.secret_ciphertext) throw notFound("اربط بوت Telegram أولًا");
    let chatId;
    try { chatId = JSON.parse(decryptSecret(integration.secret_ciphertext, this.config.encryptionKey)).chatId; }
    catch { throw validationError("بيانات Telegram تالفة؛ أعد الربط"); }
    const jobId = id("job"); const now = nowIso();
    await db.run(`INSERT INTO outbox
      (id,tenant_id,topic,payload_json,status,attempts,available_at,locked_at,last_error,created_at,updated_at)
      VALUES (?,?,'telegram.message',?,'pending',0,?,NULL,NULL,?,?)`, [jobId, context.tenantId,
      toJson({ chatId, text: `✅ اتصال UCHIHA RADIUS يعمل لشبكة ${context.tenantName}.` }), now, now, now]);
    await writeAudit(db, context, { action: "integration.telegram.test", entityType: "integration",
      entityId: integration.id, reason, after: { jobId } });
    return { status: "queued", jobId };
  }

  async disableTelegram(context, reason, db = this.db) {
    requireWrite(context, PERMISSIONS.INTEGRATION_WRITE);
    const integration = await db.get("SELECT * FROM integrations WHERE tenant_id=? AND type='telegram'", [context.tenantId]);
    if (!integration) throw notFound("تكامل Telegram غير موجود");
    if (integration.status === "disabled") return { id: integration.id, status: "disabled", changed: false };
    const now = nowIso();
    await db.run(`UPDATE integrations SET status='disabled',secret_ciphertext=NULL,last_error=NULL,updated_at=?
      WHERE id=? AND tenant_id=?`, [now, integration.id, context.tenantId]);
    await writeAudit(db, context, { action: "integration.telegram.disable", entityType: "integration",
      entityId: integration.id, reason, before: { status: integration.status }, after: { status: "disabled", credentialRemoved: true } });
    return { id: integration.id, status: "disabled", changed: true };
  }

  async listMembers(context) {
    requirePermission(context, PERMISSIONS.TENANT_MANAGE);
    const rows = await this.db.all(`SELECT m.id, m.role, m.status, m.created_at, m.updated_at,
      u.id AS user_id, u.email, u.display_name, u.avatar_url
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, m.created_at ASC`, [context.tenantId]);
    return { items: rows.map((row) => ({
      id: row.id, userId: row.user_id, email: row.email, displayName: row.display_name,
      avatarUrl: row.avatar_url, role: row.role, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at
    })) };
  }

  async inviteMember(context, input, db = this.db) {
    requireWrite(context, PERMISSIONS.TENANT_MANAGE);
    const email = input.email.toLowerCase();
    const now = nowIso();
    let user = await db.get("SELECT id, display_name FROM users WHERE email = ?", [email]);
    if (!user) {
      const userId = id("usr");
      await db.run(`INSERT INTO users
        (id, email, google_sub, display_name, avatar_url, platform_role, created_at, updated_at)
        VALUES (?, ?, NULL, ?, NULL, 'none', ?, ?)`, [userId, email, input.displayName, now, now]);
      user = { id: userId, display_name: input.displayName };
    }
    const existing = await db.get("SELECT * FROM memberships WHERE tenant_id = ? AND user_id = ?", [context.tenantId, user.id]);
    if (existing?.status === "active" || existing?.status === "invited") throw validationError("هذا البريد عضو أو مدعو بالفعل");
    await requireCapacity(db, context, "team");
    const membershipId = existing?.id ?? id("mem");
    if (existing) {
      await db.run("UPDATE memberships SET role = ?, status = 'invited', updated_at = ? WHERE id = ? AND tenant_id = ?",
        [input.role, now, existing.id, context.tenantId]);
    } else {
      await db.run(`INSERT INTO memberships
        (id, tenant_id, user_id, role, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'invited', ?, ?)`, [membershipId, context.tenantId, user.id, input.role, now, now]);
    }
    await writeAudit(db, context, { action: "member.invite", entityType: "membership", entityId: membershipId, reason: input.reason, after: { email, role: input.role } });
    return { id: membershipId, email, displayName: user.display_name, role: input.role, status: "invited", instruction: "يسجل العضو دخوله بحساب Google المطابق للبريد" };
  }

  async updateMember(context, membershipId, input, db = this.db) {
    requireWrite(context, PERMISSIONS.TENANT_MANAGE);
    const before = await db.get(`SELECT m.*, u.email FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.id = ? AND m.tenant_id = ?`, [membershipId, context.tenantId]);
    if (!before) throw notFound("عضو الفريق غير موجود");
    if (before.user_id === context.user.id && input.status === "disabled") throw validationError("لا يمكنك تعطيل عضويتك الحالية");
    if (before.role === "owner" && (input.role !== "owner" || input.status === "disabled")) {
      const owners = await db.get("SELECT COUNT(*) AS total FROM memberships WHERE tenant_id = ? AND role = 'owner' AND status = 'active'", [context.tenantId]);
      if (Number(owners.total) <= 1) throw validationError("لا يمكن إزالة آخر مالك فعّال للشبكة");
    }
    await db.run("UPDATE memberships SET role = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
      [input.role, input.status, nowIso(), membershipId, context.tenantId]);
    await writeAudit(db, context, { action: "member.update", entityType: "membership", entityId: membershipId, reason: input.reason, before: { email: before.email, role: before.role, status: before.status }, after: { role: input.role, status: input.status } });
    return { id: membershipId, role: input.role, status: input.status };
  }
}
