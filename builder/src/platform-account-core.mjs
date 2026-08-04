import { randomUUID } from "node:crypto";
import { sha256 } from "./security.mjs";

const SESSION_COOKIE = "uchiha_builder_session";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED_LOCALES = new Set(["ar", "en"]);
const PROOF_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PROOF_BYTES = 1_500_000;
const DEPOSIT_REVIEW_STATUSES = new Set(["approved", "rejected"]);

class PlatformAccountError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function text(value, maximum = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, maximum);
}

function requiredText(value, field, maximum = 500) {
  const result = text(value, maximum);
  if (!result) throw new PlatformAccountError(422, "missing_field", `الحقل ${field} مطلوب`);
  return result;
}

function integer(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, field = "القيمة" } = {}) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new PlatformAccountError(422, "invalid_number", `${field} غير صالح`);
  }
  return parsed;
}

function uuid(value, field = "المعرف") {
  const result = text(value, 80);
  if (!UUID_PATTERN.test(result)) {
    throw new PlatformAccountError(422, "invalid_id", `${field} غير صالح`);
  }
  return result;
}

function currency(value) {
  const result = text(value, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(result)) {
    throw new PlatformAccountError(422, "invalid_currency", "رمز العملة غير صالح");
  }
  return result;
}

function phone(value) {
  const result = text(value, 40);
  if (!result) return null;
  const normalized = result.replace(/[^+\d]/g, "");
  if (!/^\+?[1-9]\d{7,14}$/.test(normalized)) {
    throw new PlatformAccountError(422, "invalid_phone", "رقم الهاتف غير صالح");
  }
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

function telegramUsername(value) {
  const result = text(value, 80).replace(/^@/, "");
  if (!result) return null;
  if (!/^[A-Za-z0-9_]{5,32}$/.test(result)) {
    throw new PlatformAccountError(422, "invalid_telegram_username", "معرف تيليجرام غير صالح");
  }
  return result;
}

function safeTimezone(value) {
  const result = text(value, 80) || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: result }).format();
  } catch {
    throw new PlatformAccountError(422, "invalid_timezone", "المنطقة الزمنية غير صالحة");
  }
  return result;
}

function notificationPreferences(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    orders: source.orders !== false,
    wallet: source.wallet !== false,
    security: source.security !== false,
    marketing: source.marketing === true
  };
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function proofImage(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(
    String(value || "")
  );
  if (!match || !PROOF_MIME.has(match[1].toLowerCase())) {
    throw new PlatformAccountError(422, "invalid_proof", "إثبات التحويل يجب أن يكون JPG أو PNG أو WebP");
  }
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length < 32 || bytes.length > MAX_PROOF_BYTES) {
    throw new PlatformAccountError(422, "invalid_proof_size", "حجم إثبات التحويل يجب ألا يتجاوز 1.5MB");
  }
  const mime = match[1].toLowerCase();
  const png = mime === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = mime === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = mime === "image/webp" && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!png && !jpeg && !webp) {
    throw new PlatformAccountError(422, "invalid_proof_content", "محتوى صورة الإثبات غير صالح");
  }
  return { mime, bytes, digest: sha256(bytes) };
}

async function authenticate(db, request) {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) throw new PlatformAccountError(401, "authentication_required", "يجب تسجيل الدخول");
  const result = await db.query(
    `SELECT u.*, s.csrf_hash
     FROM sessions s
     JOIN platform_users u ON u.id=s.user_id
     WHERE s.token_hash=$1
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
       AND u.status='active'`,
    [sha256(token)]
  );
  const user = result.rows[0];
  if (!user) throw new PlatformAccountError(401, "invalid_session", "انتهت الجلسة أو ألغيت");
  return user;
}

function requirePlatformAdmin(user) {
  if (!user.is_platform_admin) {
    throw new PlatformAccountError(403, "platform_admin_required", "هذه العملية متاحة لمدير المنصة فقط");
  }
}

