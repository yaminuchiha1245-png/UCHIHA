import { ACTIVE_SUBSCRIPTION_STATUSES, permissionsFor } from "@uchiha-radius/contracts";
import { AppError, notFound } from "./errors.js";
import { API_ERROR_CODES } from "@uchiha-radius/contracts";
import { createOpaqueToken, hashInstallationId, installationHint, normalizeInstallationId, sha256 } from "./security.js";
import { addHours, id, nowIso } from "./utils.js";
import { DEMO } from "./seed.js";

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    platformRole: row.platform_role
  };
}

export class AuthService {
  constructor({ db, config, googleVerifier }) {
    this.db = db;
    this.config = config;
    this.googleVerifier = googleVerifier;
  }

  async issueSession(user, metadata = {}) {
    const rawToken = createOpaqueToken();
    const now = nowIso();
    const installationId = metadata.installationId ? normalizeInstallationId(metadata.installationId) : null;
    const installationHash = installationId ? hashInstallationId(installationId) : null;
    if (this.config.requireInstallationBinding && user.platform_role !== "platform_owner" && !installationHash) {
      throw new AppError(400, API_ERROR_CODES.VALIDATION_ERROR, "تعذر إنشاء معرّف تثبيت آمن لهذا التطبيق");
    }
    if (installationHash) {
      const existing = await this.db.get("SELECT * FROM app_installations WHERE installation_hash = ?", [installationHash]);
      if (existing?.status === "blocked") throw new AppError(403, API_ERROR_CODES.FORBIDDEN, "هذا التثبيت موقوف من الإدارة");
      if (existing?.user_id && existing.user_id !== user.id) {
        throw new AppError(403, API_ERROR_CODES.FORBIDDEN, "معرّف التثبيت مرتبط بحساب آخر");
      }
      if (existing) {
        await this.db.run(`UPDATE app_installations SET user_id = ?, platform = ?, last_seen_at = ?, updated_at = ?
          WHERE id = ?`, [user.id, metadata.platform ?? existing.platform ?? "unknown", now, now, existing.id]);
      } else {
        await this.db.run(`INSERT INTO app_installations
          (id, installation_hash, installation_hint, tenant_id, user_id, activation_code_id, platform, status,
           metadata_json, first_seen_at, last_seen_at, activated_at, revoked_at, created_at, updated_at)
          VALUES (?, ?, ?, NULL, ?, NULL, ?, 'active', '{}', ?, ?, NULL, NULL, ?, ?)`, [
          id("ins"), installationHash, installationHint(installationId), user.id, metadata.platform ?? "unknown", now, now, now, now
        ]);
      }
    }
    await this.db.run(`INSERT INTO auth_sessions
      (id, user_id, token_hash, expires_at, revoked_at, last_seen_at, user_agent, ip_address, installation_hash, created_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`, [
      id("ses"), user.id, sha256(rawToken), addHours(now, this.config.sessionTtlHours), now,
      metadata.userAgent ?? null, metadata.ipAddress ?? null, installationHash, now
    ]);
    return { token: rawToken, expiresAt: addHours(now, this.config.sessionTtlHours) };
  }

