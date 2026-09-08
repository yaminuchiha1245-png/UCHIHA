import { timingSafeEqual } from "node:crypto";
import { decryptSecret, encryptSecret, maskSecret, sha256 } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

function pathOf(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

function clean(value, max = 1000) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function hasPro(row) {
  return Boolean(row?.pro_until && new Date(row.pro_until).getTime() > Date.now());
}

async function tg(config, token, method, payload = {}) {
  if (config.telegramMode === "fake") return { ok: true, simulated: true };
  return new TelegramGateway(config).request(token, method, payload);
}

async function send(config, token, chatId, message, keyboard = null) {
  return tg(config, token, "sendMessage", {
    chat_id: chatId,
    text: message,
    ...(keyboard ? { reply_markup: keyboard } : {})
  });
}

async function edit(config, token, callback, message, keyboard = null) {
  const chatId = callback?.message?.chat?.id;
  const messageId = callback?.message?.message_id;
  if (!chatId) return;
  if (messageId) {
    try {
      await tg(config, token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: message,
        ...(keyboard ? { reply_markup: keyboard } : {})
      });
      return;
    } catch {
      // Fall back to a new message when the previous one can no longer be edited.
    }
  }
  await send(config, token, chatId, message, keyboard);
}

async function answer(config, token, callbackId, message = "") {
  if (!callbackId) return;
  await tg(config, token, "answerCallbackQuery", {
    callback_query_id: callbackId,
    ...(message ? { text: message.slice(0, 180) } : {})
  }).catch(() => undefined);
}

async function setSession(db, instanceId, telegramUserId, state, payload = {}) {
  await db.query(
    `INSERT INTO ai_bot_admin_sessions (
       instance_id, telegram_user_id, state, payload, expires_at
     ) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '15 minutes')
     ON CONFLICT (instance_id, telegram_user_id) DO UPDATE SET
       state=EXCLUDED.state, payload=EXCLUDED.payload,
       expires_at=EXCLUDED.expires_at, updated_at=NOW()`,
    [instanceId, telegramUserId, state, JSON.stringify(payload)]
  );
}

async function clearSession(db, instanceId, telegramUserId) {
  await db.query(
    "DELETE FROM ai_bot_admin_sessions WHERE instance_id=$1 AND telegram_user_id=$2",
    [instanceId, telegramUserId]
  );
}

async function getSession(db, instanceId, telegramUserId) {
  return (
    await db.query(
      `SELECT * FROM ai_bot_admin_sessions
       WHERE instance_id=$1 AND telegram_user_id=$2 AND expires_at>NOW()`,
      [instanceId, telegramUserId]
    )
  ).rows[0] || null;
}

