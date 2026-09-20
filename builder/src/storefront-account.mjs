import { randomInt, randomUUID } from "node:crypto";
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  randomToken,
  safeText,
  sha256,
  verifyPassword
} from "./security.mjs";
import { generateTotpSecret, totpAuthUri, verifyTotp } from "./totp.mjs";
import {
  PaymentError,
  authenticateCustomer,
  authenticatePlatform,
  customerCookieName,
  customerDto,
  requireCustomerCsrf,
  requirePlatformCsrf,
  requireStoreAccess,
  storeBySlug,
  writeAudit
} from "./payments.mjs";

const ACCOUNT_ROUTE_APPS = new WeakSet();
const SUPPORT_CHANNEL_TYPES = new Set([
  "whatsapp",
  "telegram",
  "instagram",
  "email",
  "tiktok",
  "discord",
  "phone",
  "custom"
]);
const IDENTITY_STATUSES = new Set(["draft", "pending_review", "changes_required", "verified", "rejected"]);
const IDENTITY_FILE_KINDS = new Set(["front", "back", "selfie"]);
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEFAULT_IDENTITY_IMAGE_LIMIT = 4_000_000;

function route(handler) {
  return async (request, reply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      if (error instanceof PaymentError) throw error;
      if (error?.code === "23505") {
        throw new PaymentError(409, "conflict", "القيمة مستخدمة مسبقًا");
      }
      throw error;
    }
  };
}

function requireStoreOwner(store, message = "هذه العملية متاحة لمالك المتجر فقط") {
  if (store.role_key !== "owner") {
    throw new PaymentError(403, "owner_required", message);
  }
}

function requiredText(value, field, maxLength = 200) {
  const text = safeText(value, maxLength);
  if (!text) throw new PaymentError(422, "missing_field", `الحقل ${field} مطلوب`);
  return text;
}

function integer(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, field = "القيمة" } = {}) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new PaymentError(422, "invalid_field", `${field} غير صالح`);
  }
  return parsed;
}

function jsonValue(value, fallback = {}) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function recoveryCode() {
  return `${randomToken(4).slice(0, 4)}-${randomToken(4).slice(0, 4)}`.toUpperCase();
}

function securitySessionDto(row, currentTokenHash) {
  return {
    id: row.token_hash.slice(0, 20),
    current: row.token_hash === currentTokenHash,
    userAgent: row.user_agent || "جهاز غير معروف",
    ipAddress: row.ip_address || null,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at || row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at || null
  };
}

function supportTargetUrl(channel, context = {}) {
  const target = String(channel.target || "").trim();
  const template = channel.message_template ||
    "السلام عليكم،\nأحتاج مساعدة من فريق دعم {store_name}.\n\nاسم المستخدم: {customer_name}\nمعرف العميل: {customer_id}\nرقم الطلب: {order_id}\nالموضوع: {support_context}";
  const message = template
    .replaceAll("{store_name}", context.storeName || "المتجر")
    .replaceAll("{customer_name}", context.customerName || "")
    .replaceAll("{customer_id}", context.customerId || "")
    .replaceAll("{order_id}", context.orderId || "")
    .replaceAll("{support_context}", context.supportContext || "طلب مساعدة");
  if (channel.channel_type === "whatsapp") {
    const phone = target.replace(/\D/g, "");
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  }
  if (channel.channel_type === "telegram") {
    if (/^https:\/\//i.test(target)) return target;
    return `https://t.me/${target.replace(/^@/, "")}`;
  }
  if (channel.channel_type === "email") {
    return `mailto:${target}?subject=${encodeURIComponent(`دعم ${context.storeName || "المتجر"}`)}&body=${encodeURIComponent(message)}`;
  }
  if (channel.channel_type === "phone") return `tel:${target.replace(/[^+\d]/g, "")}`;
  if (/^https:\/\//i.test(target)) return target;
  return null;
}

function supportChannelDto(row, context = {}) {
  return {
    id: row.id,
    type: row.channel_type,
    name: row.name,
    description: row.description || "",
    target: row.target,
    messageTemplate: row.message_template || "",
    iconUrl: row.icon_url || null,
    workingHours: row.working_hours || null,
    sortOrder: Number(row.sort_order || 0),
    status: row.status,
    url: supportTargetUrl(row, context)
  };
}


function safeExternalOrRelativeUrl(value, field = "الرابط") {
  const text = safeText(value, 1000);
  if (!text) return null;
  if (text.startsWith("/") && !text.startsWith("//")) return text;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new PaymentError(422, "invalid_url", `${field} غير صالح`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new PaymentError(422, "invalid_url", `${field} يجب أن يكون HTTPS آمنًا`);
  }
  return parsed.toString();
}

function proofSignatureMatches(mime, bytes) {
  if (mime === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mime === "image/jpeg") {
    return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  }
  if (mime === "image/webp") {
    return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function parsePrivateImage(dataUrl, maximumBytes = DEFAULT_IDENTITY_IMAGE_LIMIT) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match || !IMAGE_MIMES.has(match[1])) {
    throw new PaymentError(422, "invalid_image", "اختر صورة JPG أو PNG أو WEBP");
  }
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length < 32 || bytes.length > maximumBytes) {
    throw new PaymentError(422, "invalid_image_size", "حجم الصورة غير مسموح");
  }
  if (!proofSignatureMatches(match[1], bytes)) {
    throw new PaymentError(422, "invalid_image_content", "محتوى الملف لا يطابق نوع الصورة");
  }
  return {
    mime: match[1],
    data: `data:${match[1]};base64,${bytes.toString("base64")}`,
    size: bytes.length,
    hash: sha256(bytes)
  };
}

async function securityEvent(db, request, store, customer, eventType, summary, metadata = {}) {
  await db.query(
    `INSERT INTO customer_security_events (
       id, tenant_id, store_id, customer_id, event_type, summary,
       ip_address, user_agent, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      randomUUID(), store.tenant_id, store.id, customer.id, eventType, summary,
      safeText(request.ip, 120) || null,
      safeText(request.headers["user-agent"], 500) || null,
      JSON.stringify(metadata)
    ]
  );
}

async function identityEvent(db, {
  store,
  requestId,
  customerId,
  actorUserId = null,
  eventType,
  fromStatus = null,
  toStatus = null,
  note = null
}) {
  await db.query(
    `INSERT INTO identity_verification_events (
       id, tenant_id, store_id, request_id, customer_id, actor_user_id,
       event_type, from_status, to_status, note
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      randomUUID(), store.tenant_id, store.id, requestId, customerId,
      actorUserId, eventType, fromStatus, toStatus, safeText(note, 1500) || null
    ]
  );
}

async function ensureSecuritySettings(db, store, customer) {
  await db.query(
    `INSERT INTO customer_security_settings (customer_id, tenant_id, store_id)
     VALUES ($1,$2,$3) ON CONFLICT (customer_id) DO NOTHING`,
    [customer.id, store.tenant_id, store.id]
  );
  return (await db.query(
    `SELECT * FROM customer_security_settings
     WHERE customer_id=$1 AND tenant_id=$2 AND store_id=$3`,
    [customer.id, store.tenant_id, store.id]
  )).rows[0];
}

async function ensureExperienceSettings(db, store) {
  await db.query(
    `INSERT INTO store_experience_settings (store_id, tenant_id)
     VALUES ($1,$2) ON CONFLICT (store_id) DO NOTHING`,
    [store.id, store.tenant_id]
  );
  return (await db.query(
    `SELECT * FROM store_experience_settings
     WHERE store_id=$1 AND tenant_id=$2`,
    [store.id, store.tenant_id]
  )).rows[0];
}

function experienceDto(row) {
  return {
    identityVerificationEnabled: Boolean(row.identity_verification_enabled),
    identityFileMaxBytes: Number(row.identity_file_max_bytes),
    identityRetentionDays: Number(row.identity_retention_days),
    floatingSupportEnabled: Boolean(row.floating_support_enabled),
    lightModeEnabled: Boolean(row.light_mode_enabled),
    storefrontApiEnabled: Boolean(row.storefront_api_enabled),
    internalTransferEnabled: Boolean(row.internal_transfer_enabled),
    withdrawalEnabled: Boolean(row.withdrawal_enabled),
    builderPromoUrl: row.builder_promo_url || null,
    builderPromoImageUrl: row.builder_promo_image_url || null,
    updatedAt: row.updated_at
  };
}

async function defaultSupportChannels(db, store) {
  const existing = await db.query(
    `SELECT * FROM store_support_channels
     WHERE tenant_id=$1 AND store_id=$2 AND status='active'
     ORDER BY sort_order, created_at`,
    [store.tenant_id, store.id]
  );
  if (existing.rows.length) return existing.rows;
  const contacts = jsonValue(store.contact_data, {});
  const defaults = [
    ["whatsapp", "واتساب", "تواصل مباشر مع فريق الدعم", contacts.whatsapp],
    ["telegram", "تيليجرام", "راسل فريق المتجر عبر تيليجرام", contacts.telegram],
    ["email", "البريد الإلكتروني", "أرسل رسالة إلى فريق الدعم", contacts.email],
    ["phone", "اتصال هاتفي", "اتصل بنا خلال أوقات العمل", contacts.phone]
  ].filter((entry) => entry[3]);
  return defaults.map(([type, name, description, target], index) => ({
    id: `contact-${type}`,
    channel_type: type,
    name,
    description,
    target,
    message_template: "",
    icon_url: null,
    working_hours: contacts.workingHours || null,
    sort_order: index,
    status: "active"
  }));
}


function depositDto(row, { includeProof = false } = {}) {
  const dto = {
    id: row.id,
    requestedAmountMinor: Number(row.requested_amount_minor),
    commissionMinor: Number(row.commission_minor),
    netAmountMinor: Number(row.net_amount_minor),
    currency: row.currency,
    status: row.status,
    reviewNote: row.review_reason || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    method: {
      id: row.payment_method_id,
      name: row.method_name,
      type: row.method_type,
      logoUrl: row.logo_url || null,
      network: row.network || null
    }
  };
  if (includeProof) {
    dto.proof = { mime: row.proof_mime, data: row.proof_data };
  }
  return dto;
}

function identityDto(row, files = []) {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    documentType: row.document_type,
    documentNumber: row.document_number_ciphertext || null,
    birthDate: row.birth_date || null,
    nationality: row.nationality,
    additionalDetails: row.additional_details,
    status: row.status,
    reviewNote: row.review_note || null,
    submittedAt: row.submitted_at || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    files: files.map((file) => ({
      kind: file.file_kind,
      mime: file.mime_type,
      sizeBytes: Number(file.size_bytes),
      updatedAt: file.updated_at
    }))
  };
}

