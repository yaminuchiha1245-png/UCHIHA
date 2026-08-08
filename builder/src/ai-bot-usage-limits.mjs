import { decryptSecret, sha256 } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

const SESSION_COOKIE = "uchiha_builder_session";

class UsageLimitError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function text(value, maximum = 300) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, maximum);
}

function integer(value, { minimum, maximum, field }) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new UsageLimitError(422, "invalid_limit", `${field} يجب أن يكون بين ${minimum} و${maximum}`);
  }
  return parsed;
}

async function authenticate(db, request) {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) throw new UsageLimitError(401, "authentication_required", "يجب تسجيل الدخول");
  const user = (
    await db.query(
      `SELECT u.*, s.csrf_hash
       FROM sessions s JOIN platform_users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL
         AND s.expires_at>NOW() AND u.status='active'`,
      [sha256(token)]
    )
  ).rows[0];
  if (!user) throw new UsageLimitError(401, "invalid_session", "انتهت الجلسة أو ألغيت");
  return user;
}

function requireCsrf(request, user) {
  const token = request.headers["x-csrf-token"];
  if (!token || sha256(token) !== user.csrf_hash) {
    throw new UsageLimitError(403, "csrf_failed", "تعذر التحقق من الطلب");
  }
}

async function ownedInstance(db, userId, instanceId) {
  const row = (
    await db.query(
      `SELECT id, user_id, free_daily_request_limit, pro_daily_request_limit,
              free_daily_image_limit, pro_daily_image_limit
       FROM ai_bot_instances WHERE id=$1 AND user_id=$2`,
      [instanceId, userId]
    )
  ).rows[0];
  if (!row) throw new UsageLimitError(404, "ai_bot_not_found", "بوت الذكاء الاصطناعي غير موجود");
  return row;
}

function limitsDto(row) {
  return {
    freeDailyRequests: Number(row.free_daily_request_limit || 30),
    proDailyRequests: Number(row.pro_daily_request_limit || 300),
    freeDailyImages: Number(row.free_daily_image_limit ?? 2),
    proDailyImages: Number(row.pro_daily_image_limit ?? 30)
  };
}

async function usageToday(db, instanceId) {
  const row = (
    await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status='completed')::int AS requests,
         COUNT(*) FILTER (WHERE status='completed' AND request_kind='image')::int AS images,
         COUNT(DISTINCT telegram_user_id) FILTER (WHERE status='completed')::int AS active_users
       FROM ai_bot_usage
       WHERE instance_id=$1 AND created_at>=CURRENT_DATE`,
      [instanceId]
    )
  ).rows[0] || {};
  return {
    requests: Number(row.requests || 0),
    images: Number(row.images || 0),
    activeUsers: Number(row.active_users || 0)
  };
}

async function sendLimitMessage(config, instance, chatId, message) {
  if (!instance.token_ciphertext) return;
  const token = decryptSecret(instance.token_ciphertext, config.encryptionKey);
  const gateway = new TelegramGateway(config);
  await gateway.sendMessage(token, chatId, message, {
    reply_markup: {
      inline_keyboard: [[{ text: "🏠 الرئيسية", callback_data: "ai:home" }]]
    }
  }).catch(() => undefined);
}

async function enforcePromptLimit(db, config, request, reply) {
  if (request.method !== "POST") return;
  const path = String(request.raw?.url || request.url || "").split("?")[0];
  const match = /^\/webhooks\/ai-bots\/([0-9a-f-]+)$/i.exec(path);
  if (!match) return;
  const message = request.body?.message;
  const prompt = text(message?.text, 12000);
  const telegramUserId = message?.from?.id ? String(message.from.id) : "";
  const chatId = message?.chat?.id;
  if (!prompt || prompt.startsWith("/") || !telegramUserId || !chatId) return;

  const instance = (
    await db.query(
      `SELECT id, token_ciphertext, status,
              free_daily_request_limit, pro_daily_request_limit,
              free_daily_image_limit, pro_daily_image_limit
       FROM ai_bot_instances
       WHERE id=$1 AND status='active' AND token_ciphertext IS NOT NULL`,
      [match[1]]
    )
  ).rows[0];
  if (!instance) return;

  const globalUsed = Number((
    await db.query(
      `SELECT COUNT(*)::int AS count FROM ai_bot_usage
       WHERE status='completed' AND created_at>=CURRENT_DATE`
    )
  ).rows[0]?.count || 0);
  const globalLimit = Number(config.aiPlatformDailyRequestLimit || 50_000);
  if (globalUsed >= globalLimit) {
    await sendLimitMessage(
      config,
      instance,
      chatId,
      "⚠️ خدمة الذكاء الاصطناعي وصلت إلى الحد التشغيلي اليومي. ستعود تلقائيًا عند تجدد الحد."
    );
    return reply.code(200).send({ ok: true, limited: "platform_daily" });
  }

  const endUser = (
    await db.query(
      `SELECT active_mode, pro_until, is_banned
       FROM ai_bot_end_users
       WHERE instance_id=$1 AND telegram_user_id=$2`,
      [instance.id, telegramUserId]
    )
  ).rows[0];
  if (endUser?.is_banned) return;
  const isPro = Boolean(endUser?.pro_until && new Date(endUser.pro_until).getTime() > Date.now());
  const mode = endUser?.active_mode || "general";
  const requestLimit = Number(
    isPro ? instance.pro_daily_request_limit : instance.free_daily_request_limit
  );
  const imageLimit = Number(
    isPro ? instance.pro_daily_image_limit : instance.free_daily_image_limit
  );
  const counts = (
    await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status='completed')::int AS requests,
         COUNT(*) FILTER (WHERE status='completed' AND request_kind='image')::int AS images
       FROM ai_bot_usage
       WHERE instance_id=$1 AND telegram_user_id=$2 AND created_at>=CURRENT_DATE`,
      [instance.id, telegramUserId]
    )
  ).rows[0] || {};
  const requests = Number(counts.requests || 0);
  const images = Number(counts.images || 0);

  if (requests >= requestLimit) {
    await sendLimitMessage(
      config,
      instance,
      chatId,
      isPro
        ? `⚠️ وصلت إلى حد PRO اليومي (${requestLimit} طلب). يتجدد الحد تلقائيًا يوميًا.`
        : `🟡 وصلت إلى الحد المجاني اليومي (${requestLimit} طلب). اشترك في PRO لرفع الحد.`
    );
    return reply.code(200).send({ ok: true, limited: isPro ? "pro_daily" : "free_daily" });
  }
  if (mode === "image" && images >= imageLimit) {
    await sendLimitMessage(
      config,
      instance,
      chatId,
      isPro
        ? `⚠️ وصلت إلى حد صور PRO اليومي (${imageLimit} صورة).`
        : `🟡 وصلت إلى حد الصور المجانية اليومي (${imageLimit} صورة). اشترك في PRO لإنشاء صور أكثر.`
    );
    return reply.code(200).send({ ok: true, limited: isPro ? "pro_images_daily" : "free_images_daily" });
  }
}

