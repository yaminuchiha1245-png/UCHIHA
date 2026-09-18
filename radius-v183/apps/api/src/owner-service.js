import { requirePlatformOwner } from "./guards.js";
import { notFound, validationError } from "./errors.js";
import { writeAudit } from "./audit.js";
import { addDays, id, nowIso, pageFromQuery, parseJson, timestampMillis, toJson } from "./utils.js";
import { activationCodeHint, createActivationCode, createOpaqueToken, encryptSecret, hashActivationCode } from "./security.js";

const LIVE_SUBSCRIPTION_STATUSES = new Set(["trialing", "active", "grace"]);

function activationCodeView(row) {
  const now = nowIso();
  const effectiveStatus = row.status === "active" && timestampMillis(row.expires_at) <= timestampMillis(now) ? "expired" : row.status;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    codeHint: row.code_hint,
    durationDays: Number(row.duration_days),
    status: effectiveStatus,
    storedStatus: row.status,
    expiresAt: row.expires_at,
    redeemedAt: row.redeemed_at,
    issuedToName: row.issued_to_name,
    issuedToEmail: row.issued_to_email,
    issuedToPhone: row.issued_to_phone,
    note: row.note,
    installationHint: row.installation_hint ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class OwnerService {
  constructor(db, config) {
    this.db = db;
    this.config = config;
  }

  async overview(context) {
    requirePlatformOwner(context);
    const [tenants, subscriptions, users, subscribers, alerts, outbox] = await Promise.all([
      this.db.get(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended FROM tenants`),
      this.db.get(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status IN ('trialing', 'active', 'grace') THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status IN ('past_due', 'expired') THEN 1 ELSE 0 END) AS attention FROM tenant_subscriptions`),
      this.db.get("SELECT COUNT(*) AS total FROM users"),
      this.db.get("SELECT COUNT(*) AS total FROM subscribers"),
      this.db.get("SELECT COUNT(*) AS total FROM alerts WHERE status = 'open' AND severity IN ('warning', 'critical')"),
      this.db.get("SELECT COUNT(*) AS total FROM outbox WHERE status IN ('pending', 'failed')")
    ]);
    return {
      metrics: {
        tenants: Number(tenants?.total ?? 0),
        activeTenants: Number(tenants?.active ?? 0),
        suspendedTenants: Number(tenants?.suspended ?? 0),
        subscriptions: Number(subscriptions?.total ?? 0),
        activeSubscriptions: Number(subscriptions?.active ?? 0),
        subscriptionsNeedingAttention: Number(subscriptions?.attention ?? 0),
        users: Number(users?.total ?? 0),
        subscribers: Number(subscribers?.total ?? 0),
        openAlerts: Number(alerts?.total ?? 0),
        pendingJobs: Number(outbox?.total ?? 0)
      }
    };
  }

  async listTenants(context, query = {}) {
    requirePlatformOwner(context);
    const { limit, offset } = pageFromQuery(query);
    const rows = await this.db.all(`SELECT t.id, t.name, t.slug, t.currency, t.time_zone, t.status, t.created_at, t.updated_at,
      (SELECT COUNT(*) FROM subscribers s WHERE s.tenant_id = t.id) AS subscribers_count,
      (SELECT COUNT(*) FROM memberships m WHERE m.tenant_id = t.id AND m.status = 'active') AS members_count,
      (SELECT ts.status FROM tenant_subscriptions ts WHERE ts.tenant_id = t.id ORDER BY ts.created_at DESC LIMIT 1) AS subscription_status,
      (SELECT p.name_ar FROM tenant_subscriptions ts JOIN subscription_products p ON p.id = ts.product_id WHERE ts.tenant_id = t.id ORDER BY ts.created_at DESC LIMIT 1) AS product_name
      FROM tenants t ORDER BY t.created_at DESC LIMIT ? OFFSET ?`, [limit, offset]);
    const count = await this.db.get("SELECT COUNT(*) AS total FROM tenants");
    return { items: rows, pagination: { limit, offset, total: Number(count.total) } };
  }

  async tenant(context, tenantId) {
    requirePlatformOwner(context);
    const tenant = await this.db.get("SELECT id,name,slug,currency,time_zone,status,created_at,updated_at FROM tenants WHERE id=?", [tenantId]);
    if (!tenant) throw notFound("الشبكة غير موجودة");
    const [subscription, usage, members, integrations, nodes] = await Promise.all([
      this.db.get(`SELECT ts.id,ts.status,ts.provider,ts.external_id,ts.starts_at,ts.ends_at,ts.created_at,ts.updated_at,
        p.id AS product_id,p.code AS product_code,p.name_ar AS product_name,p.price_minor,p.currency,p.billing_period
        FROM tenant_subscriptions ts JOIN subscription_products p ON p.id=ts.product_id
        WHERE ts.tenant_id=? ORDER BY ts.created_at DESC LIMIT 1`, [tenantId]),
      this.db.get(`SELECT
        (SELECT COUNT(*) FROM subscribers WHERE tenant_id=?) AS subscribers,
        (SELECT COUNT(*) FROM radius_sessions WHERE tenant_id=? AND status='active') AS active_sessions,
        (SELECT COUNT(*) FROM network_devices WHERE tenant_id=?) AS devices,
        (SELECT COUNT(*) FROM support_tickets WHERE tenant_id=? AND status IN ('open','in_progress')) AS open_tickets,
        (SELECT COALESCE(SUM(amount_minor-paid_minor),0) FROM invoices WHERE tenant_id=? AND status IN ('unpaid','partial','overdue')) AS outstanding_minor`,
      [tenantId, tenantId, tenantId, tenantId, tenantId]),
      this.db.all(`SELECT m.id,m.role,m.status,m.created_at,u.id AS user_id,u.email,u.display_name
        FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? ORDER BY m.created_at`, [tenantId]),
      this.db.all(`SELECT id,type,status,config_json,last_error,last_seen_at,updated_at
        FROM integrations WHERE tenant_id=? ORDER BY type`, [tenantId]),
      this.db.all(`SELECT id,agent_id,name,role,status,version,last_seen_at,last_error
        FROM radius_nodes WHERE tenant_id=? ORDER BY role,name`, [tenantId])
    ]);
    return {
      ...tenant,
      subscription: subscription ? { id: subscription.id, status: subscription.status, provider: subscription.provider,
        externalId: subscription.external_id, startsAt: subscription.starts_at, endsAt: subscription.ends_at,
        product: { id: subscription.product_id, code: subscription.product_code, nameAr: subscription.product_name,
          priceMinor: Number(subscription.price_minor), currency: subscription.currency, billingPeriod: subscription.billing_period } } : null,
      usage: { subscribers: Number(usage?.subscribers ?? 0), activeSessions: Number(usage?.active_sessions ?? 0),
        devices: Number(usage?.devices ?? 0), openTickets: Number(usage?.open_tickets ?? 0),
        outstandingMinor: Number(usage?.outstanding_minor ?? 0) },
      members: members.map((row) => ({ id: row.id, userId: row.user_id, email: row.email,
        displayName: row.display_name, role: row.role, status: row.status, createdAt: row.created_at })),
      integrations: integrations.map((row) => ({ id: row.id, type: row.type, status: row.status,
        config: parseJson(row.config_json, {}), lastError: row.last_error, lastSeenAt: row.last_seen_at, updatedAt: row.updated_at })),
      radiusNodes: nodes.map((row) => ({ id: row.id, agentId: row.agent_id, name: row.name, role: row.role,
        status: row.status, version: row.version, lastSeenAt: row.last_seen_at, lastError: row.last_error }))
    };
  }

  async products(context) {
    requirePlatformOwner(context);
    const rows = await this.db.all(`SELECT id,code,name_ar,price_minor,currency,billing_period,limits_json,active,created_at,updated_at
      FROM subscription_products ORDER BY active DESC,price_minor`);
    return { items: rows.map((row) => ({ id: row.id, code: row.code, nameAr: row.name_ar,
      priceMinor: Number(row.price_minor), currency: row.currency, billingPeriod: row.billing_period,
      limits: parseJson(row.limits_json, {}), active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at })) };
  }

  async listActivationCodes(context, query = {}) {
    requirePlatformOwner(context);
    const { limit, offset } = pageFromQuery(query);
    const where = [];
    const params = [];
    if (query.status && query.status !== "all") {
      if (query.status === "expired") where.push("ac.status = 'active' AND ac.expires_at <= ?"), params.push(nowIso());
      else where.push("ac.status = ?"), params.push(query.status);
    }
    if (query.tenantId) where.push("ac.tenant_id = ?"), params.push(query.tenantId);
    if (query.q) {
      const search = `%${String(query.q).trim().toLowerCase()}%`;
      where.push(`(LOWER(t.name) LIKE ? OR LOWER(COALESCE(ac.issued_to_name,'')) LIKE ? OR
        LOWER(COALESCE(ac.issued_to_email,'')) LIKE ? OR LOWER(COALESCE(ac.issued_to_phone,'')) LIKE ? OR
        LOWER(COALESCE(ac.note,'')) LIKE ? OR LOWER(ac.code_hint) LIKE ?)`);
      params.push(search, search, search, search, search, search);
    }
    const condition = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const select = `FROM activation_codes ac
      JOIN tenants t ON t.id = ac.tenant_id
      JOIN subscription_products p ON p.id = ac.product_id
      LEFT JOIN app_installations ai ON ai.activation_code_id = ac.id
      ${condition}`;
    const rows = await this.db.all(`SELECT ac.*, t.name AS tenant_name, p.code AS product_code, p.name_ar AS product_name,
      ai.installation_hint ${select} ORDER BY ac.created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const count = await this.db.get(`SELECT COUNT(*) AS total ${select}`, params);
    return { items: rows.map(activationCodeView), pagination: { limit, offset, total: Number(count?.total ?? 0) } };
  }

  async createActivationCode(context, input, db = this.db) {
    requirePlatformOwner(context);
    const [tenant, product] = await Promise.all([
      db.get("SELECT id, name FROM tenants WHERE id = ? AND status <> 'closed'", [input.tenantId]),
      db.get("SELECT id, code, name_ar FROM subscription_products WHERE id = ? AND active = TRUE", [input.productId])
    ]);
    if (!tenant) throw validationError("الشبكة غير موجودة أو مغلقة");
    if (!product) throw validationError("خطة اشتراك المنصة غير صالحة");
    const code = createActivationCode();
    const now = nowIso();
    const codeId = id("act");
    await db.run(`INSERT INTO activation_codes
      (id, tenant_id, product_id, code_hash, code_hint, duration_days, status, expires_at, redeemed_at,
       redeemed_by_user_id, issued_to_name, issued_to_email, issued_to_phone, note, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`, [
      codeId, input.tenantId, input.productId, hashActivationCode(code), activationCodeHint(code), input.durationDays,
      input.expiresAt, input.issuedToName ?? null, input.issuedToEmail ?? null, input.issuedToPhone ?? null,
      input.note ?? null, context.user.id, now, now
    ]);
    await writeAudit(db, context, {
      tenantId: input.tenantId,
      action: "activation_code.create",
      entityType: "activation_code",
      entityId: codeId,
      reason: input.reason,
      after: { codeHint: activationCodeHint(code), durationDays: input.durationDays, expiresAt: input.expiresAt, issuedToEmail: input.issuedToEmail ?? null }
    });
    const row = await db.get(`SELECT ac.*, t.name AS tenant_name, p.code AS product_code, p.name_ar AS product_name,
      NULL AS installation_hint FROM activation_codes ac JOIN tenants t ON t.id = ac.tenant_id
      JOIN subscription_products p ON p.id = ac.product_id WHERE ac.id = ?`, [codeId]);
    return { ...activationCodeView(row), code };
  }

  async revokeActivationCode(context, codeId, reason, db = this.db) {
    requirePlatformOwner(context);
    const before = await db.get("SELECT * FROM activation_codes WHERE id = ?", [codeId]);
    if (!before) throw notFound("كود التفعيل غير موجود");
    if (before.status !== "active") throw validationError("لا يمكن إلغاء كود مستخدم أو ملغي");
    const now = nowIso();
    await db.run("UPDATE activation_codes SET status = 'revoked', updated_at = ? WHERE id = ? AND status = 'active'", [now, codeId]);
    await writeAudit(db, context, { tenantId: before.tenant_id, action: "activation_code.revoke", entityType: "activation_code", entityId: codeId, reason,
      before: { status: before.status }, after: { status: "revoked" } });
    return { id: codeId, status: "revoked" };
  }

  async listInstallations(context, query = {}) {
    requirePlatformOwner(context);
    const { limit, offset } = pageFromQuery(query);
    const where = [];
    const params = [];
    if (query.status && query.status !== "all") where.push("ai.status = ?"), params.push(query.status);
    if (query.tenantId) where.push("ai.tenant_id = ?"), params.push(query.tenantId);
    if (query.q) {
      const search = `%${String(query.q).trim().toLowerCase()}%`;
      where.push("(LOWER(ai.installation_hint) LIKE ? OR LOWER(COALESCE(u.email,'')) LIKE ? OR LOWER(COALESCE(t.name,'')) LIKE ?)");
      params.push(search, search, search);
    }
    const condition = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const from = `FROM app_installations ai LEFT JOIN users u ON u.id = ai.user_id LEFT JOIN tenants t ON t.id = ai.tenant_id ${condition}`;
    const rows = await this.db.all(`SELECT ai.id, ai.installation_hint, ai.platform, ai.status, ai.tenant_id, ai.user_id,
      ai.first_seen_at, ai.last_seen_at, ai.activated_at, ai.revoked_at, u.email, u.display_name, t.name AS tenant_name
      ${from} ORDER BY ai.last_seen_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const count = await this.db.get(`SELECT COUNT(*) AS total ${from}`, params);
    return { items: rows.map((row) => ({ id: row.id, hint: row.installation_hint, platform: row.platform, status: row.status,
      tenantId: row.tenant_id, tenantName: row.tenant_name, userId: row.user_id, email: row.email,
      displayName: row.display_name, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at,
      activatedAt: row.activated_at, revokedAt: row.revoked_at })), pagination: { limit, offset, total: Number(count?.total ?? 0) } };
  }

  async setInstallationStatus(context, installationId, status, reason, db = this.db) {
    requirePlatformOwner(context);
    const before = await db.get("SELECT * FROM app_installations WHERE id = ?", [installationId]);
    if (!before) throw notFound("تثبيت التطبيق غير موجود");
    const now = nowIso();
    await db.run(`UPDATE app_installations SET status = ?, revoked_at = ?, updated_at = ? WHERE id = ?`, [
      status, status === "blocked" ? now : null, now, installationId
    ]);
    if (status === "blocked") await db.run("UPDATE auth_sessions SET revoked_at = ? WHERE installation_hash = ? AND revoked_at IS NULL", [now, before.installation_hash]);
    await writeAudit(db, context, { tenantId: before.tenant_id, action: `app_installation.${status}`, entityType: "app_installation",
      entityId: installationId, reason, before: { status: before.status }, after: { status } });
    return { id: installationId, status };
  }

  async createTenant(context, input, db = this.db) {
    requirePlatformOwner(context);
    const product = await db.get("SELECT id FROM subscription_products WHERE id=? AND active=TRUE", [input.productId]);
    if (!product) throw validationError("خطة اشتراك المنصة غير صالحة");
    const now = nowIso();
    const tenantId = id("ten");
    const ownerId = id("usr");
    const membershipId = id("mem");
    await db.run(`INSERT INTO tenants
      (id, name, slug, currency, time_zone, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`, [tenantId, input.name, input.slug, input.currency, input.timeZone, now, now]);
    let owner = await db.get("SELECT id FROM users WHERE email = ?", [input.ownerEmail.toLowerCase()]);
    if (!owner) {
      await db.run(`INSERT INTO users
        (id, email, google_sub, display_name, avatar_url, platform_role, created_at, updated_at)
        VALUES (?, ?, NULL, ?, NULL, 'none', ?, ?)`, [ownerId, input.ownerEmail.toLowerCase(), input.ownerName, now, now]);
      owner = { id: ownerId };
    }
    await db.run(`INSERT INTO memberships
      (id, tenant_id, user_id, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'owner', 'active', ?, ?)`, [membershipId, tenantId, owner.id, now, now]);
    await db.run(`INSERT INTO tenant_subscriptions
      (id, tenant_id, product_id, status, provider, external_id, starts_at, ends_at, created_at, updated_at)
      VALUES (?, ?, ?, 'trialing', 'internal', NULL, ?, ?, ?, ?)`,
    [id("sub"), tenantId, input.productId, now, addDays(now, 14), now, now]);
    await writeAudit(db, context, { tenantId, action: "tenant.create", entityType: "tenant", entityId: tenantId, reason: input.reason, after: { name: input.name, slug: input.slug, ownerEmail: input.ownerEmail } });
    return { id: tenantId, name: input.name, slug: input.slug, status: "active", ownerUserId: owner.id };
  }

  async setTenantStatus(context, tenantId, status, reason, db = this.db) {
    requirePlatformOwner(context);
    if (!reason || reason.trim().length < 5) throw validationError("يلزم سبب واضح لا يقل عن 5 أحرف");
    const tenant = await db.get("SELECT * FROM tenants WHERE id = ?", [tenantId]);
    if (!tenant) throw notFound("الشبكة غير موجودة");
    await db.run("UPDATE tenants SET status = ?, updated_at = ? WHERE id = ?", [status, nowIso(), tenantId]);
    await writeAudit(db, context, { tenantId, action: `tenant.${status}`, entityType: "tenant", entityId: tenantId, reason, before: { status: tenant.status }, after: { status } });
    return { id: tenantId, status };
  }

  async setSubscriptionStatus(context, tenantId, input, db = this.db) {
    requirePlatformOwner(context);
    if (!input.reason || input.reason.trim().length < 5) throw validationError("يلزم سبب واضح لا يقل عن 5 أحرف");
    const tenant = await db.get("SELECT id FROM tenants WHERE id = ?", [tenantId]);
    if (!tenant) throw notFound("الشبكة غير موجودة");
    if (input.productId) {
      const product = await db.get("SELECT id FROM subscription_products WHERE id=? AND active=TRUE", [input.productId]);
      if (!product) throw validationError("خطة اشتراك المنصة غير صالحة");
    }
    const current = await db.get("SELECT * FROM tenant_subscriptions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1", [tenantId]);
    const now = nowIso();
    if (current) {
      if (LIVE_SUBSCRIPTION_STATUSES.has(input.status)) {
        await db.run(`UPDATE tenant_subscriptions SET status = 'canceled', ends_at = COALESCE(ends_at, ?), updated_at = ?
          WHERE tenant_id = ? AND id <> ? AND status IN ('trialing', 'active', 'grace')`, [now, now, tenantId, current.id]);
      }
      await db.run("UPDATE tenant_subscriptions SET product_id = ?, status = ?, ends_at = ?, checkout_url = NULL, checkout_expires_at = NULL, updated_at = ? WHERE id = ?",
        [input.productId ?? current.product_id, input.status, input.endsAt ?? current.ends_at, now, current.id]);
    } else {
      if (!input.productId) throw validationError("يلزم تحديد خطة الاشتراك");
      await db.run(`INSERT INTO tenant_subscriptions
        (id, tenant_id, product_id, status, provider, external_id, starts_at, ends_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'manual', NULL, ?, ?, ?, ?)`,
      [id("sub"), tenantId, input.productId, input.status, now, input.endsAt ?? null, now, now]);
    }
    await writeAudit(db, context, { tenantId, action: "subscription.status.update", entityType: "tenant_subscription", entityId: current?.id, reason: input.reason,
      before: current ? { productId: current.product_id, status: current.status, endsAt: current.ends_at } : null,
      after: { productId: input.productId ?? current?.product_id, status: input.status, endsAt: input.endsAt ?? current?.ends_at ?? null } });
    return { tenantId, productId: input.productId ?? current?.product_id, status: input.status, endsAt: input.endsAt ?? current?.ends_at ?? null };
  }

  async rotateRadiusCredential(context, tenantId, reason, db = this.db) {
    requirePlatformOwner(context);
    if (!reason || reason.trim().length < 10) throw validationError("اكتب سبب تدوير المفتاح بوضوح");
    const tenant = await db.get("SELECT id, slug FROM tenants WHERE id = ?", [tenantId]);
    if (!tenant) throw notFound("الشبكة غير موجودة");
    const now = nowIso();
    const signingSecret = createOpaqueToken();
    const ciphertext = encryptSecret(toJson({ signingSecret, version: 1, issuedAt: now }), this.config.encryptionKey);
    const existing = await db.get("SELECT id FROM integrations WHERE tenant_id = ? AND type = 'radius'", [tenantId]);
    if (existing) {
      await db.run(`UPDATE integrations SET status = 'active', config_json = ?, secret_ciphertext = ?,
        last_error = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      [toJson({ mode: "agent-routeros-tls", version: 2 }), ciphertext, now, existing.id, tenantId]);
    } else {
      await db.run(`INSERT INTO integrations
        (id, tenant_id, type, status, config_json, secret_ciphertext, last_error, last_seen_at, created_at, updated_at)
        VALUES (?, ?, 'radius', 'active', ?, ?, NULL, NULL, ?, ?)`,
      [id("int"), tenantId, toJson({ mode: "agent-routeros-tls", version: 2 }), ciphertext, now, now]);
    }
    await writeAudit(db, context, {
      tenantId,
      action: "integration.radius.credential.rotate",
      entityType: "integration",
      entityId: existing?.id ?? null,
      reason,
      after: { mode: "agent-routeros-tls", secretShownOnce: true }
    });
    return { tenantId, tenantSlug: tenant.slug, connectorSecret: signingSecret, issuedAt: now };
  }

  async audit(context, query = {}) {
    requirePlatformOwner(context);
    const { limit, offset } = pageFromQuery(query);
    const rows = await this.db.all(`SELECT a.id, a.tenant_id, t.name AS tenant_name, a.actor_type, a.action, a.entity_type,
      a.entity_id, a.reason, a.request_id, a.created_at, u.display_name AS actor_name, u.email AS actor_email
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id LEFT JOIN tenants t ON t.id = a.tenant_id
      ORDER BY a.created_at DESC LIMIT ? OFFSET ?`, [limit, offset]);
    const count = await this.db.get("SELECT COUNT(*) AS total FROM audit_logs");
    return { items: rows, pagination: { limit, offset, total: Number(count.total) } };
  }

  async jobs(context, query = {}) {
    requirePlatformOwner(context);
    const { limit, offset } = pageFromQuery(query);
    const rows = await this.db.all(`SELECT id, tenant_id, topic, status, attempts, available_at, last_error, created_at, updated_at
      FROM outbox ORDER BY created_at DESC LIMIT ? OFFSET ?`, [limit, offset]);
    const count = await this.db.get("SELECT COUNT(*) AS total FROM outbox");
    return { items: rows, pagination: { limit, offset, total: Number(count.total) } };
  }

  async retryJob(context, jobId, reason, db = this.db) {
    requirePlatformOwner(context);
    const job = await db.get("SELECT * FROM outbox WHERE id=?", [jobId]);
    if (!job) throw notFound("المهمة غير موجودة");
    if (job.status === "processing") throw validationError("المهمة قيد التنفيذ الآن");
    if (job.status === "sent") throw validationError("المهمة مكتملة ولا تحتاج إعادة محاولة");
    const now = nowIso();
    const updated = await db.run(`UPDATE outbox SET status='pending',attempts=0,available_at=?,locked_at=NULL,last_error=NULL,updated_at=?
      WHERE id=? AND status IN ('pending','failed')`, [now, now, jobId]);
    if (updated.changes !== 1) throw validationError("تغيرت حالة المهمة؛ حدّث القائمة قبل إعادة المحاولة");
    await writeAudit(db, context, { tenantId: job.tenant_id, action: "outbox.job.retry", entityType: "outbox_job",
      entityId: jobId, reason, before: { status: job.status, attempts: Number(job.attempts), lastError: job.last_error },
      after: { status: "pending", attempts: 0 } });
    return { id: jobId, tenantId: job.tenant_id, status: "pending", attempts: 0, availableAt: now };
  }
}