function requireCsrf(request, user) {
  const token = request.headers["x-csrf-token"];
  if (!token || sha256(token) !== user.csrf_hash) {
    throw new PlatformAccountError(403, "csrf_failed", "تعذر التحقق من الطلب");
  }
}

async function ensureAccount(db, userId) {
  await db.query(
    `INSERT INTO platform_account_wallets (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  await db.query(
    `INSERT INTO platform_account_preferences (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  const existing = await db.query(
    "SELECT 1 FROM platform_account_notifications WHERE user_id=$1 LIMIT 1",
    [userId]
  );
  if (!existing.rows[0]) {
    await db.query(
      `INSERT INTO platform_account_notifications (
         id, user_id, notification_type, title, body, action_url
       ) VALUES ($1,$2,'welcome',$3,$4,$5)`,
      [
        randomUUID(),
        userId,
        "مرحبًا بك في UCHIHA",
        "أصبح حسابك المركزي جاهزًا لإدارة مشاريعك ورصيدك وخدماتك من مكان واحد.",
        "/services"
      ]
    );
  }
}

function walletDto(row) {
  return {
    currency: row?.currency || "USD",
    balanceMinor: Number(row?.balance_minor || 0),
    heldMinor: Number(row?.held_minor || 0),
    availableMinor: Math.max(0, Number(row?.balance_minor || 0) - Number(row?.held_minor || 0)),
    updatedAt: row?.updated_at || null
  };
}

function preferenceDto(row) {
  return {
    locale: row?.locale || "ar",
    currency: row?.currency || "USD",
    timezone: row?.timezone || "UTC",
    phone: row?.phone || "",
    telegramUserId: row?.telegram_user_id || "",
    telegramUsername: row?.telegram_username || "",
    notifications: notificationPreferences(jsonValue(row?.notification_preferences, {})),
    updatedAt: row?.updated_at || null
  };
}

function notificationDto(row) {
  return {
    id: row.id,
    type: row.notification_type,
    title: row.title,
    body: row.body,
    actionUrl: row.action_url || null,
    isRead: Boolean(row.read_at),
    readAt: row.read_at || null,
    createdAt: row.created_at
  };
}

function ledgerDto(row) {
  return {
    id: row.id,
    type: row.entry_type,
    amountMinor: Number(row.amount_minor),
    balanceAfterMinor: Number(row.balance_after_minor),
    currency: row.currency,
    referenceType: row.reference_type || null,
    referenceId: row.reference_id || null,
    description: row.description,
    createdAt: row.created_at
  };
}

function depositDto(row) {
  return {
    id: row.id,
    paymentMethodId: row.payment_method_id,
    paymentMethodName: row.payment_method_name || null,
    paymentMethodKey: row.payment_method_key || null,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    payerName: row.payer_name || null,
    providerReference: row.provider_reference || null,
    status: row.status,
    adminNote: row.admin_note || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function accountSnapshot(db, user) {
  await ensureAccount(db, user.id);
  const [wallet, preferences, unread, notifications, ledger, projects, stores, serviceOrders, depositOrders] = await Promise.all([
    db.query("SELECT * FROM platform_account_wallets WHERE user_id=$1", [user.id]),
    db.query("SELECT * FROM platform_account_preferences WHERE user_id=$1", [user.id]),
    db.query(
      "SELECT COUNT(*) AS count FROM platform_account_notifications WHERE user_id=$1 AND read_at IS NULL",
      [user.id]
    ),
    db.query(
      `SELECT * FROM platform_account_notifications
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT 12`,
      [user.id]
    ),
    db.query(
      `SELECT * FROM platform_account_ledger
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT 10`,
      [user.id]
    ),
    db.query("SELECT COUNT(*) AS count FROM platform_projects WHERE user_id=$1", [user.id]),
    db.query(
      `SELECT COUNT(*) AS count
       FROM tenant_memberships
       WHERE user_id=$1 AND status='active'`,
      [user.id]
    ),
    db.query("SELECT COUNT(*) AS count FROM service_requests WHERE user_id=$1", [user.id]),
    db.query("SELECT COUNT(*) AS count FROM platform_deposit_requests WHERE user_id=$1", [user.id])
  ]);
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      isPlatformAdmin: Boolean(user.is_platform_admin),
      status: user.status,
      createdAt: user.created_at
    },
    wallet: walletDto(wallet.rows[0]),
    preferences: preferenceDto(preferences.rows[0]),
    counts: {
      projects: Number(projects.rows[0]?.count || 0),
      stores: Number(stores.rows[0]?.count || 0),
      orders: Number(serviceOrders.rows[0]?.count || 0) + Number(depositOrders.rows[0]?.count || 0),
      unreadNotifications: Number(unread.rows[0]?.count || 0)
    },
    notifications: notifications.rows.map(notificationDto),
    ledger: ledger.rows.map(ledgerDto)
  };
}

function route(handler) {
  return async (request, reply) => handler(request, reply);
}

export function installPlatformAccountCore(app, { db }) {
  app.get(
    "/api/platform/account",
    route(async (request) => {
      const user = await authenticate(db, request);
      return { account: await accountSnapshot(db, user) };
    })
  );

  app.patch(
    "/api/platform/account",
    route(async (request) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      await ensureAccount(db, user.id);
      const body = request.body || {};
      const displayName = requiredText(body.displayName ?? user.display_name, "الاسم", 120);
      const locale = text(body.locale || "ar", 2);
      if (!SUPPORTED_LOCALES.has(locale)) {
        throw new PlatformAccountError(422, "invalid_locale", "اللغة غير مدعومة");
      }
      const preferredCurrency = currency(body.currency || "USD");
      const timezone = safeTimezone(body.timezone || "UTC");
      const normalizedPhone = phone(body.phone);
      const normalizedTelegramUsername = telegramUsername(body.telegramUsername);
      const preferences = notificationPreferences(body.notifications);

      await db.transaction(async (client) => {
        await client.query(
          "UPDATE platform_users SET display_name=$2, updated_at=NOW() WHERE id=$1",
          [user.id, displayName]
        );
        await client.query(
          `UPDATE platform_account_preferences
           SET locale=$2, currency=$3, timezone=$4, phone=$5,
               telegram_username=$6, notification_preferences=$7, updated_at=NOW()
           WHERE user_id=$1`,
          [
            user.id,
            locale,
            preferredCurrency,
            timezone,
            normalizedPhone,
            normalizedTelegramUsername,
            JSON.stringify(preferences)
          ]
        );
      });

      const refreshed = { ...user, display_name: displayName };
      return { account: await accountSnapshot(db, refreshed) };
    })
  );

  app.get(
    "/api/platform/wallet",
    route(async (request) => {
      const user = await authenticate(db, request);
      await ensureAccount(db, user.id);
      const [wallet, ledger] = await Promise.all([
        db.query("SELECT * FROM platform_account_wallets WHERE user_id=$1", [user.id]),
        db.query(
          `SELECT * FROM platform_account_ledger
           WHERE user_id=$1
           ORDER BY created_at DESC
           LIMIT 50`,
          [user.id]
        )
      ]);
      return { wallet: walletDto(wallet.rows[0]), ledger: ledger.rows.map(ledgerDto) };
    })
  );

  app.get(
    "/api/platform/orders",
    route(async (request) => {
      const user = await authenticate(db, request);
      const [serviceRequests, depositRequests] = await Promise.all([
        db.query(
          `SELECT sr.id, sr.status, sr.details, sr.created_at, sr.updated_at,
                  ps.name_ar AS title, ps.slug AS product_slug
           FROM service_requests sr
           JOIN platform_services ps ON ps.id=sr.service_id
           WHERE sr.user_id=$1
           ORDER BY sr.created_at DESC
           LIMIT 100`,
          [user.id]
        ),
        db.query(
          `SELECT dr.*, pm.name_ar AS payment_method_name, pm.method_key AS payment_method_key
           FROM platform_deposit_requests dr
           JOIN platform_payment_methods pm ON pm.id=dr.payment_method_id
           WHERE dr.user_id=$1
           ORDER BY dr.created_at DESC
           LIMIT 100`,
          [user.id]
        )
      ]);
      const orders = [
        ...serviceRequests.rows.map((row) => ({
          id: row.id,
          type: "service",
          title: row.title,
          description: row.details,
          status: row.status,
          productSlug: row.product_slug,
          amountMinor: null,
          currency: null,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        })),
        ...depositRequests.rows.map((row) => ({
          ...depositDto(row),
          type: "deposit",
          title: `إضافة رصيد عبر ${row.payment_method_name}`
        }))
      ].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
      return { orders };
    })
  );

  app.post(
    "/api/platform/deposit-requests",
    route(async (request, reply) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      await ensureAccount(db, user.id);
      const idempotencyKey = requiredText(request.headers["idempotency-key"], "مفتاح العملية", 160);
      const body = request.body || {};
      const paymentMethodId = uuid(body.paymentMethodId, "طريقة الدفع");
      const amountMinor = integer(body.amountMinor, {
        minimum: 1,
        maximum: 9_000_000_000_000,
        field: "المبلغ"
      });
      const payerName = text(body.payerName, 200) || null;
      const providerReference = text(body.providerReference, 240) || null;
      const proof = proofImage(body.proofDataUrl);
      const method = (
        await db.query(
          `SELECT * FROM platform_payment_methods
           WHERE id=$1 AND tenant_id IS NULL AND store_id IS NULL
             AND status='active'
             AND (account_identifier IS NOT NULL OR qr_data IS NOT NULL OR qr_image_url IS NOT NULL)`,
          [paymentMethodId]
        )
      ).rows[0];
      if (!method) {
        throw new PlatformAccountError(404, "payment_method_unavailable", "طريقة الدفع غير متاحة حاليًا");
      }
      if (method.minimum_amount_minor !== null && amountMinor < Number(method.minimum_amount_minor)) {
        throw new PlatformAccountError(422, "below_minimum", "المبلغ أقل من الحد الأدنى لهذه الطريقة");
      }
      if (method.maximum_amount_minor !== null && amountMinor > Number(method.maximum_amount_minor)) {
        throw new PlatformAccountError(422, "above_maximum", "المبلغ أعلى من الحد الأقصى لهذه الطريقة");
      }
      const normalized = {
        paymentMethodId,
        amountMinor,
        currency: method.currency,
        payerName,
        providerReference,
        proofDigest: proof.digest
      };
      const requestHash = sha256(JSON.stringify(normalized));
      const previous = (
        await db.query(
          `SELECT dr.*, pm.name_ar AS payment_method_name, pm.method_key AS payment_method_key
           FROM platform_deposit_requests dr
           JOIN platform_payment_methods pm ON pm.id=dr.payment_method_id
           WHERE dr.user_id=$1 AND dr.idempotency_key=$2`,
          [user.id, idempotencyKey]
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) {
          throw new PlatformAccountError(409, "idempotency_mismatch", "استخدم مفتاحًا جديدًا عند تغيير بيانات الطلب");
        }
        return { request: depositDto(previous), duplicate: true };
      }
      const id = randomUUID();
      await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO platform_deposit_requests (
             id, user_id, payment_method_id, amount_minor, currency,
             payer_name, provider_reference, proof_mime, proof_bytes,
             idempotency_key, request_hash
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            id,
            user.id,
            paymentMethodId,
            amountMinor,
            method.currency,
            payerName,
            providerReference,
            proof.mime,
            proof.bytes,
            idempotencyKey,
            requestHash
          ]
        );
        await client.query(
          `INSERT INTO platform_account_notifications (
             id, user_id, notification_type, title, body, action_url
           ) VALUES ($1,$2,'deposit',$3,$4,$5)`,
          [
            randomUUID(),
            user.id,
            "تم استلام طلب إضافة الرصيد",
            `طلبك عبر ${method.name_ar} قيد المراجعة.`,
            "/orders"
          ]
        );
      });
      reply.code(201);
      return {
        request: {
          id,
          paymentMethodId,
          paymentMethodName: method.name_ar,
          paymentMethodKey: method.method_key,
          amountMinor,
          currency: method.currency,
          payerName,
          providerReference,
          status: "pending_review",
          adminNote: null,
          reviewedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };
    })
  );

  app.get(
    "/api/platform/admin/deposit-requests",
    route(async (request) => {
      const user = await authenticate(db, request);
      requirePlatformAdmin(user);
      const rows = await db.query(
        `SELECT dr.*, pm.name_ar AS payment_method_name, pm.method_key AS payment_method_key,
                u.email AS user_email, u.display_name AS user_name
         FROM platform_deposit_requests dr
         JOIN platform_payment_methods pm ON pm.id=dr.payment_method_id
         JOIN platform_users u ON u.id=dr.user_id
         ORDER BY dr.created_at DESC
         LIMIT 200`
      );
      return {
        requests: rows.rows.map((row) => ({
          ...depositDto(row),
          user: { id: row.user_id, email: row.user_email, displayName: row.user_name },
          proofUrl: `/api/platform/admin/deposit-requests/${row.id}/proof`
        }))
      };
    })
  );

  app.get(
    "/api/platform/admin/deposit-requests/:requestId/proof",
    route(async (request, reply) => {
      const user = await authenticate(db, request);
      requirePlatformAdmin(user);
      const requestId = uuid(request.params.requestId, "الطلب");
      const row = (
        await db.query(
          "SELECT proof_mime, proof_bytes FROM platform_deposit_requests WHERE id=$1",
          [requestId]
        )
      ).rows[0];
      if (!row) throw new PlatformAccountError(404, "deposit_request_not_found", "طلب الإيداع غير موجود");
      reply.header("cache-control", "private, no-store");
      reply.type(row.proof_mime);
      return row.proof_bytes;
    })
  );

  app.post(
    "/api/platform/admin/deposit-requests/:requestId/review",
    route(async (request) => {
      const user = await authenticate(db, request);
      requirePlatformAdmin(user);
      requireCsrf(request, user);
      const requestId = uuid(request.params.requestId, "الطلب");
      const status = text(request.body?.status, 40);
      if (!DEPOSIT_REVIEW_STATUSES.has(status)) {
        throw new PlatformAccountError(422, "invalid_review_status", "حالة المراجعة غير صالحة");
      }
      const adminNote = text(request.body?.adminNote, 1200) || null;
      const reviewed = await db.transaction(async (client) => {
        const current = (
          await client.query(
            `SELECT dr.*, pm.name_ar AS payment_method_name, pm.method_key AS payment_method_key
             FROM platform_deposit_requests dr
             JOIN platform_payment_methods pm ON pm.id=dr.payment_method_id
             WHERE dr.id=$1 FOR UPDATE`,
            [requestId]
          )
        ).rows[0];
        if (!current) throw new PlatformAccountError(404, "deposit_request_not_found", "طلب الإيداع غير موجود");
        if (current.status !== "pending_review") {
          throw new PlatformAccountError(409, "deposit_already_reviewed", "تمت مراجعة هذا الطلب مسبقًا");
        }
        if (status === "approved") {
          await client.query(
            `INSERT INTO platform_account_wallets (user_id, currency)
             VALUES ($1,$2)
             ON CONFLICT (user_id) DO NOTHING`,
            [current.user_id, current.currency]
          );
          const wallet = (
            await client.query(
              "SELECT * FROM platform_account_wallets WHERE user_id=$1 FOR UPDATE",
              [current.user_id]
            )
          ).rows[0];
          if (wallet.currency !== current.currency) {
            throw new PlatformAccountError(409, "wallet_currency_mismatch", "عملة المحفظة لا تطابق عملة طلب الإيداع");
          }
          const nextBalance = Number(wallet.balance_minor) + Number(current.amount_minor);
          await client.query(
            `UPDATE platform_account_wallets
             SET balance_minor=$2, updated_at=NOW()
             WHERE user_id=$1`,
            [current.user_id, nextBalance]
          );
          await client.query(
            `INSERT INTO platform_account_ledger (
               id, user_id, entry_type, amount_minor, balance_after_minor,
               currency, reference_type, reference_id, description
             ) VALUES ($1,$2,'deposit_approved',$3,$4,$5,'platform_deposit',$6,$7)`,
            [
              randomUUID(),
              current.user_id,
              Number(current.amount_minor),
              nextBalance,
              current.currency,
              current.id,
              `إضافة رصيد عبر ${current.payment_method_name}`
            ]
          );
        }
        await client.query(
          `UPDATE platform_deposit_requests
           SET status=$2, admin_note=$3, reviewed_by=$4,
               reviewed_at=NOW(), updated_at=NOW()
           WHERE id=$1`,
          [requestId, status, adminNote, user.id]
        );
        await client.query(
          `INSERT INTO platform_account_notifications (
             id, user_id, notification_type, title, body, action_url
           ) VALUES ($1,$2,'deposit',$3,$4,$5)`,
          [
            randomUUID(),
            current.user_id,
            status === "approved" ? "تمت إضافة الرصيد" : "تم رفض طلب إضافة الرصيد",
            status === "approved"
              ? `تمت إضافة الرصيد عبر ${current.payment_method_name} إلى محفظتك.`
              : adminNote || "راجع بيانات التحويل أو تواصل مع الدعم.",
            "/orders"
          ]
        );
        return {
          ...current,
          status,
          admin_note: adminNote,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      });
      return { request: depositDto(reviewed) };
    })
  );

  app.get(
    "/api/platform/notifications",
    route(async (request) => {
      const user = await authenticate(db, request);
      await ensureAccount(db, user.id);
      const requested = Number.parseInt(String(request.query?.limit || 30), 10);
      const limit = Number.isSafeInteger(requested) ? Math.max(1, Math.min(requested, 100)) : 30;
      const notifications = await db.query(
        `SELECT * FROM platform_account_notifications
         WHERE user_id=$1
         ORDER BY created_at DESC
         LIMIT $2`,
        [user.id, limit]
      );
      return { notifications: notifications.rows.map(notificationDto) };
    })
  );

  app.post(
    "/api/platform/notifications/read",
    route(async (request) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      await ensureAccount(db, user.id);
      const ids = Array.isArray(request.body?.ids)
        ? [...new Set(request.body.ids.map((value) => text(value, 80)).filter((value) => UUID_PATTERN.test(value)))]
        : [];
      if (request.body?.all === true) {
        await db.query(
          `UPDATE platform_account_notifications
           SET read_at=COALESCE(read_at, NOW())
           WHERE user_id=$1`,
          [user.id]
        );
      } else if (ids.length) {
        await db.query(
          `UPDATE platform_account_notifications
           SET read_at=COALESCE(read_at, NOW())
           WHERE user_id=$1 AND id=ANY($2::uuid[])`,
          [user.id, ids]
        );
      } else {
        throw new PlatformAccountError(422, "notification_selection_required", "اختر إشعارًا واحدًا على الأقل");
      }
      const unread = await db.query(
        "SELECT COUNT(*) AS count FROM platform_account_notifications WHERE user_id=$1 AND read_at IS NULL",
        [user.id]
      );
      return { ok: true, unreadCount: Number(unread.rows[0]?.count || 0) };
    })
  );
}