export function installStorefrontAccountRoutes(app, { db, config }) {
  if (ACCOUNT_ROUTE_APPS.has(app)) return false;
  ACCOUNT_ROUTE_APPS.add(app);

  app.get("/admin/:storeId/account-settings", async (_request, reply) => reply.sendFile("account-admin.html"));

  for (const path of [
    "/store/:slug/account",
    "/store/:slug/payments",
    "/store/:slug/orders",
    "/store/:slug/telegram",
    "/store/:slug/security",
    "/store/:slug/identity",
    "/store/:slug/developer",
    "/store/:slug/about"
  ]) {
    app.get(path, async (_request, reply) => reply.sendFile("account.html"));
  }

  app.get(
    "/api/public/stores/:slug/account-shell",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      let customer = null;
      try {
        customer = await authenticateCustomer(db, request, store);
      } catch (error) {
        if (error.statusCode !== 401) throw error;
      }
      const [channels, experience] = await Promise.all([
        defaultSupportChannels(db, store),
        ensureExperienceSettings(db, store)
      ]);
      return {
        store: {
          id: store.id,
          name: store.name,
          slug: store.slug,
          description: store.description,
          currency: store.currency,
          templateKey: store.template_key,
          contacts: jsonValue(store.contact_data, {})
        },
        customer: customer ? customerDto(customer) : null,
        experience: experienceDto(experience),
        supportChannels: channels.map((channel) => supportChannelDto(channel, {
          storeName: store.name,
          customerName: customer?.display_name || "",
          customerId: customer?.id || "",
          orderId: safeText(request.query?.orderId, 80),
          supportContext: safeText(request.query?.context, 300) || "طلب مساعدة"
        }))
      };
    })
  );

  app.get(
    "/api/public/stores/:slug/deposits",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      const status = safeText(request.query?.status, 30) || "all";
      const query = safeText(request.query?.query, 120).toLowerCase();
      const limit = integer(request.query?.limit ?? 20, { minimum: 1, maximum: 100, field: "الحد" });
      const offset = integer(request.query?.offset ?? 0, { minimum: 0, maximum: 1_000_000, field: "الإزاحة" });
      const values = [store.tenant_id, store.id, customer.id];
      const filters = [];
      if (status !== "all") {
        const mapped = status === "completed" ? "approved" : status;
        if (!["pending", "approved", "rejected", "cancelled"].includes(mapped)) {
          throw new PaymentError(422, "invalid_status", "حالة الدفعة غير صالحة");
        }
        values.push(mapped);
        filters.push(`d.status=$${values.length}`);
      }
      if (query) {
        values.push(`%${query}%`);
        filters.push(`(LOWER(CAST(d.id AS TEXT)) LIKE $${values.length} OR LOWER(pm.name) LIKE $${values.length})`);
      }
      const extra = filters.length ? ` AND ${filters.join(" AND ")}` : "";
      const count = await db.query(
        `SELECT COUNT(*) AS total
         FROM deposit_requests d JOIN payment_methods pm ON pm.id=d.payment_method_id
         WHERE d.tenant_id=$1 AND d.store_id=$2 AND d.customer_id=$3${extra}`,
        values
      );
      const rows = await db.query(
        `SELECT d.*, pm.name AS method_name, pm.method_type, pm.logo_url, pm.network
         FROM deposit_requests d JOIN payment_methods pm ON pm.id=d.payment_method_id
         WHERE d.tenant_id=$1 AND d.store_id=$2 AND d.customer_id=$3${extra}
         ORDER BY d.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset]
      );
      return {
        payments: rows.rows.map((row) => depositDto(row)),
        pagination: {
          limit,
          offset,
          total: Number(count.rows[0]?.total || 0),
          hasMore: offset + rows.rows.length < Number(count.rows[0]?.total || 0)
        }
      };
    })
  );

  app.get(
    "/api/public/stores/:slug/deposits/:depositId",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      const row = (await db.query(
        `SELECT d.*, pm.name AS method_name, pm.method_type, pm.logo_url, pm.network
         FROM deposit_requests d JOIN payment_methods pm ON pm.id=d.payment_method_id
         WHERE d.id=$1 AND d.tenant_id=$2 AND d.store_id=$3 AND d.customer_id=$4`,
        [request.params.depositId, store.tenant_id, store.id, customer.id]
      )).rows[0];
      if (!row) throw new PaymentError(404, "deposit_not_found", "طلب الدفع غير موجود");
      return { payment: depositDto(row, { includeProof: true }) };
    })
  );

  app.get(
    "/api/public/stores/:slug/customer/orders/:orderId",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      const order = (await db.query(
        `SELECT * FROM orders
         WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND customer_id=$4`,
        [request.params.orderId, store.tenant_id, store.id, customer.id]
      )).rows[0];
      if (!order) throw new PaymentError(404, "order_not_found", "الطلب غير موجود");
      const items = await db.query(
        `SELECT oi.*, p.name AS product_name, p.image_url, p.product_type, p.delivery_mode
         FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id
         WHERE oi.tenant_id=$1 AND oi.order_id=$2
         ORDER BY oi.created_at, oi.id`,
        [store.tenant_id, order.id]
      );
      return {
        order: {
          id: order.id,
          orderNumber: order.order_number,
          status: order.status,
          paymentStatus: order.payment_status,
          paymentSource: order.payment_source,
          totalMinor: Number(order.total_minor),
          currency: order.currency,
          rejectionReason: order.rejection_reason || null,
          delivery: jsonValue(order.delivery_data, {}),
          stages: jsonValue(order.execution_stages, []),
          createdAt: order.created_at,
          updatedAt: order.updated_at,
          items: items.rows.map((item) => ({
            id: item.id,
            productId: item.product_id,
            name: item.product_name || "منتج",
            imageUrl: item.image_url || null,
            type: item.product_type || null,
            deliveryMode: item.delivery_mode || null,
            quantity: Number(item.quantity),
            unitPriceMinor: Number(item.unit_price_minor),
            totalMinor: Number(item.total_minor),
            inputData: jsonValue(item.input_data, {})
          }))
        }
      };
    })
  );

  app.get(
    "/api/public/stores/:slug/security",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      const settings = await ensureSecuritySettings(db, store, customer);
      const currentHash = sha256(request.cookies[customerCookieName(store)] || "");
      const sessions = await db.query(
        `SELECT * FROM customer_sessions
         WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 50`,
        [customer.id]
      );
      const events = await db.query(
        `SELECT * FROM customer_security_events
         WHERE tenant_id=$1 AND store_id=$2 AND customer_id=$3
         ORDER BY created_at DESC LIMIT 50`,
        [store.tenant_id, store.id, customer.id]
      );
      return {
        level: settings.totp_enabled ? "strong" : "basic",
        totpEnabled: Boolean(settings.totp_enabled),
        sessions: sessions.rows.map((row) => securitySessionDto(row, currentHash)),
        events: events.rows.map((row) => ({
          id: row.id,
          type: row.event_type,
          summary: row.summary,
          ipAddress: row.ip_address || null,
          userAgent: row.user_agent || null,
          createdAt: row.created_at
        }))
      };
    })
  );

  app.post(
    "/api/public/stores/:slug/security/password",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      requireCustomerCsrf(request, customer);
      if (!(await verifyPassword(String(request.body?.currentPassword || ""), customer.password_hash))) {
        throw new PaymentError(401, "invalid_password", "كلمة المرور الحالية غير صحيحة");
      }
      const newPassword = String(request.body?.newPassword || "");
      const passwordHash = await hashPassword(newPassword);
      await db.transaction(async (client) => {
        await client.query(
          `UPDATE store_customers SET password_hash=$2, updated_at=NOW()
           WHERE id=$1 AND tenant_id=$3 AND store_id=$4`,
          [customer.id, passwordHash, store.tenant_id, store.id]
        );
        if (request.body?.logoutOthers !== false) {
          const currentHash = sha256(request.cookies[customerCookieName(store)] || "");
          await client.query(
            `UPDATE customer_sessions SET revoked_at=NOW(), revoked_reason='password_changed'
             WHERE customer_id=$1 AND token_hash<>$2 AND revoked_at IS NULL`,
            [customer.id, currentHash]
          );
        }
      }, store.tenant_id);
      await securityEvent(db, request, store, customer, "password_changed", "تم تغيير كلمة المرور");
      return { ok: true };
    })
  );

  app.post(
    "/api/public/stores/:slug/security/sessions/logout-others",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      requireCustomerCsrf(request, customer);
      const currentHash = sha256(request.cookies[customerCookieName(store)] || "");
      await db.query(
        `UPDATE customer_sessions SET revoked_at=NOW(), revoked_reason='logout_others'
         WHERE customer_id=$1 AND token_hash<>$2 AND revoked_at IS NULL`,
        [customer.id, currentHash]
      );
      await securityEvent(db, request, store, customer, "sessions_revoked", "تم إنهاء جميع الجلسات الأخرى");
      return { ok: true };
    })
  );

  app.delete(
    "/api/public/stores/:slug/security/sessions/:sessionId",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      requireCustomerCsrf(request, customer);
      const rows = await db.query(
        `SELECT * FROM customer_sessions WHERE customer_id=$1 AND revoked_at IS NULL`,
        [customer.id]
      );
      const target = rows.rows.find((row) => row.token_hash.startsWith(request.params.sessionId));
      if (!target) throw new PaymentError(404, "session_not_found", "الجلسة غير موجودة");
      const currentHash = sha256(request.cookies[customerCookieName(store)] || "");
      if (target.token_hash === currentHash) {
        throw new PaymentError(409, "current_session", "استخدم تسجيل الخروج لإنهاء الجلسة الحالية");
      }
      await db.query(
        `UPDATE customer_sessions SET revoked_at=NOW(), revoked_reason='customer_revoked'
         WHERE token_hash=$1 AND customer_id=$2`,
        [target.token_hash, customer.id]
      );
      await securityEvent(db, request, store, customer, "session_revoked", "تم إنهاء جلسة من الأجهزة");
      return { ok: true };
    })
  );

  app.post(
    "/api/public/stores/:slug/security/totp/setup",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      requireCustomerCsrf(request, customer);
      if (!(await verifyPassword(String(request.body?.password || ""), customer.password_hash))) {
        throw new PaymentError(401, "invalid_password", "كلمة المرور غير صحيحة");
      }
      const settings = await ensureSecuritySettings(db, store, customer);
      if (settings.totp_enabled) throw new PaymentError(409, "totp_enabled", "التحقق بخطوتين مفعّل مسبقًا");
      const secret = generateTotpSecret();
      await db.query(
        `UPDATE customer_security_settings
         SET totp_pending_secret_ciphertext=$2, updated_at=NOW()
         WHERE customer_id=$1 AND tenant_id=$3 AND store_id=$4`,
        [customer.id, encryptSecret(secret, config.encryptionKey), store.tenant_id, store.id]
      );
      return {
        secret,
        otpauthUri: totpAuthUri({ issuer: store.name, account: customer.email, secret })
      };
    })
  );

  app.post(
    "/api/public/stores/:slug/security/totp/enable",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      requireCustomerCsrf(request, customer);
      if (!(await verifyPassword(String(request.body?.password || ""), customer.password_hash))) {
        throw new PaymentError(401, "invalid_password", "كلمة المرور غير صحيحة");
      }
      const settings = await ensureSecuritySettings(db, store, customer);
      if (!settings.totp_pending_secret_ciphertext) {
        throw new PaymentError(409, "totp_setup_required", "ابدأ إعداد التحقق بخطوتين أولًا");
      }
      const secret = decryptSecret(settings.totp_pending_secret_ciphertext, config.encryptionKey);
      if (!verifyTotp(secret, request.body?.code)) {
        throw new PaymentError(422, "invalid_totp", "رمز التحقق غير صحيح");
      }
      const codes = Array.from({ length: 8 }, () => recoveryCode());
      await db.transaction(async (client) => {
        await client.query(
          `UPDATE customer_security_settings SET
             totp_enabled=TRUE,
             totp_secret_ciphertext=totp_pending_secret_ciphertext,
             totp_pending_secret_ciphertext=NULL,
             totp_confirmed_at=NOW(), recovery_codes_generated_at=NOW(), updated_at=NOW()
           WHERE customer_id=$1 AND tenant_id=$2 AND store_id=$3`,
          [customer.id, store.tenant_id, store.id]
        );
        await client.query(
          `DELETE FROM customer_recovery_codes
           WHERE customer_id=$1 AND tenant_id=$2 AND store_id=$3`,
          [customer.id, store.tenant_id, store.id]
        );
        for (const code of codes) {
          await client.query(
            `INSERT INTO customer_recovery_codes (
               id, tenant_id, store_id, customer_id, code_hash
             ) VALUES ($1,$2,$3,$4,$5)`,
            [randomUUID(), store.tenant_id, store.id, customer.id, sha256(code)]
          );
        }
      }, store.tenant_id);
      await securityEvent(db, request, store, customer, "totp_enabled", "تم تفعيل التحقق بخطوتين");
      return { ok: true, recoveryCodes: codes };
    })
  );

  app.post(
    "/api/public/stores/:slug/security/totp/disable",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      requireCustomerCsrf(request, customer);
      if (!(await verifyPassword(String(request.body?.password || ""), customer.password_hash))) {
        throw new PaymentError(401, "invalid_password", "كلمة المرور غير صحيحة");
      }
      const settings = await ensureSecuritySettings(db, store, customer);
      if (!settings.totp_enabled || !settings.totp_secret_ciphertext) {
        throw new PaymentError(409, "totp_not_enabled", "التحقق بخطوتين غير مفعّل");
      }
      const code = String(request.body?.code || "").trim().toUpperCase();
      const secret = decryptSecret(settings.totp_secret_ciphertext, config.encryptionKey);
      let valid = verifyTotp(secret, code);
      let recoveryId = null;
      if (!valid && code) {
        const recovery = (await db.query(
          `SELECT * FROM customer_recovery_codes
           WHERE customer_id=$1 AND tenant_id=$2 AND store_id=$3
             AND code_hash=$4 AND used_at IS NULL`,
          [customer.id, store.tenant_id, store.id, sha256(code)]
        )).rows[0];
        if (recovery) {
          valid = true;
          recoveryId = recovery.id;
        }
      }
      if (!valid) throw new PaymentError(422, "invalid_totp", "رمز التحقق أو الاسترداد غير صحيح");
      await db.transaction(async (client) => {
        if (recoveryId) {
          await client.query("UPDATE customer_recovery_codes SET used_at=NOW() WHERE id=$1", [recoveryId]);
        }
        await client.query(
          `UPDATE customer_security_settings SET
             totp_enabled=FALSE, totp_secret_ciphertext=NULL,
             totp_pending_secret_ciphertext=NULL, updated_at=NOW()
           WHERE customer_id=$1 AND tenant_id=$2 AND store_id=$3`,
          [customer.id, store.tenant_id, store.id]
        );
        await client.query(
          `DELETE FROM customer_recovery_codes
           WHERE customer_id=$1 AND tenant_id=$2 AND store_id=$3`,
          [customer.id, store.tenant_id, store.id]
        );
      }, store.tenant_id);
      await securityEvent(db, request, store, customer, "totp_disabled", "تم إيقاف التحقق بخطوتين");
      return { ok: true };
    })
  );

  app.get(
    "/api/public/stores/:slug/telegram-link",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      const bot = (await db.query(
        `SELECT username FROM bot_connections
         WHERE tenant_id=$1 AND store_id=$2 AND purpose='storefront' AND status IN ('validated','active')`,
        [store.tenant_id, store.id]
      )).rows[0];
      return {
        linked: Boolean(customer.telegram_user_id),
        telegramUserId: customer.telegram_user_id || null,
        telegramUsername: customer.telegram_username || null,
        linkedAt: customer.telegram_linked_at || null,
        botUsername: bot?.username || null,
        botUrl: bot?.username ? `https://t.me/${bot.username}` : null
      };
    })
  );

  app.post(
    "/api/public/stores/:slug/telegram-link",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      requireCustomerCsrf(request, customer);
      const code = requiredText(request.body?.code, "كود الربط", 20).replace(/\s/g, "").toUpperCase();
      const result = await db.transaction(async (client) => {
        const record = (await client.query(
          `SELECT * FROM telegram_link_codes
           WHERE tenant_id=$1 AND store_id=$2 AND code_hash=$3
             AND used_at IS NULL AND expires_at>NOW() FOR UPDATE`,
          [store.tenant_id, store.id, sha256(code)]
        )).rows[0];
        if (!record) throw new PaymentError(422, "invalid_link_code", "كود الربط غير صالح أو انتهت صلاحيته");
        const conflict = (await client.query(
          `SELECT id FROM store_customers
           WHERE tenant_id=$1 AND store_id=$2 AND telegram_user_id=$3 AND id<>$4`,
          [store.tenant_id, store.id, record.telegram_user_id, customer.id]
        )).rows[0];
        if (conflict) throw new PaymentError(409, "telegram_already_linked", "حساب تيليجرام مرتبط بعميل آخر");
        await client.query(
          `UPDATE store_customers SET telegram_user_id=$2, telegram_username=$3,
             telegram_linked_at=NOW(), updated_at=NOW()
           WHERE id=$1 AND tenant_id=$4 AND store_id=$5`,
          [customer.id, record.telegram_user_id, record.telegram_username, store.tenant_id, store.id]
        );
        await client.query("UPDATE telegram_link_codes SET used_at=NOW() WHERE id=$1", [record.id]);
        return record;
      }, store.tenant_id);
      await securityEvent(db, request, store, customer, "telegram_linked", "تم ربط حساب تيليجرام", {
        telegramUserId: result.telegram_user_id
      });
      return { ok: true, linked: true };
    })
  );

  app.delete(
    "/api/public/stores/:slug/telegram-link",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      requireCustomerCsrf(request, customer);
      await db.query(
        `UPDATE store_customers SET telegram_user_id=NULL, telegram_username=NULL,
           telegram_linked_at=NULL, updated_at=NOW()
         WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
        [customer.id, store.tenant_id, store.id]
      );
      await securityEvent(db, request, store, customer, "telegram_unlinked", "تم فك ربط حساب تيليجرام");
      return { ok: true };
    })
  );

  app.post(
    "/api/telegram/stores/:storeId/link-codes",
    route(async (request) => {
      const store = (await db.query("SELECT * FROM stores WHERE id=$1", [request.params.storeId])).rows[0];
      if (!store) throw new PaymentError(404, "store_not_found", "المتجر غير موجود");
      const secret = requiredText(request.headers["x-telegram-webhook-secret"], "Webhook Secret", 200);
      const bot = (await db.query(
        `SELECT * FROM bot_connections
         WHERE tenant_id=$1 AND store_id=$2 AND purpose='storefront'
           AND status IN ('validated','active')`,
        [store.tenant_id, store.id]
      )).rows[0];
      if (!bot || sha256(secret) !== bot.webhook_secret_hash) {
        throw new PaymentError(403, "invalid_bot_secret", "تعذر التحقق من البوت");
      }
      const telegramUserId = requiredText(request.body?.telegramUserId, "Telegram User ID", 80);
      const code = String(randomInt(100000, 1000000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await db.query(
        `INSERT INTO telegram_link_codes (
           id, tenant_id, store_id, telegram_user_id, telegram_username,
           code_hash, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          randomUUID(), store.tenant_id, store.id, telegramUserId,
          safeText(request.body?.telegramUsername, 120) || null,
          sha256(code), expiresAt
        ]
      );
      return { code, expiresAt };
    })
  );

  app.get(
    "/api/public/stores/:slug/identity",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      const experience = await ensureExperienceSettings(db, store);
      if (!experience.identity_verification_enabled) {
        return {
          enabled: false,
          retentionDays: Number(experience.identity_retention_days),
          maximumFileBytes: Number(experience.identity_file_max_bytes),
          request: null
        };
      }
      const row = (await db.query(
        `SELECT * FROM identity_verification_requests
         WHERE tenant_id=$1 AND store_id=$2 AND customer_id=$3`,
        [store.tenant_id, store.id, customer.id]
      )).rows[0];
      if (!row) return {
        enabled: true,
        retentionDays: Number(experience.identity_retention_days),
        maximumFileBytes: Number(experience.identity_file_max_bytes),
        request: null
      };
      const files = await db.query(
        `SELECT * FROM identity_verification_files
         WHERE tenant_id=$1 AND store_id=$2 AND request_id=$3`,
        [store.tenant_id, store.id, row.id]
      );
      const dto = identityDto(row, files.rows);
      dto.documentNumber = row.document_number_ciphertext
        ? decryptSecret(row.document_number_ciphertext, config.encryptionKey)
        : "";
      return {
        enabled: true,
        retentionDays: Number(experience.identity_retention_days),
        maximumFileBytes: Number(experience.identity_file_max_bytes),
        request: dto
      };
    })
  );

  app.put(
    "/api/public/stores/:slug/identity",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      requireCustomerCsrf(request, customer);
      const experience = await ensureExperienceSettings(db, store);
      if (!experience.identity_verification_enabled) {
        throw new PaymentError(403, "identity_disabled", "توثيق الهوية غير مفعّل في هذا المتجر");
      }
      const current = (await db.query(
        `SELECT * FROM identity_verification_requests
         WHERE tenant_id=$1 AND store_id=$2 AND customer_id=$3`,
        [store.tenant_id, store.id, customer.id]
      )).rows[0];
      if (current && !["draft", "changes_required", "rejected"].includes(current.status)) {
        throw new PaymentError(409, "identity_locked", "لا يمكن تعديل الطلب أثناء المراجعة أو بعد التوثيق");
      }
      const body = request.body || {};
      const id = current?.id || randomUUID();
      const fullName = requiredText(body.fullName, "الاسم الكامل", 160);
      const documentType = requiredText(body.documentType, "نوع الوثيقة", 60);
      const documentNumber = requiredText(body.documentNumber, "رقم الوثيقة", 120);
      const birthDate = safeText(body.birthDate, 10) || null;
      if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
        throw new PaymentError(422, "invalid_birth_date", "تاريخ الميلاد غير صالح");
      }
      const nationality = requiredText(body.nationality, "الجنسية", 100);
      await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO identity_verification_requests (
             id, tenant_id, store_id, customer_id, full_name, document_type,
             document_number_ciphertext, birth_date, nationality, additional_details, status
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft')
           ON CONFLICT (store_id, customer_id) DO UPDATE SET
             full_name=EXCLUDED.full_name,
             document_type=EXCLUDED.document_type,
             document_number_ciphertext=EXCLUDED.document_number_ciphertext,
             birth_date=EXCLUDED.birth_date,
             nationality=EXCLUDED.nationality,
             additional_details=EXCLUDED.additional_details,
             status='draft', updated_at=NOW()`,
          [
            id, store.tenant_id, store.id, customer.id, fullName, documentType,
            encryptSecret(documentNumber, config.encryptionKey), birthDate, nationality,
            safeText(body.additionalDetails, 1500)
          ]
        );
        const files = body.files && typeof body.files === "object" ? body.files : {};
        for (const kind of IDENTITY_FILE_KINDS) {
          if (!files[kind]) continue;
          const parsed = parsePrivateImage(files[kind], Number(experience.identity_file_max_bytes));
          await client.query(
            `INSERT INTO identity_verification_files (
               id, tenant_id, store_id, request_id, customer_id, file_kind,
               mime_type, content_ciphertext, content_hash, size_bytes
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (request_id, file_kind) DO UPDATE SET
               mime_type=EXCLUDED.mime_type, content_ciphertext=EXCLUDED.content_ciphertext,
               content_hash=EXCLUDED.content_hash, size_bytes=EXCLUDED.size_bytes,
               updated_at=NOW()`,
            [
              randomUUID(), store.tenant_id, store.id, id, customer.id, kind,
              parsed.mime, encryptSecret(parsed.data, config.encryptionKey), parsed.hash, parsed.size
            ]
          );
        }
      }, store.tenant_id);
      await identityEvent(db, {
        store,
        requestId: id,
        customerId: customer.id,
        eventType: "draft_saved",
        fromStatus: current?.status || null,
        toStatus: "draft"
      });
      await securityEvent(db, request, store, customer, "identity_draft_saved", "تم حفظ مسودة توثيق الهوية");
      return { ok: true, id };
    })
  );

  app.post(
    "/api/public/stores/:slug/identity/submit",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      requireCustomerCsrf(request, customer);
      const experience = await ensureExperienceSettings(db, store);
      if (!experience.identity_verification_enabled) {
        throw new PaymentError(403, "identity_disabled", "توثيق الهوية غير مفعّل في هذا المتجر");
      }
      const row = (await db.query(
        `SELECT * FROM identity_verification_requests
         WHERE tenant_id=$1 AND store_id=$2 AND customer_id=$3`,
        [store.tenant_id, store.id, customer.id]
      )).rows[0];
      if (!row) throw new PaymentError(409, "identity_draft_required", "أكمل بيانات التوثيق أولًا");
      if (!["draft", "changes_required", "rejected"].includes(row.status)) {
        throw new PaymentError(409, "identity_already_submitted", "تم إرسال الطلب مسبقًا");
      }
      const files = await db.query(
        `SELECT file_kind FROM identity_verification_files
         WHERE tenant_id=$1 AND store_id=$2 AND request_id=$3`,
        [store.tenant_id, store.id, row.id]
      );
      const kinds = new Set(files.rows.map((file) => file.file_kind));
      for (const kind of IDENTITY_FILE_KINDS) {
        if (!kinds.has(kind)) throw new PaymentError(422, "identity_file_required", "جميع صور الوثيقة والسيلفي مطلوبة");
      }
      await db.query(
        `UPDATE identity_verification_requests SET status='pending_review', submitted_at=NOW(),
           review_note=NULL, updated_at=NOW()
         WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND customer_id=$4`,
        [row.id, store.tenant_id, store.id, customer.id]
      );
      await identityEvent(db, {
        store,
        requestId: row.id,
        customerId: customer.id,
        eventType: "submitted",
        fromStatus: row.status,
        toStatus: "pending_review"
      });
      await securityEvent(db, request, store, customer, "identity_submitted", "تم إرسال طلب توثيق الهوية");
      return { ok: true, status: "pending_review" };
    })
  );

  app.get(
    "/api/public/stores/:slug/identity/files/:kind",
    route(async (request, reply) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      const kind = safeText(request.params.kind, 20);
      if (!IDENTITY_FILE_KINDS.has(kind)) throw new PaymentError(404, "file_not_found", "الملف غير موجود");
      const file = (await db.query(
        `SELECT f.* FROM identity_verification_files f
         JOIN identity_verification_requests r ON r.id=f.request_id
         WHERE f.tenant_id=$1 AND f.store_id=$2 AND f.customer_id=$3
           AND f.file_kind=$4 AND r.customer_id=$3`,
        [store.tenant_id, store.id, customer.id, kind]
      )).rows[0];
      if (!file) throw new PaymentError(404, "file_not_found", "الملف غير موجود");
      const decrypted = decryptSecret(file.content_ciphertext, config.encryptionKey);
      const match = /^data:([^;]+);base64,(.+)$/.exec(decrypted);
      if (!match) throw new PaymentError(500, "file_corrupt", "تعذر قراءة الملف");
      reply.header("cache-control", "private, no-store");
      reply.type(file.mime_type);
      return reply.send(Buffer.from(match[2], "base64"));
    })
  );

  app.get(
    "/api/stores/:storeId/support-channels",
    route(async (request) => {
      const user = await authenticatePlatform(db, request);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const rows = await db.query(
        `SELECT * FROM store_support_channels
         WHERE tenant_id=$1 AND store_id=$2 ORDER BY sort_order, created_at`,
        [store.tenant_id, store.id]
      );
      return { channels: rows.rows.map((row) => supportChannelDto(row)) };
    })
  );

  app.post(
    "/api/stores/:storeId/support-channels",
    route(async (request, reply) => {
      const user = await authenticatePlatform(db, request);
      requirePlatformCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const body = request.body || {};
      const type = requiredText(body.type, "نوع وسيلة التواصل", 30);
      if (!SUPPORT_CHANNEL_TYPES.has(type)) throw new PaymentError(422, "invalid_channel", "وسيلة التواصل غير مدعومة");
      const id = randomUUID();
      await db.query(
        `INSERT INTO store_support_channels (
           id, tenant_id, store_id, channel_type, name, description, target,
           message_template, icon_url, working_hours, sort_order, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id, store.tenant_id, store.id, type,
          requiredText(body.name, "الاسم", 100), safeText(body.description, 300),
          requiredText(body.target, "الرابط أو الرقم", 500), safeText(body.messageTemplate, 1500),
          safeExternalOrRelativeUrl(body.iconUrl, "رابط الأيقونة"), safeText(body.workingHours, 300) || null,
          integer(body.sortOrder ?? 0, { minimum: 0, maximum: 10000, field: "الترتيب" }),
          ["active", "hidden", "disabled"].includes(body.status) ? body.status : "active"
        ]
      );
      await writeAudit(db, {
        store,
        actorUserId: user.id,
        action: "support_channel.created",
        entityType: "store_support_channel",
        entityId: id,
        ipAddress: request.ip,
        afterData: { type, name: body.name, target: body.target }
      });
      reply.code(201);
      return { id };
    })
  );

  app.get(
    "/api/stores/:storeId/experience-settings",
    route(async (request) => {
      const user = await authenticatePlatform(db, request);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const settings = await ensureExperienceSettings(db, store);
      return { settings: experienceDto(settings) };
    })
  );

  app.put(
    "/api/stores/:storeId/experience-settings",
    route(async (request) => {
      const user = await authenticatePlatform(db, request);
      requirePlatformCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      requireStoreOwner(store, "هذه الإعدادات متاحة لمالك المتجر فقط");
      const current = await ensureExperienceSettings(db, store);
      const body = request.body || {};
      const builderPromoUrl = safeExternalOrRelativeUrl(body.builderPromoUrl, "رابط منصة UCHIHA");
      const builderPromoImageUrl = safeExternalOrRelativeUrl(body.builderPromoImageUrl, "صورة منصة UCHIHA");
      const values = {
        identityVerificationEnabled: body.identityVerificationEnabled === undefined
          ? Boolean(current.identity_verification_enabled)
          : Boolean(body.identityVerificationEnabled),
        identityFileMaxBytes: body.identityFileMaxBytes === undefined
          ? Number(current.identity_file_max_bytes)
          : integer(body.identityFileMaxBytes, { minimum: 100000, maximum: 15000000, field: "الحد الأقصى لملف الهوية" }),
        identityRetentionDays: body.identityRetentionDays === undefined
          ? Number(current.identity_retention_days)
          : integer(body.identityRetentionDays, { minimum: 1, maximum: 3650, field: "مدة الاحتفاظ" }),
        floatingSupportEnabled: body.floatingSupportEnabled === undefined
          ? Boolean(current.floating_support_enabled)
          : Boolean(body.floatingSupportEnabled),
        lightModeEnabled: body.lightModeEnabled === undefined
          ? Boolean(current.light_mode_enabled)
          : Boolean(body.lightModeEnabled),
        storefrontApiEnabled: body.storefrontApiEnabled === undefined
          ? Boolean(current.storefront_api_enabled)
          : Boolean(body.storefrontApiEnabled),
        internalTransferEnabled: body.internalTransferEnabled === undefined
          ? Boolean(current.internal_transfer_enabled)
          : Boolean(body.internalTransferEnabled),
        withdrawalEnabled: body.withdrawalEnabled === undefined
          ? Boolean(current.withdrawal_enabled)
          : Boolean(body.withdrawalEnabled),
        builderPromoUrl: body.builderPromoUrl === undefined ? current.builder_promo_url : builderPromoUrl,
        builderPromoImageUrl: body.builderPromoImageUrl === undefined ? current.builder_promo_image_url : builderPromoImageUrl
      };
      const updated = (await db.query(
        `UPDATE store_experience_settings SET
           identity_verification_enabled=$3,
           identity_file_max_bytes=$4,
           identity_retention_days=$5,
           floating_support_enabled=$6,
           light_mode_enabled=$7,
           storefront_api_enabled=$8,
           internal_transfer_enabled=$9,
           withdrawal_enabled=$10,
           builder_promo_url=$11,
           builder_promo_image_url=$12,
           updated_at=NOW()
         WHERE tenant_id=$1 AND store_id=$2 RETURNING *`,
        [
          store.tenant_id, store.id,
          values.identityVerificationEnabled, values.identityFileMaxBytes,
          values.identityRetentionDays, values.floatingSupportEnabled,
          values.lightModeEnabled, values.storefrontApiEnabled,
          values.internalTransferEnabled, values.withdrawalEnabled,
          values.builderPromoUrl, values.builderPromoImageUrl
        ]
      )).rows[0];
      await writeAudit(db, {
        store,
        actorUserId: user.id,
        action: "store_experience.updated",
        entityType: "store_experience_settings",
        entityId: store.id,
        ipAddress: request.ip,
        beforeData: experienceDto(current),
        afterData: experienceDto(updated)
      });
      return { settings: experienceDto(updated) };
    })
  );

  app.put(
    "/api/stores/:storeId/support-channels/:channelId",
    route(async (request) => {
      const user = await authenticatePlatform(db, request);
      requirePlatformCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const current = (await db.query(
        `SELECT * FROM store_support_channels
         WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
        [request.params.channelId, store.tenant_id, store.id]
      )).rows[0];
      if (!current) throw new PaymentError(404, "support_channel_not_found", "وسيلة التواصل غير موجودة");
      const body = request.body || {};
      const type = body.type === undefined ? current.channel_type : requiredText(body.type, "نوع وسيلة التواصل", 30);
      if (!SUPPORT_CHANNEL_TYPES.has(type)) throw new PaymentError(422, "invalid_channel", "وسيلة التواصل غير مدعومة");
      const status = body.status === undefined ? current.status : safeText(body.status, 20);
      if (!["active", "hidden", "disabled"].includes(status)) {
        throw new PaymentError(422, "invalid_status", "حالة وسيلة التواصل غير صالحة");
      }
      const updated = (await db.query(
        `UPDATE store_support_channels SET
           channel_type=$4, name=$5, description=$6, target=$7,
           message_template=$8, icon_url=$9, working_hours=$10,
           sort_order=$11, status=$12, updated_at=NOW()
         WHERE id=$1 AND tenant_id=$2 AND store_id=$3 RETURNING *`,
        [
          current.id, store.tenant_id, store.id, type,
          body.name === undefined ? current.name : requiredText(body.name, "الاسم", 100),
          body.description === undefined ? current.description : safeText(body.description, 300),
          body.target === undefined ? current.target : requiredText(body.target, "الرابط أو الرقم", 500),
          body.messageTemplate === undefined ? current.message_template : safeText(body.messageTemplate, 1500),
          body.iconUrl === undefined ? current.icon_url : safeExternalOrRelativeUrl(body.iconUrl, "رابط الأيقونة"),
          body.workingHours === undefined ? current.working_hours : (safeText(body.workingHours, 300) || null),
          body.sortOrder === undefined ? Number(current.sort_order) : integer(body.sortOrder, { minimum: 0, maximum: 10000, field: "الترتيب" }),
          status
        ]
      )).rows[0];
      await writeAudit(db, {
        store,
        actorUserId: user.id,
        action: "support_channel.updated",
        entityType: "store_support_channel",
        entityId: current.id,
        ipAddress: request.ip,
        beforeData: supportChannelDto(current),
        afterData: supportChannelDto(updated)
      });
      return { channel: supportChannelDto(updated) };
    })
  );

  app.delete(
    "/api/stores/:storeId/support-channels/:channelId",
    route(async (request) => {
      const user = await authenticatePlatform(db, request);
      requirePlatformCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const current = (await db.query(
        `SELECT * FROM store_support_channels
         WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
        [request.params.channelId, store.tenant_id, store.id]
      )).rows[0];
      if (!current) throw new PaymentError(404, "support_channel_not_found", "وسيلة التواصل غير موجودة");
      await db.query(
        `DELETE FROM store_support_channels WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
        [current.id, store.tenant_id, store.id]
      );
      await writeAudit(db, {
        store,
        actorUserId: user.id,
        action: "support_channel.deleted",
        entityType: "store_support_channel",
        entityId: current.id,
        ipAddress: request.ip,
        beforeData: supportChannelDto(current)
      });
      return { ok: true };
    })
  );

  app.get(
    "/api/stores/:storeId/identity-requests",
    route(async (request) => {
      const user = await authenticatePlatform(db, request);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      requireStoreOwner(store, "بيانات توثيق الهوية متاحة لمالك المتجر فقط");
      const status = safeText(request.query?.status, 30) || "all";
      if (status !== "all" && !IDENTITY_STATUSES.has(status)) {
        throw new PaymentError(422, "invalid_status", "حالة التوثيق غير صالحة");
      }
      const query = safeText(request.query?.query, 120).toLowerCase();
      const limit = integer(request.query?.limit ?? 30, { minimum: 1, maximum: 100, field: "الحد" });
      const offset = integer(request.query?.offset ?? 0, { minimum: 0, maximum: 1000000, field: "الإزاحة" });
      const values = [store.tenant_id, store.id];
      const filters = [];
      if (status !== "all") {
        values.push(status);
        filters.push(`r.status=$${values.length}`);
      }
      if (query) {
        values.push(`%${query}%`);
        filters.push(`(LOWER(r.full_name) LIKE $${values.length} OR LOWER(c.email) LIKE $${values.length} OR LOWER(CAST(r.id AS TEXT)) LIKE $${values.length})`);
      }
      const extra = filters.length ? ` AND ${filters.join(" AND ")}` : "";
      const count = (await db.query(
        `SELECT COUNT(*) AS total FROM identity_verification_requests r
         JOIN store_customers c ON c.id=r.customer_id
         WHERE r.tenant_id=$1 AND r.store_id=$2${extra}`,
        values
      )).rows[0];
      const rows = await db.query(
        `SELECT r.*, c.display_name AS customer_name, c.email AS customer_email
         FROM identity_verification_requests r
         JOIN store_customers c ON c.id=r.customer_id
         WHERE r.tenant_id=$1 AND r.store_id=$2${extra}
         ORDER BY CASE WHEN r.status='pending_review' THEN 0 ELSE 1 END, r.updated_at DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset]
      );
      return {
        requests: rows.rows.map((row) => ({
          ...identityDto(row),
          customer: { id: row.customer_id, name: row.customer_name, email: row.customer_email }
        })),
        pagination: {
          limit,
          offset,
          total: Number(count?.total || 0),
          hasMore: offset + rows.rows.length < Number(count?.total || 0)
        }
      };
    })
  );

  app.get(
    "/api/stores/:storeId/identity-requests/:requestId",
    route(async (request) => {
      const user = await authenticatePlatform(db, request);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      requireStoreOwner(store, "بيانات توثيق الهوية متاحة لمالك المتجر فقط");
      const row = (await db.query(
        `SELECT r.*, c.display_name AS customer_name, c.email AS customer_email,
                u.display_name AS reviewer_name
         FROM identity_verification_requests r
         JOIN store_customers c ON c.id=r.customer_id
         LEFT JOIN platform_users u ON u.id=r.reviewed_by
         WHERE r.id=$1 AND r.tenant_id=$2 AND r.store_id=$3`,
        [request.params.requestId, store.tenant_id, store.id]
      )).rows[0];
      if (!row) throw new PaymentError(404, "identity_request_not_found", "طلب التوثيق غير موجود");
      const [files, events] = await Promise.all([
        db.query(
          `SELECT id, file_kind, mime_type, size_bytes, updated_at
           FROM identity_verification_files
           WHERE tenant_id=$1 AND store_id=$2 AND request_id=$3 ORDER BY file_kind`,
          [store.tenant_id, store.id, row.id]
        ),
        db.query(
          `SELECT e.*, u.display_name AS actor_name
           FROM identity_verification_events e
           LEFT JOIN platform_users u ON u.id=e.actor_user_id
           WHERE e.tenant_id=$1 AND e.store_id=$2 AND e.request_id=$3
           ORDER BY e.created_at DESC`,
          [store.tenant_id, store.id, row.id]
        )
      ]);
      const requestDto = identityDto(row, files.rows);
      requestDto.documentNumber = row.document_number_ciphertext
        ? decryptSecret(row.document_number_ciphertext, config.encryptionKey)
        : "";
      requestDto.customer = { id: row.customer_id, name: row.customer_name, email: row.customer_email };
      requestDto.reviewer = row.reviewed_by ? { id: row.reviewed_by, name: row.reviewer_name || null } : null;
      requestDto.events = events.rows.map((event) => ({
        id: event.id,
        type: event.event_type,
        fromStatus: event.from_status || null,
        toStatus: event.to_status || null,
        note: event.note || null,
        actor: event.actor_user_id ? { id: event.actor_user_id, name: event.actor_name || null } : null,
        createdAt: event.created_at
      }));
      return { request: requestDto };
    })
  );

  app.get(
    "/api/stores/:storeId/identity-requests/:requestId/files/:kind",
    route(async (request, reply) => {
      const user = await authenticatePlatform(db, request);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      requireStoreOwner(store, "بيانات توثيق الهوية متاحة لمالك المتجر فقط");
      const kind = safeText(request.params.kind, 20);
      if (!IDENTITY_FILE_KINDS.has(kind)) throw new PaymentError(404, "file_not_found", "الملف غير موجود");
      const file = (await db.query(
        `SELECT f.* FROM identity_verification_files f
         JOIN identity_verification_requests r ON r.id=f.request_id
         WHERE f.request_id=$1 AND f.file_kind=$2 AND f.tenant_id=$3 AND f.store_id=$4
           AND r.tenant_id=f.tenant_id AND r.store_id=f.store_id`,
        [request.params.requestId, kind, store.tenant_id, store.id]
      )).rows[0];
      if (!file) throw new PaymentError(404, "file_not_found", "الملف غير موجود");
      const decrypted = decryptSecret(file.content_ciphertext, config.encryptionKey);
      const match = /^data:([^;]+);base64,(.+)$/.exec(decrypted);
      if (!match) throw new PaymentError(500, "file_corrupt", "تعذر قراءة الملف");
      reply.header("cache-control", "private, no-store");
      reply.header("content-disposition", `inline; filename=identity-${kind}.${file.mime_type === "image/png" ? "png" : file.mime_type === "image/webp" ? "webp" : "jpg"}`);
      reply.type(file.mime_type);
      return reply.send(Buffer.from(match[2], "base64"));
    })
  );

  app.post(
    "/api/stores/:storeId/identity-requests/:requestId/review",
    route(async (request) => {
      const user = await authenticatePlatform(db, request);
      requirePlatformCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      requireStoreOwner(store, "مراجعة وثائق الهوية متاحة لمالك المتجر فقط");
      const status = requiredText(request.body?.status, "الحالة", 30);
      if (!["changes_required", "verified", "rejected"].includes(status)) {
        throw new PaymentError(422, "invalid_status", "حالة المراجعة غير صالحة");
      }
      const note = safeText(request.body?.note, 1500) || null;
      if (["changes_required", "rejected"].includes(status) && !note) {
        throw new PaymentError(422, "review_note_required", "اكتب ملاحظة واضحة للعميل");
      }
      const current = (await db.query(
        `SELECT * FROM identity_verification_requests
         WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
        [request.params.requestId, store.tenant_id, store.id]
      )).rows[0];
      if (!current) throw new PaymentError(404, "identity_request_not_found", "طلب التوثيق غير موجود");
      if (current.status !== "pending_review") {
        throw new PaymentError(409, "identity_not_pending", "يمكن مراجعة الطلب عندما يكون قيد المراجعة فقط");
      }
      await db.transaction(async (client) => {
        await client.query(
          `UPDATE identity_verification_requests SET
             status=$4, review_note=$5, reviewed_by=$6, reviewed_at=NOW(), updated_at=NOW()
           WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
          [current.id, store.tenant_id, store.id, status, note, user.id]
        );
        await identityEvent(client, {
          store,
          requestId: current.id,
          customerId: current.customer_id,
          actorUserId: user.id,
          eventType: "reviewed",
          fromStatus: current.status,
          toStatus: status,
          note
        });
        const message = status === "verified"
          ? "تم توثيق هويتك بنجاح."
          : status === "changes_required"
            ? `يحتاج طلب التوثيق إلى تعديل: ${note}`
            : `تم رفض طلب التوثيق: ${note}`;
        await client.query(
          `INSERT INTO customer_notifications (
             id, tenant_id, store_id, customer_id, notification_type,
             title, message, reference_type, reference_id
           ) VALUES ($1,$2,$3,$4,'identity_updated',$5,$6,'identity_verification',$7)`,
          [randomUUID(), store.tenant_id, store.id, current.customer_id, "تحديث توثيق الهوية", message, current.id]
        );
        await writeAudit(client, {
          store,
          actorUserId: user.id,
          action: "identity_request.reviewed",
          entityType: "identity_verification_request",
          entityId: current.id,
          ipAddress: request.ip,
          beforeData: { status: current.status, reviewNote: current.review_note },
          afterData: { status, reviewNote: note }
        });
      }, store.tenant_id);
      return { ok: true, status };
    })
  );

  return true;
}

export { verifyTotp };