export function installAiBotUsageLimitRoutes(app, { db, config }) {
  app.get("/api/platform/ai-bots/:instanceId/limits", async (request) => {
    const user = await authenticate(db, request);
    const instance = await ownedInstance(db, user.id, request.params.instanceId);
    return {
      limits: limitsDto(instance),
      usageToday: await usageToday(db, instance.id)
    };
  });

  app.patch("/api/platform/ai-bots/:instanceId/limits", async (request) => {
    const user = await authenticate(db, request);
    requireCsrf(request, user);
    const instance = await ownedInstance(db, user.id, request.params.instanceId);
    const limits = {
      freeDailyRequests: integer(
        request.body?.freeDailyRequests ?? instance.free_daily_request_limit,
        { minimum: 1, maximum: 200, field: "حد الطلبات المجانية" }
      ),
      proDailyRequests: integer(
        request.body?.proDailyRequests ?? instance.pro_daily_request_limit,
        { minimum: 1, maximum: 2000, field: "حد طلبات PRO" }
      ),
      freeDailyImages: integer(
        request.body?.freeDailyImages ?? instance.free_daily_image_limit,
        { minimum: 0, maximum: 20, field: "حد الصور المجانية" }
      ),
      proDailyImages: integer(
        request.body?.proDailyImages ?? instance.pro_daily_image_limit,
        { minimum: 0, maximum: 200, field: "حد صور PRO" }
      )
    };
    if (limits.proDailyRequests < limits.freeDailyRequests) {
      throw new UsageLimitError(422, "pro_limit_too_low", "حد PRO يجب ألا يكون أقل من الحد المجاني");
    }
    if (limits.proDailyImages < limits.freeDailyImages) {
      throw new UsageLimitError(422, "pro_image_limit_too_low", "حد صور PRO يجب ألا يكون أقل من الحد المجاني");
    }
    const updated = (
      await db.query(
        `UPDATE ai_bot_instances SET
           free_daily_request_limit=$3, pro_daily_request_limit=$4,
           free_daily_image_limit=$5, pro_daily_image_limit=$6, updated_at=NOW()
         WHERE id=$1 AND user_id=$2
         RETURNING free_daily_request_limit, pro_daily_request_limit,
                   free_daily_image_limit, pro_daily_image_limit`,
        [
          instance.id,
          user.id,
          limits.freeDailyRequests,
          limits.proDailyRequests,
          limits.freeDailyImages,
          limits.proDailyImages
        ]
      )
    ).rows[0];
    return { limits: limitsDto(updated) };
  });

  app.addHook("preHandler", async (request, reply) => enforcePromptLimit(db, config, request, reply));
}

export { UsageLimitError, limitsDto };
