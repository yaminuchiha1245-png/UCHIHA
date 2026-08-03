import { randomUUID } from "node:crypto";
import { sha256 } from "./security.mjs";

const SESSION_COOKIE = "uchiha_builder_session";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED_LOCALES = new Set(["ar", "en"]);

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

async function accountSnapshot(db, user) {
  await ensureAccount(db, user.id);
  const [wallet, preferences, unread, notifications, ledger, projects, stores] = await Promise.all([
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
    )
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