  async loginDev(mode, metadata = {}) {
    if (!this.config.allowDevAuth) throw notFound();
    const email = mode === "owner" ? DEMO.platformEmail : DEMO.email;
    const user = await this.db.get("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) throw new AppError(503, API_ERROR_CODES.INTERNAL_ERROR, "شغّل db:seed أولًا");
    return { ...(await this.issueSession(user, metadata)), user: publicUser(user) };
  }

  async loginGoogle(credential, metadata = {}) {
    const identity = await this.googleVerifier.verify(credential);
    const now = nowIso();
    let user = await this.db.get("SELECT * FROM users WHERE google_sub = ? OR email = ?", [identity.subject, identity.email]);
    if (!user) {
      const userId = id("usr");
      const platformRole = identity.email === this.config.bootstrapOwnerEmail ? "platform_owner" : "none";
      await this.db.run(`INSERT INTO users
        (id, email, google_sub, display_name, avatar_url, platform_role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [userId, identity.email, identity.subject, identity.name, identity.avatarUrl, platformRole, now, now]);
      user = await this.db.get("SELECT * FROM users WHERE id = ?", [userId]);
    } else {
      await this.db.run(`UPDATE users SET google_sub = ?, display_name = ?, avatar_url = ?, updated_at = ? WHERE id = ?`,
        [identity.subject, identity.name, identity.avatarUrl, now, user.id]);
      user = await this.db.get("SELECT * FROM users WHERE id = ?", [user.id]);
    }
    await this.db.run("UPDATE memberships SET status = 'active', updated_at = ? WHERE user_id = ? AND status = 'invited'", [now, user.id]);
    return { ...(await this.issueSession(user, metadata)), user: publicUser(user) };
  }

  async authenticate(rawToken, requestedTenantId = null, requestedInstallationId = null) {
    if (!rawToken) throw new AppError(401, API_ERROR_CODES.AUTH_REQUIRED, "يلزم تسجيل الدخول");
    const now = nowIso();
    const session = await this.db.get(`SELECT s.id AS session_id, s.expires_at, s.last_seen_at AS session_last_seen_at, s.installation_hash, u.*
      FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`, [sha256(rawToken), now]);
    if (!session) throw new AppError(401, API_ERROR_CODES.AUTH_REQUIRED, "انتهت الجلسة أو أُلغيت");

    let installation = null;
    let requestedInstallationHash = null;
    if (requestedInstallationId) requestedInstallationHash = hashInstallationId(requestedInstallationId);
    if (session.installation_hash) {
      if (requestedInstallationHash && requestedInstallationHash !== session.installation_hash) {
        throw new AppError(401, API_ERROR_CODES.AUTH_REQUIRED, "تغير معرّف تثبيت التطبيق لهذه الجلسة");
      }
      installation = await this.db.get("SELECT * FROM app_installations WHERE installation_hash = ?", [session.installation_hash]);
    }
    const ownerBypass = session.platform_role === "platform_owner";
    if (this.config.requireInstallationBinding && !ownerBypass) {
      if (!requestedInstallationHash || !installation) {
        throw new AppError(401, API_ERROR_CODES.AUTH_REQUIRED, "يلزم معرّف تثبيت التطبيق");
      }
      if (installation.status !== "active") throw new AppError(403, API_ERROR_CODES.FORBIDDEN, "هذا التثبيت موقوف من الإدارة");
      if (installation.user_id && installation.user_id !== session.id) {
        throw new AppError(403, API_ERROR_CODES.FORBIDDEN, "التثبيت غير مرتبط بهذا الحساب");
      }
    }

    const memberships = await this.db.all(`SELECT m.tenant_id, m.role, t.name AS tenant_name, t.slug, t.status AS tenant_status, t.currency, t.time_zone
      FROM memberships m JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = ? AND m.status = 'active' ORDER BY m.created_at ASC`, [session.id]);
    let membership = null;
    if (requestedTenantId) membership = memberships.find((item) => item.tenant_id === requestedTenantId) ?? null;
    else membership = memberships[0] ?? null;
    if (requestedTenantId && !membership) throw new AppError(403, API_ERROR_CODES.FORBIDDEN, "الحساب ليس عضوًا في هذه الشبكة");
    if (!ownerBypass && installation?.tenant_id && membership?.tenant_id !== installation.tenant_id) {
      throw new AppError(403, API_ERROR_CODES.FORBIDDEN, "هذا التثبيت مرتبط بشبكة أخرى");
    }

    let subscription = null;
    if (membership) {
      subscription = await this.db.get(`SELECT ts.*, p.code AS product_code, p.name_ar AS product_name, p.limits_json
        FROM tenant_subscriptions ts JOIN subscription_products p ON p.id = ts.product_id
        WHERE ts.tenant_id = ?
        ORDER BY CASE
          WHEN ts.status IN ('active','trialing','grace') AND (ts.ends_at IS NULL OR ts.ends_at > ?) THEN 1
          WHEN ts.status='pending' THEN 2 ELSE 3 END, ts.created_at DESC LIMIT 1`, [membership.tenant_id, now]);
    }
    if (!session.session_last_seen_at || new Date(now).getTime() - new Date(session.session_last_seen_at).getTime() >= 5 * 60_000) {
      await this.db.run("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?", [now, session.session_id]);
    }

    return {
      sessionId: session.session_id,
      user: publicUser(session),
      memberships: memberships.map((item) => ({
        tenantId: item.tenant_id,
        tenantName: item.tenant_name,
        slug: item.slug,
        role: item.role,
        status: item.tenant_status
      })),
      tenantId: membership?.tenant_id ?? null,
      tenantName: membership?.tenant_name ?? null,
      tenantCurrency: membership?.currency ?? null,
      tenantTimeZone: membership?.time_zone ?? null,
      role: membership?.role ?? null,
      installation: installation ? {
        id: installation.id,
        hint: installation.installation_hint,
        status: installation.status,
        platform: installation.platform,
        tenantId: installation.tenant_id,
        activatedAt: installation.activated_at
      } : null,
      installationHash: requestedInstallationHash ?? session.installation_hash ?? null,
      installationBound: ownerBypass || Boolean(installation?.status === "active" && membership?.tenant_id && installation.tenant_id === membership.tenant_id),
      permissions: permissionsFor(membership?.role),
      subscription: subscription ? {
        id: subscription.id,
        status: subscription.status,
        productCode: subscription.product_code,
        productName: subscription.product_name,
        startsAt: subscription.starts_at,
        endsAt: subscription.ends_at,
        checkoutUrl: subscription.checkout_url,
        checkoutExpiresAt: subscription.checkout_expires_at,
        limits: typeof subscription.limits_json === "string" ? JSON.parse(subscription.limits_json) : subscription.limits_json
      } : null,
      canWrite: Boolean((ownerBypass || !this.config.requireInstallationBinding || (installation?.status === "active" && installation.tenant_id === membership?.tenant_id))
        && membership?.tenant_status === "active" && subscription
        && ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status) && (!subscription.ends_at || subscription.ends_at > now))
    };
  }

  async logout(sessionId) {
    await this.db.run("UPDATE auth_sessions SET revoked_at = ? WHERE id = ?", [nowIso(), sessionId]);
  }
}

export function bearerToken(request) {
  const header = request.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}