async function validateOpenAiKey(key) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${key}` },
      signal: controller.signal
    });
    if (!response.ok) return false;
    const data = await response.json().catch(() => ({}));
    return Array.isArray(data?.data);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function validateOpenAiModel(instance, config, modelId) {
  if (!instance.openai_api_key_ciphertext) return true;
  const key = decryptSecret(instance.openai_api_key_ciphertext, config.encryptionKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(modelId)}`, {
      headers: { authorization: `Bearer ${key}` },
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function homeKeyboard(instance) {
  return {
    inline_keyboard: [
      [
        { text: instance.openai_api_key_ciphertext ? "🧠 OpenAI ✅" : "🧠 ربط OpenAI", callback_data: "admin:openai" },
        { text: "🤖 النماذج", callback_data: "admin:models" }
      ],
      [
        { text: "⭐ إدارة PRO", callback_data: "admin:pro" },
        { text: "👥 المستخدمون", callback_data: "admin:users" }
      ],
      [
        { text: "📊 الإحصائيات", callback_data: "admin:stats" },
        { text: "🚦 حدود الاستخدام", callback_data: "admin:limits" }
      ],
      [{ text: "⚙️ إعدادات البوت", callback_data: "admin:settings" }],
      [{ text: "🏠 واجهة المستخدم", callback_data: "ai:home" }]
    ]
  };
}

async function renderHome(db, config, instance, token, target) {
  const row = (
    await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM ai_bot_end_users WHERE instance_id=$1) AS users,
         (SELECT COUNT(*)::int FROM ai_bot_end_users WHERE instance_id=$1 AND pro_until>NOW()) AS pro_users,
         (SELECT COUNT(*)::int FROM ai_bot_usage WHERE instance_id=$1 AND status='completed' AND created_at>=CURRENT_DATE) AS requests_today`,
      [instance.id]
    )
  ).rows[0] || {};
  const message = [
    `⚙️ لوحة إدارة ${instance.display_name}`,
    "",
    `🧠 OpenAI: ${instance.openai_api_key_ciphertext ? `متصل ${instance.openai_key_masked || ""}` : "غير مربوط"}`,
    `👥 المستخدمون: ${Number(row.users || 0)}`,
    `⭐ PRO: ${Number(row.pro_users || 0)}`,
    `💬 طلبات اليوم: ${Number(row.requests_today || 0)}`,
    "",
    "كل إعدادات البوت تتم من هنا. منصة UCHIHA مخصصة للشراء فقط."
  ].join("\n");
  if (target?.callback_query) return edit(config, token, target.callback_query, message, homeKeyboard(instance));
  return send(config, token, target.chatId, message, homeKeyboard(instance));
}

async function renderOpenAi(config, instance, token, callback) {
  const configured = Boolean(instance.openai_api_key_ciphertext);
  await edit(
    config,
    token,
    callback,
    [
      "🧠 إعداد OpenAI",
      "",
      `الحالة: ${configured ? "✅ متصل" : "❌ غير مربوط"}`,
      configured ? `المفتاح: ${instance.openai_key_masked || "محفوظ بأمان"}` : "أضف API Key لتشغيل الذكاء في هذا البوت.",
      "",
      "المفتاح يُشفّر على السيرفر ولا يظهر بعد الحفظ."
    ].join("\n"),
    {
      inline_keyboard: [
        [{ text: configured ? "🔄 تغيير API Key" : "➕ إضافة API Key", callback_data: "admin:openai:set" }],
        ...(configured ? [[{ text: "🗑 إزالة الربط", callback_data: "admin:openai:remove" }]] : []),
        [{ text: "💳 فوترة OpenAI", url: "https://platform.openai.com/settings/organization/billing/overview" }],
        [{ text: "↩️ رجوع", callback_data: "admin:home" }]
      ]
    }
  );
}

async function renderModels(db, config, instance, token, callback) {
  const models = (
    await db.query(
      `SELECT slug, display_name, provider_model, access_level, enabled
       FROM ai_bot_model_profiles WHERE instance_id=$1 ORDER BY sort_order, created_at LIMIT 12`,
      [instance.id]
    )
  ).rows;
  const lines = models.map((m) => `• ${m.display_name} — ${m.access_level.toUpperCase()} — ${m.enabled ? "فعال" : "متوقف"}\n  ${m.provider_model}`).join("\n");
  const rows = models.map((m) => [{ text: `⚙️ ${m.display_name}`, callback_data: `admin:model:${m.slug}` }]);
  rows.push([{ text: "↩️ رجوع", callback_data: "admin:home" }]);
  await edit(config, token, callback, ["🤖 إدارة النماذج", "", lines || "لا توجد نماذج."].join("\n"), { inline_keyboard: rows });
}

async function renderModel(db, config, instance, token, callback, slug) {
  const model = (
    await db.query(
      `SELECT slug, display_name, provider_model, access_level, enabled,
              intelligence_label, analysis_label, image_quality_label, coding_label
       FROM ai_bot_model_profiles WHERE instance_id=$1 AND slug=$2`,
      [instance.id, slug]
    )
  ).rows[0];
  if (!model) return answer(config, token, callback.id, "النموذج غير موجود");
  await edit(
    config,
    token,
    callback,
    [
      `🤖 ${model.display_name}`,
      "",
      `OpenAI model: ${model.provider_model}`,
      `الوصول: ${model.access_level.toUpperCase()}`,
      `الحالة: ${model.enabled ? "فعال" : "متوقف"}`,
      `🧠 الذكاء: ${model.intelligence_label}`,
      `🔎 التحليل: ${model.analysis_label}`,
      `🎨 الصور: ${model.image_quality_label}`,
      `💻 البرمجة: ${model.coding_label}`
    ].join("\n"),
    {
      inline_keyboard: [
        [
          { text: "✏️ تغيير الاسم", callback_data: `admin:model:${slug}:name` },
          { text: "🧠 تغيير نموذج OpenAI", callback_data: `admin:model:${slug}:provider` }
        ],
        [
          { text: model.access_level === "free" ? "⭐ جعله PRO" : "🆓 جعله مجاني", callback_data: `admin:model:${slug}:access` },
          { text: model.enabled ? "⏸ إيقاف" : "▶️ تشغيل", callback_data: `admin:model:${slug}:toggle` }
        ],
        [{ text: "↩️ النماذج", callback_data: "admin:models" }]
      ]
    }
  );
}

async function renderStats(db, config, instance, token, callback) {
  const row = (
    await db.query(
      `SELECT
         COUNT(*)::int AS requests,
         COUNT(*) FILTER (WHERE status='completed' AND created_at>=CURRENT_DATE)::int AS today,
         COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,
         COALESCE(SUM(output_tokens),0)::bigint AS output_tokens,
         COUNT(DISTINCT telegram_user_id)::int AS active_users
       FROM ai_bot_usage WHERE instance_id=$1`,
      [instance.id]
    )
  ).rows[0] || {};
  await edit(
    config,
    token,
    callback,
    [
      "📊 إحصائيات البوت",
      "",
      `👥 مستخدمون استخدموا AI: ${Number(row.active_users || 0)}`,
      `💬 إجمالي الطلبات: ${Number(row.requests || 0)}`,
      `📅 طلبات اليوم: ${Number(row.today || 0)}`,
      `⬇️ Tokens داخلة: ${Number(row.input_tokens || 0)}`,
      `⬆️ Tokens خارجة: ${Number(row.output_tokens || 0)}`
    ].join("\n"),
    { inline_keyboard: [[{ text: "↩️ رجوع", callback_data: "admin:home" }]] }
  );
}

async function renderUsers(db, config, instance, token, callback) {
  const users = (
    await db.query(
      `SELECT u.telegram_user_id, u.username, u.full_name, u.pro_until, u.is_banned,
              COUNT(x.id)::int AS requests
       FROM ai_bot_end_users u
       LEFT JOIN ai_bot_usage x ON x.instance_id=u.instance_id AND x.telegram_user_id=u.telegram_user_id
       WHERE u.instance_id=$1
       GROUP BY u.instance_id, u.telegram_user_id, u.username, u.full_name, u.pro_until, u.is_banned, u.last_seen_at
       ORDER BY u.last_seen_at DESC LIMIT 15`,
      [instance.id]
    )
  ).rows;
  const lines = users.map((u) => [
    `${u.is_banned ? "🚫" : hasPro(u) ? "⭐" : "👤"} ${u.full_name || u.username || u.telegram_user_id}`,
    `ID: ${u.telegram_user_id} · طلبات: ${Number(u.requests || 0)}`
  ].join(" — ")).join("\n");
  await edit(
    config,
    token,
    callback,
    ["👥 آخر المستخدمين", "", lines || "لا يوجد مستخدمون حتى الآن."].join("\n"),
    {
      inline_keyboard: [
        [
          { text: "⭐ منح/إلغاء PRO", callback_data: "admin:pro:set" },
          { text: "🚫 حظر/فك حظر", callback_data: "admin:ban:set" }
        ],
        [{ text: "↩️ رجوع", callback_data: "admin:home" }]
      ]
    }
  );
}

async function renderLimits(config, instance, token, callback) {
  await edit(
    config,
    token,
    callback,
    [
      "🚦 حدود الاستخدام اليومية",
      "",
      `🆓 رسائل المجاني: ${Number(instance.free_daily_request_limit || 30)}`,
      `⭐ رسائل PRO: ${Number(instance.pro_daily_request_limit || 300)}`,
      `🆓 صور المجاني: ${Number(instance.free_daily_image_limit ?? 2)}`,
      `⭐ صور PRO: ${Number(instance.pro_daily_image_limit ?? 30)}`
    ].join("\n"),
    {
      inline_keyboard: [
        [{ text: "✏️ تعديل الحدود", callback_data: "admin:limits:set" }],
        [{ text: "↩️ رجوع", callback_data: "admin:home" }]
      ]
    }
  );
}

async function renderSettings(config, instance, token, callback) {
  await edit(
    config,
    token,
    callback,
    [
      "⚙️ إعدادات البوت",
      "",
      `🤖 الاسم: ${instance.display_name}`,
      `⭐ رابط PRO: ${instance.pro_subscribe_url || "غير محدد"}`,
      "",
      "رسالة الترحيب:",
      clean(instance.welcome_text, 450) || "غير محددة"
    ].join("\n"),
    {
      inline_keyboard: [
        [
          { text: "✏️ تغيير الاسم", callback_data: "admin:settings:name" },
          { text: "📝 رسالة الترحيب", callback_data: "admin:settings:welcome" }
        ],
        [{ text: "💳 رابط اشتراك PRO", callback_data: "admin:settings:pro_url" }],
        [{ text: "↩️ رجوع", callback_data: "admin:home" }]
      ]
    }
  );
}

async function promptFor(config, token, callback, db, instance, userId, state, message, payload = {}) {
  await setSession(db, instance.id, userId, state, payload);
  await edit(
    config,
    token,
    callback,
    `${message}\n\nلإلغاء الإدخال أرسل /cancel`,
    { inline_keyboard: [[{ text: "↩️ إلغاء", callback_data: "admin:home" }]] }
  );
}

async function handleSession(db, config, instance, token, fromId, chatId, session, messageText) {
  if (messageText === "/cancel") {
    await clearSession(db, instance.id, fromId);
    await renderHome(db, config, instance, token, { chatId });
    return true;
  }

  const finish = async (message) => {
    await clearSession(db, instance.id, fromId);
    await send(config, token, chatId, `✅ ${message}`, { inline_keyboard: [[{ text: "⚙️ لوحة الإدارة", callback_data: "admin:home" }]] });
  };

  if (session.state === "openai_key") {
    const key = messageText.trim();
    if (!/^sk-[A-Za-z0-9_\-]{20,}$/.test(key) || !(await validateOpenAiKey(key))) {
      await send(config, token, chatId, "❌ مفتاح OpenAI غير صالح أو تعذر الاتصال به. أرسل مفتاحًا صحيحًا أو /cancel.");
      return true;
    }
    await db.query(
      `UPDATE ai_bot_instances SET
         openai_api_key_ciphertext=$2, openai_key_masked=$3,
         openai_key_fingerprint=$4, updated_at=NOW()
       WHERE id=$1`,
      [instance.id, encryptSecret(key, config.encryptionKey), maskSecret(key), sha256(key)]
    );
    await finish("تم ربط OpenAI بهذا البوت.");
    return true;
  }

  if (session.state === "limits") {
    const values = messageText.split(/[\s,،]+/).map((v) => Number.parseInt(v, 10));
    if (values.length !== 4 || values.some((v) => !Number.isInteger(v))) {
      await send(config, token, chatId, "أرسل 4 أرقام بهذا الترتيب: المجاني، PRO، صور المجاني، صور PRO\nمثال: 30 300 2 30");
      return true;
    }
    const [freeReq, proReq, freeImg, proImg] = values;
    if (freeReq < 1 || freeReq > 200 || proReq < freeReq || proReq > 2000 || freeImg < 0 || freeImg > 20 || proImg < freeImg || proImg > 200) {
      await send(config, token, chatId, "القيم خارج الحدود الآمنة. المجاني 1-200، PRO حتى 2000، صور المجاني 0-20، صور PRO حتى 200.");
      return true;
    }
    await db.query(
      `UPDATE ai_bot_instances SET
         free_daily_request_limit=$2, pro_daily_request_limit=$3,
         free_daily_image_limit=$4, pro_daily_image_limit=$5, updated_at=NOW()
       WHERE id=$1`,
      [instance.id, freeReq, proReq, freeImg, proImg]
    );
    await finish("تم حفظ حدود الاستخدام.");
    return true;
  }

  if (session.state === "grant_pro") {
    const [telegramId, daysRaw] = messageText.split(/[\s,،]+/);
    const days = Number.parseInt(daysRaw, 10);
    if (!/^\d{5,20}$/.test(telegramId || "") || !Number.isInteger(days) || days < 0 || days > 3650) {
      await send(config, token, chatId, "الصيغة: TelegramID ثم عدد الأيام. مثال: 123456789 30\nاستخدم 0 لإلغاء PRO.");
      return true;
    }
    const exists = (
      await db.query("SELECT 1 FROM ai_bot_end_users WHERE instance_id=$1 AND telegram_user_id=$2", [instance.id, telegramId])
    ).rows[0];
    if (!exists) {
      await send(config, token, chatId, "هذا المستخدم لم يدخل البوت بعد.");
      return true;
    }
    await db.query(
      `UPDATE ai_bot_end_users SET
         pro_until=CASE WHEN $3=0 THEN NULL ELSE NOW()+($3::text || ' days')::interval END,
         updated_at=NOW()
       WHERE instance_id=$1 AND telegram_user_id=$2`,
      [instance.id, telegramId, days]
    );
    await finish(days === 0 ? "تم إلغاء PRO للمستخدم." : `تم منح PRO لمدة ${days} يوم.`);
    return true;
  }

  if (session.state === "ban_user") {
    const [telegramId, modeRaw] = messageText.split(/[\s,،]+/);
    const mode = String(modeRaw || "").toLowerCase();
    if (!/^\d{5,20}$/.test(telegramId || "") || !["on", "off", "1", "0", "حظر", "فك"].includes(mode)) {
      await send(config, token, chatId, "الصيغة: TelegramID ثم on للحظر أو off لفك الحظر. مثال: 123456789 on");
      return true;
    }
    const banned = ["on", "1", "حظر"].includes(mode);
    await db.query(
      `UPDATE ai_bot_end_users SET is_banned=$3, updated_at=NOW()
       WHERE instance_id=$1 AND telegram_user_id=$2`,
      [instance.id, telegramId, banned]
    );
    await finish(banned ? "تم حظر المستخدم." : "تم فك حظر المستخدم.");
    return true;
  }

  if (["bot_name", "welcome", "pro_url", "model_name", "model_provider"].includes(session.state)) {
    const payload = typeof session.payload === "string" ? JSON.parse(session.payload || "{}") : (session.payload || {});
    if (session.state === "bot_name") {
      const name = clean(messageText, 120);
      if (name.length < 2) return send(config, token, chatId, "الاسم قصير جدًا.").then(() => true);
      await db.query("UPDATE ai_bot_instances SET display_name=$2, updated_at=NOW() WHERE id=$1", [instance.id, name]);
      await finish("تم تغيير اسم البوت.");
      return true;
    }
    if (session.state === "welcome") {
      const welcome = clean(messageText, 600);
      await db.query("UPDATE ai_bot_instances SET welcome_text=$2, updated_at=NOW() WHERE id=$1", [instance.id, welcome]);
      await finish("تم تحديث رسالة الترحيب.");
      return true;
    }
    if (session.state === "pro_url") {
      const value = messageText.trim();
      let url = null;
      if (value !== "-") {
        try {
          const parsed = new URL(value);
          if (!["https:", "tg:"].includes(parsed.protocol)) throw new Error();
          url = parsed.toString();
        } catch {
          await send(config, token, chatId, "الرابط غير صالح. أرسل HTTPS أو tg:// أو أرسل - لمسح الرابط.");
          return true;
        }
      }
      await db.query("UPDATE ai_bot_instances SET pro_subscribe_url=$2, updated_at=NOW() WHERE id=$1", [instance.id, url]);
      await finish(url ? "تم تحديث رابط PRO." : "تم حذف رابط PRO.");
      return true;
    }
    const slug = clean(payload.slug, 80);
    if (!slug) {
      await clearSession(db, instance.id, fromId);
      return true;
    }
    if (session.state === "model_name") {
      const name = clean(messageText, 120);
      if (name.length < 2) return send(config, token, chatId, "اسم النموذج قصير جدًا.").then(() => true);
      await db.query("UPDATE ai_bot_model_profiles SET display_name=$3, updated_at=NOW() WHERE instance_id=$1 AND slug=$2", [instance.id, slug, name]);
      await finish("تم تغيير اسم النموذج.");
      return true;
    }
    if (session.state === "model_provider") {
      const model = clean(messageText, 160);
      if (!model || !(await validateOpenAiModel(instance, config, model))) {
        await send(config, token, chatId, "تعذر التحقق من هذا النموذج في حساب OpenAI المرتبط. تأكد من الاسم مثل gpt-5.4 ثم حاول مجددًا.");
        return true;
      }
      await db.query("UPDATE ai_bot_model_profiles SET provider_model=$3, updated_at=NOW() WHERE instance_id=$1 AND slug=$2", [instance.id, slug, model]);
      await finish("تم تغيير نموذج OpenAI الحقيقي.");
      return true;
    }
  }

  return false;
}

export function installAiTelegramAdmin(app, { db, config }) {
  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;
    const match = /^\/webhooks\/ai-bots\/([0-9a-f-]+)$/i.exec(pathOf(request));
    if (!match) return;

    const instance = (
      await db.query("SELECT * FROM ai_bot_instances WHERE id=$1 AND status='active'", [match[1]])
    ).rows[0];
    if (!instance?.token_ciphertext || !instance.owner_telegram_id || !instance.webhook_secret_hash) return;
    const incoming = String(request.headers["x-telegram-bot-api-secret-token"] || "");
    if (!secureEqual(sha256(incoming), instance.webhook_secret_hash)) return;

    const update = request.body || {};
    const callback = update.callback_query;
    const message = update.message;
    const from = callback?.from || message?.from;
    const fromId = from?.id ? String(from.id) : "";
    const chatId = callback?.message?.chat?.id || message?.chat?.id;
    const data = String(callback?.data || "");
    const messageText = clean(message?.text, 4000);
    const isAdminIntent = messageText === "/admin" || messageText === "/cancel" || data.startsWith("admin:");
    const session = fromId ? await getSession(db, instance.id, fromId) : null;
    if (!isAdminIntent && !session) return;

    const token = decryptSecret(instance.token_ciphertext, config.encryptionKey);
    if (!fromId || !chatId || fromId !== String(instance.owner_telegram_id)) {
      if (callback) await answer(config, token, callback.id, "هذه اللوحة مخصصة لمالك البوت.");
      else if (messageText === "/admin") await send(config, token, chatId, "هذه اللوحة مخصصة لمالك البوت.");
      return reply.code(200).send({ ok: true, adminDenied: true });
    }

    if (session && messageText && !messageText.startsWith("/admin")) {
      const handled = await handleSession(db, config, instance, token, fromId, chatId, session, messageText);
      if (handled) return reply.code(200).send({ ok: true, admin: true });
    }

    if (messageText === "/admin") {
      await clearSession(db, instance.id, fromId);
      await renderHome(db, config, instance, token, { chatId });
      return reply.code(200).send({ ok: true, admin: true });
    }

    if (!callback || !data.startsWith("admin:")) return;
    await answer(config, token, callback.id);

    if (data === "admin:home") {
      await clearSession(db, instance.id, fromId);
      const fresh = (await db.query("SELECT * FROM ai_bot_instances WHERE id=$1", [instance.id])).rows[0];
      await renderHome(db, config, fresh, token, { callback_query: callback });
    } else if (data === "admin:openai") {
      const fresh = (await db.query("SELECT * FROM ai_bot_instances WHERE id=$1", [instance.id])).rows[0];
      await renderOpenAi(config, fresh, token, callback);
    } else if (data === "admin:openai:set") {
      await promptFor(config, token, callback, db, instance, fromId, "openai_key", "أرسل الآن OpenAI API Key الخاص بهذا البوت.");
    } else if (data === "admin:openai:remove") {
      await db.query(
        `UPDATE ai_bot_instances SET openai_api_key_ciphertext=NULL,
         openai_key_masked=NULL, openai_key_fingerprint=NULL, updated_at=NOW() WHERE id=$1`,
        [instance.id]
      );
      await edit(config, token, callback, "✅ تم إزالة ربط OpenAI.", { inline_keyboard: [[{ text: "↩️ OpenAI", callback_data: "admin:openai" }]] });
    } else if (data === "admin:models") {
      await renderModels(db, config, instance, token, callback);
    } else if (/^admin:model:[^:]+$/.test(data)) {
      await renderModel(db, config, instance, token, callback, data.split(":")[2]);
    } else if (/^admin:model:[^:]+:name$/.test(data)) {
      const slug = data.split(":")[2];
      await promptFor(config, token, callback, db, instance, fromId, "model_name", "أرسل الاسم التجاري الجديد للنموذج.", { slug });
    } else if (/^admin:model:[^:]+:provider$/.test(data)) {
      const slug = data.split(":")[2];
      await promptFor(config, token, callback, db, instance, fromId, "model_provider", "أرسل اسم نموذج OpenAI الحقيقي الذي تريد ربطه، مثل gpt-5.4.", { slug });
    } else if (/^admin:model:[^:]+:access$/.test(data)) {
      const slug = data.split(":")[2];
      const model = (await db.query("SELECT * FROM ai_bot_model_profiles WHERE instance_id=$1 AND slug=$2", [instance.id, slug])).rows[0];
      if (model) {
        const next = model.access_level === "free" ? "pro" : "free";
        if (next === "pro") {
          const otherFree = Number((await db.query("SELECT COUNT(*)::int AS count FROM ai_bot_model_profiles WHERE instance_id=$1 AND enabled=TRUE AND access_level='free' AND slug<>$2", [instance.id, slug])).rows[0]?.count || 0);
          if (!otherFree) {
            await answer(config, token, callback.id, "يجب إبقاء نموذج مجاني واحد على الأقل.");
            return reply.code(200).send({ ok: true, admin: true });
          }
        }
        await db.query("UPDATE ai_bot_model_profiles SET access_level=$3, updated_at=NOW() WHERE instance_id=$1 AND slug=$2", [instance.id, slug, next]);
        await renderModel(db, config, instance, token, callback, slug);
      }
    } else if (/^admin:model:[^:]+:toggle$/.test(data)) {
      const slug = data.split(":")[2];
      const model = (await db.query("SELECT * FROM ai_bot_model_profiles WHERE instance_id=$1 AND slug=$2", [instance.id, slug])).rows[0];
      if (model) {
        if (model.enabled && model.access_level === "free") {
          const otherFree = Number((await db.query("SELECT COUNT(*)::int AS count FROM ai_bot_model_profiles WHERE instance_id=$1 AND enabled=TRUE AND access_level='free' AND slug<>$2", [instance.id, slug])).rows[0]?.count || 0);
          if (!otherFree) {
            await answer(config, token, callback.id, "يجب إبقاء نموذج مجاني فعال واحد على الأقل.");
            return reply.code(200).send({ ok: true, admin: true });
          }
        }
        await db.query("UPDATE ai_bot_model_profiles SET enabled=$3, updated_at=NOW() WHERE instance_id=$1 AND slug=$2", [instance.id, slug, !model.enabled]);
        await renderModel(db, config, instance, token, callback, slug);
      }
    } else if (data === "admin:stats") {
      await renderStats(db, config, instance, token, callback);
    } else if (data === "admin:users") {
      await renderUsers(db, config, instance, token, callback);
    } else if (data === "admin:pro") {
      await edit(config, token, callback, "⭐ إدارة اشتراكات PRO\n\nيمكنك منح PRO أو إلغاؤه لأي مستخدم دخل البوت.", {
        inline_keyboard: [
          [{ text: "⭐ منح / إلغاء PRO", callback_data: "admin:pro:set" }],
          [{ text: "👥 عرض المستخدمين", callback_data: "admin:users" }],
          [{ text: "↩️ رجوع", callback_data: "admin:home" }]
        ]
      });
    } else if (data === "admin:pro:set") {
      await promptFor(config, token, callback, db, instance, fromId, "grant_pro", "أرسل Telegram ID ثم عدد أيام PRO.\nمثال: 123456789 30\nلإلغاء PRO استخدم 0 يوم.");
    } else if (data === "admin:ban:set") {
      await promptFor(config, token, callback, db, instance, fromId, "ban_user", "أرسل Telegram ID ثم on للحظر أو off لفك الحظر.\nمثال: 123456789 on");
    } else if (data === "admin:limits") {
      const fresh = (await db.query("SELECT * FROM ai_bot_instances WHERE id=$1", [instance.id])).rows[0];
      await renderLimits(config, fresh, token, callback);
    } else if (data === "admin:limits:set") {
      await promptFor(config, token, callback, db, instance, fromId, "limits", "أرسل 4 أرقام بالترتيب:\nطلبات المجاني، طلبات PRO، صور المجاني، صور PRO\nمثال: 30 300 2 30");
    } else if (data === "admin:settings") {
      const fresh = (await db.query("SELECT * FROM ai_bot_instances WHERE id=$1", [instance.id])).rows[0];
      await renderSettings(config, fresh, token, callback);
    } else if (data === "admin:settings:name") {
      await promptFor(config, token, callback, db, instance, fromId, "bot_name", "أرسل الاسم الجديد الذي سيظهر داخل البوت.");
    } else if (data === "admin:settings:welcome") {
      await promptFor(config, token, callback, db, instance, fromId, "welcome", "أرسل رسالة الترحيب الجديدة.");
    } else if (data === "admin:settings:pro_url") {
      await promptFor(config, token, callback, db, instance, fromId, "pro_url", "أرسل رابط اشتراك PRO. أرسل - إذا أردت حذف الرابط.");
    }

    return reply.code(200).send({ ok: true, admin: true });
  });
}
