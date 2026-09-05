import { randomUUID, timingSafeEqual } from "node:crypto";
import { decryptSecret, encryptSecret, maskSecret, sha256 } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

const SESSION_COOKIE = "uchiha_builder_session";
const PRODUCT_KEY = "ai-chatbot";
const COMPONENT_KEY = "ai_chatbot";
const MODES = new Set(["general", "coding", "study", "image"]);
const MODE_LABELS = Object.freeze({
  general: "💬 محادثة عامة",
  coding: "💻 البرمجة",
  study: "📚 التعليم والدراسة",
  image: "🎨 إنشاء صور"
});
const MODE_INSTRUCTIONS = Object.freeze({
  general: "أجب كمساعد عام واضح ودقيق. استخدم لغة المستخدم ونظّم الإجابة بدون حشو.",
  coding: "أنت مساعد برمجي عملي. افهم المطلوب، ثم قدّم حلاً صحيحاً وآمناً وقابلاً للتطبيق. لا تدّع تنفيذ أدوات لم تنفذها.",
  study: "أنت مساعد للتعليم والدراسة. اشرح ببساطة وبخطوات مرتبة واستخدم أمثلة قصيرة عندما تفيد.",
  image: "حوّل وصف المستخدم إلى طلب صورة واضح ومخلص لقصده."
});

class AiBotProductError extends Error {
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
  if (!result) throw new AiBotProductError(422, "missing_field", `الحقل ${field} مطلوب`);
  return result;
}

function integer(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, field = "القيمة" } = {}) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AiBotProductError(422, "invalid_number", `${field} غير صالح`);
  }
  return parsed;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function telegramUserId(value, { nullable = false } = {}) {
  const result = text(value, 24);
  if (!result && nullable) return null;
  if (!/^\d{5,20}$/.test(result)) {
    throw new AiBotProductError(422, "invalid_telegram_user_id", "معرف Telegram الرقمي غير صالح");
  }
  return result;
}

function safeSubscribeUrl(value) {
  const candidate = text(value, 1200);
  if (!candidate) return null;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new AiBotProductError(422, "invalid_subscribe_url", "رابط الاشتراك غير صالح");
  }
  if (!["https:", "tg:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new AiBotProductError(422, "invalid_subscribe_url", "رابط الاشتراك يجب أن يكون HTTPS أو Telegram");
  }
  return parsed.toString();
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

async function authenticate(db, request) {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) throw new AiBotProductError(401, "authentication_required", "يجب تسجيل الدخول");
  const result = await db.query(
    `SELECT u.*, s.csrf_hash
     FROM sessions s
     JOIN platform_users u ON u.id=s.user_id
     WHERE s.token_hash=$1
       AND s.revoked_at IS NULL
       AND s.expires_at>NOW()
       AND u.status='active'`,
    [sha256(token)]
  );
  const user = result.rows[0];
  if (!user) throw new AiBotProductError(401, "invalid_session", "انتهت الجلسة أو ألغيت");
  return user;
}

function requireCsrf(request, user) {
  const token = request.headers["x-csrf-token"];
  if (!token || sha256(token) !== user.csrf_hash) {
    throw new AiBotProductError(403, "csrf_failed", "تعذر التحقق من الطلب");
  }
}

function requirePlatformAdmin(user) {
  if (!user.is_platform_admin) {
    throw new AiBotProductError(403, "platform_admin_required", "هذه العملية متاحة لمدير المنصة فقط");
  }
}

async function productRow(db) {
  try {
    return (
      await db.query(
        `SELECT id, service_key, slug, name_ar, name_en, description_ar, description_en,
                features_ar, features_en, starting_price_minor, currency, status,
                product_image_url, is_catalog_product
         FROM platform_services
         WHERE service_key=$1 AND tenant_id IS NULL AND store_id IS NULL
         LIMIT 1`,
        [PRODUCT_KEY]
      )
    ).rows[0] || null;
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "42703") return null;
    throw error;
  }
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

function productDto(row, config) {
  if (!row) {
    return {
      key: PRODUCT_KEY,
      available: false,
      priceConfigured: false,
      providerReady: Boolean(config.openAiApiKey)
    };
  }
  return {
    id: row.id,
    key: row.service_key,
    slug: row.slug,
    name: row.name_ar,
    description: row.description_ar,
    features: jsonValue(row.features_ar, []),
    priceMinor: row.starting_price_minor === null ? null : Number(row.starting_price_minor),
    currency: row.currency,
    status: row.status,
    imageUrl: row.product_image_url || "/assets/catalog-assets/ai-chatbot.svg",
    available: row.status === "active" && Boolean(row.is_catalog_product),
    priceConfigured: Number(row.starting_price_minor || 0) > 0,
    providerReady: Boolean(config.openAiApiKey)
  };
}

function modelDto(row, { includeProvider = false } = {}) {
  const result = {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    accessLevel: row.access_level,
    enabled: Boolean(row.enabled),
    sortOrder: Number(row.sort_order || 0),
    intelligenceLabel: row.intelligence_label,
    analysisLabel: row.analysis_label,
    imageQualityLabel: row.image_quality_label,
    codingLabel: row.coding_label,
    educationLabel: row.education_label,
    imageEnabled: Boolean(row.image_enabled),
    maxOutputTokens: Number(row.max_output_tokens || 1200)
  };
  if (includeProvider) {
    result.providerModel = row.provider_model;
    result.reasoningEffort = row.reasoning_effort;
    result.imageModel = row.image_model;
    result.imageQuality = row.image_quality;
  }
  return result;
}

function instanceDto(row, models = []) {
  return {
    id: row.id,
    orderId: row.order_id,
    projectId: row.project_id || null,
    displayName: row.display_name,
    telegramBotId: row.telegram_bot_id || null,
    telegramUsername: row.telegram_username || null,
    telegramUrl: row.telegram_username ? `https://t.me/${row.telegram_username}` : null,
    tokenMasked: row.token_masked || null,
    ownerTelegramId: row.owner_telegram_id || "",
    proSubscribeUrl: row.pro_subscribe_url || "",
    welcomeText: row.welcome_text,
    status: row.status,
    lastError: row.last_error || null,
    lastCheckedAt: row.last_checked_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    models
  };
}

async function requireInstance(db, user, instanceId) {
  const row = (
    await db.query("SELECT * FROM ai_bot_instances WHERE id=$1 AND user_id=$2", [instanceId, user.id])
  ).rows[0];
  if (!row) throw new AiBotProductError(404, "ai_bot_not_found", "بوت الذكاء الاصطناعي غير موجود");
  return row;
}

async function instanceModels(db, instanceId, { includeProvider = false } = {}) {
  const result = await db.query(
    `SELECT * FROM ai_bot_model_profiles
     WHERE instance_id=$1 ORDER BY sort_order, created_at`,
    [instanceId]
  );
  return result.rows.map((row) => modelDto(row, { includeProvider }));
}

async function seedDefaultModels(client, instanceId, config) {
  const profiles = [
    {
      slug: "uchiha-v1",
      displayName: "UCHIHA AI V1",
      providerModel: config.openAiFreeModel || "gpt-5.6-luna",
      accessLevel: "free",
      sortOrder: 10,
      intelligence: "منخفض",
      analysis: "محدود",
      imageLabel: "محدود",
      coding: "أساسي",
      education: "جيد",
      maxTokens: 900,
      reasoning: "low",
      imageQuality: "low",
      systemPrompt: "أنت UCHIHA AI V1، مساعد سريع وخفيف. اجعل إجاباتك مباشرة ومفيدة."
    },
    {
      slug: "uchiha-v2",
      displayName: "UCHIHA AI V2",
      providerModel: config.openAiProModel || "gpt-5.6-sol",
      accessLevel: "pro",
      sortOrder: 20,
      intelligence: "عالي",
      analysis: "عالي",
      imageLabel: "احترافي للغاية",
      coding: "وكيل برمجي ممتاز",
      education: "متقدم",
      maxTokens: 3200,
      reasoning: "high",
      imageQuality: "high",
      systemPrompt: "أنت UCHIHA AI V2 PRO، مساعد متقدم للتحليل والبرمجة والدراسة والإبداع. أعط أفضل إجابة عملية ممكنة."
    }
  ];
  for (const profile of profiles) {
    await client.query(
      `INSERT INTO ai_bot_model_profiles (
         id, instance_id, slug, display_name, provider_model, access_level,
         enabled, sort_order, intelligence_label, analysis_label,
         image_quality_label, coding_label, education_label, max_output_tokens,
         reasoning_effort, image_enabled, image_model, image_quality, system_prompt
       ) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,$15,$16,$17)`,
      [
        randomUUID(), instanceId, profile.slug, profile.displayName, profile.providerModel,
        profile.accessLevel, profile.sortOrder, profile.intelligence, profile.analysis,
        profile.imageLabel, profile.coding, profile.education, profile.maxTokens,
        profile.reasoning, config.openAiImageModel || "gpt-image-2", profile.imageQuality,
        profile.systemPrompt
      ]
    );
  }
}

async function openAiJson(config, path, payload) {
  if (!config.openAiApiKey) {
    throw new AiBotProductError(503, "openai_not_configured", "خدمة الذكاء الاصطناعي غير مهيأة حاليًا");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${config.openAiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.openAiApiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerMessage = text(data?.error?.message, 500) || `OpenAI HTTP ${response.status}`;
      const error = new AiBotProductError(502, "openai_request_failed", "تعذر الحصول على رد الذكاء الاصطناعي");
      error.providerMessage = providerMessage;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function responseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

async function generateText(config, profile, user, prompt) {
  const payload = {
    model: profile.provider_model,
    instructions: [profile.system_prompt, MODE_INSTRUCTIONS[user.active_mode] || MODE_INSTRUCTIONS.general]
      .filter(Boolean)
      .join("\n\n"),
    input: prompt,
    max_output_tokens: Number(profile.max_output_tokens || 1200),
    reasoning: { effort: profile.reasoning_effort || "low" }
  };
  if (user.previous_response_id) payload.previous_response_id = user.previous_response_id;
  const data = await openAiJson(config, "/responses", payload);
  const output = responseText(data);
  if (!output) throw new AiBotProductError(502, "openai_empty_response", "وصل رد فارغ من خدمة الذكاء الاصطناعي");
  return {
    id: text(data.id, 200) || null,
    text: output,
    usage: {
      input: Number(data?.usage?.input_tokens || 0),
      output: Number(data?.usage?.output_tokens || 0),
      total: Number(data?.usage?.total_tokens || 0)
    }
  };
}

async function generateImage(config, profile, prompt) {
  if (!profile.image_enabled) {
    throw new AiBotProductError(422, "image_disabled", "إنشاء الصور غير مفعل في هذا النموذج");
  }
  const data = await openAiJson(config, "/images/generations", {
    model: profile.image_model || config.openAiImageModel || "gpt-image-2",
    prompt,
    size: "1024x1024",
    quality: profile.image_quality || "low",
    output_format: "png"
  });
  const base64 = data?.data?.[0]?.b64_json;
  if (!base64 || typeof base64 !== "string") {
    throw new AiBotProductError(502, "openai_image_empty", "لم تصل صورة صالحة من خدمة الذكاء الاصطناعي");
  }
  return { base64, model: profile.image_model || config.openAiImageModel || "gpt-image-2" };
}

async function telegramJson(config, token, method, payload = {}) {
  if (config.telegramMode === "fake") return { ok: true, simulated: true, method, payload };
  return new TelegramGateway(config).request(token, method, payload);
}

async function telegramPhoto(config, token, chatId, base64, caption = "") {
  if (config.telegramMode === "fake") return { ok: true, simulated: true };
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption.slice(0, 900));
  form.append("photo", new Blob([Buffer.from(base64, "base64")], { type: "image/png" }), "uchiha-ai.png");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      body: form,
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.description || `Telegram HTTP ${response.status}`);
    return data.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendLong(config, token, chatId, message, extra = {}) {
  let remaining = String(message || "");
  while (remaining) {
    let chunk = remaining.slice(0, 3900);
    if (remaining.length > 3900) {
      const split = Math.max(chunk.lastIndexOf("\n"), chunk.lastIndexOf(" "));
      if (split > 2500) chunk = remaining.slice(0, split);
    }
    await telegramJson(config, token, "sendMessage", { chat_id: chatId, text: chunk, ...extra });
    remaining = remaining.slice(chunk.length).trimStart();
  }
}

async function upsertEndUser(db, instanceId, from) {
  const telegramId = String(from.id);
  const fullName = text([from.first_name, from.last_name].filter(Boolean).join(" "), 180);
  await db.query(
    `INSERT INTO ai_bot_end_users (
       instance_id, telegram_user_id, username, full_name
     ) VALUES ($1,$2,$3,$4)
     ON CONFLICT (instance_id, telegram_user_id) DO UPDATE SET
       username=EXCLUDED.username, full_name=EXCLUDED.full_name, last_seen_at=NOW()`,
    [instanceId, telegramId, text(from.username, 80) || null, fullName]
  );
  return (
    await db.query(
      "SELECT * FROM ai_bot_end_users WHERE instance_id=$1 AND telegram_user_id=$2",
      [instanceId, telegramId]
    )
  ).rows[0];
}

function hasPro(user) {
  return Boolean(user?.pro_until && new Date(user.pro_until).getTime() > Date.now());
}

async function activeProfiles(db, instanceId) {
  return (
    await db.query(
      `SELECT * FROM ai_bot_model_profiles
       WHERE instance_id=$1 AND enabled=TRUE ORDER BY sort_order, created_at`,
      [instanceId]
    )
  ).rows;
}

async function resolveActiveProfile(db, instanceId, user) {
  let profile = (
    await db.query(
      `SELECT * FROM ai_bot_model_profiles
       WHERE instance_id=$1 AND slug=$2 AND enabled=TRUE`,
      [instanceId, user.active_model_slug]
    )
  ).rows[0];
  if (!profile || (profile.access_level === "pro" && !hasPro(user))) {
    profile = (
      await db.query(
        `SELECT * FROM ai_bot_model_profiles
         WHERE instance_id=$1 AND enabled=TRUE AND access_level='free'
         ORDER BY sort_order, created_at LIMIT 1`,
        [instanceId]
      )
    ).rows[0];
    if (!profile) throw new AiBotProductError(503, "free_model_missing", "لا يوجد نموذج مجاني متاح حاليًا");
    await db.query(
      `UPDATE ai_bot_end_users
       SET active_model_slug=$3, active_mode='general', previous_response_id=NULL, last_seen_at=NOW()
       WHERE instance_id=$1 AND telegram_user_id=$2`,
      [instanceId, user.telegram_user_id, profile.slug]
    );
    user.active_model_slug = profile.slug;
    user.active_mode = "general";
    user.previous_response_id = null;
  }
  return profile;
}

function homeKeyboard(models, pro) {
  const rows = [[{ text: "🟡 PRO", callback_data: "ai:pro" }]];
  for (const model of models) {
    rows.push([
      {
        text:
          model.access_level === "free"
            ? `🔵 ${model.display_name} · مجاني`
            : pro
              ? `⭐ ${model.display_name} · PRO`
              : `🔒 ${model.display_name} · PRO`,
        callback_data: `ai:model:${model.slug}`
      }
    ]);
  }
  rows.push([
    { text: "👤 حسابي", callback_data: "ai:account" },
    { text: "🧹 محادثة جديدة", callback_data: "ai:clear" }
  ]);
  return { inline_keyboard: rows };
}

function modelDescription(profile, locked) {
  return [
    `🤖 ${profile.display_name}`,
    "",
    locked ? "🔒 هذا النموذج متاح لمشتركي PRO فقط." : "✅ النموذج متاح لك الآن.",
    "",
    `🧠 مستوى الذكاء: ${profile.intelligence_label}`,
    `🔎 التحليل: ${profile.analysis_label}`,
    `🎨 إنشاء الصور: ${profile.image_quality_label}`,
    `💻 البرمجة: ${profile.coding_label}`,
    `📚 التعليم: ${profile.education_label}`,
    "",
    locked ? "اشترك في PRO لفتح هذا النموذج." : "اختر طريقة الاستخدام:"
  ].join("\n");
}

function modelKeyboard(profile, locked) {
  if (locked) {
    return {
      inline_keyboard: [
        [{ text: "⭐ اشترك PRO", callback_data: "ai:pro" }],
        [{ text: "↩️ رجوع", callback_data: "ai:home" }]
      ]
    };
  }
  return {
    inline_keyboard: [
      [
        { text: "💻 البرمجة", callback_data: `ai:mode:${profile.slug}:coding` },
        { text: "📚 التعليم والدراسة", callback_data: `ai:mode:${profile.slug}:study` }
      ],
      [
        { text: "🎨 إنشاء صور", callback_data: `ai:mode:${profile.slug}:image` },
        { text: "💬 محادثة عامة", callback_data: `ai:mode:${profile.slug}:general` }
      ],
      [{ text: "↩️ رجوع", callback_data: "ai:home" }]
    ]
  };
}

async function sendHome(db, config, instance, token, chatId, user, { editMessageId = null } = {}) {
  const models = await activeProfiles(db, instance.id);
  const pro = hasPro(user);
  const content = [
    `🤖 ${instance.display_name}`,
    "",
    instance.welcome_text || "اختر نموذج الذكاء الاصطناعي.",
    "",
    pro ? "⭐ حسابك PRO مفعّل" : "🆓 حسابك على الخطة المجانية",
    "اختر النموذج:"
  ].join("\n");
  const payload = { chat_id: chatId, text: content, reply_markup: homeKeyboard(models, pro) };
  if (editMessageId) {
    try {
      await telegramJson(config, token, "editMessageText", { ...payload, message_id: editMessageId });
      return;
    } catch {
      // A stale Telegram message should not prevent the user from opening the current home screen.
    }
  }
  await telegramJson(config, token, "sendMessage", payload);
}

async function answerCallback(config, token, callbackId, textValue = "") {
  if (!callbackId) return;
  await telegramJson(config, token, "answerCallbackQuery", {
    callback_query_id: callbackId,
    ...(textValue ? { text: textValue.slice(0, 180) } : {})
  }).catch(() => undefined);
}

async function editOrSend(config, token, callback, chatId, messageText, keyboard) {
  const messageId = callback?.message?.message_id;
  if (messageId) {
    try {
      await telegramJson(config, token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: messageText,
        reply_markup: keyboard
      });
      return;
    } catch {
      // Fall through to a fresh message if Telegram no longer allows editing it.
    }
  }
  await telegramJson(config, token, "sendMessage", {
    chat_id: chatId,
    text: messageText,
    reply_markup: keyboard
  });
}

async function usageSummary(db, instanceId, telegramId) {
  const row = (
    await db.query(
      `SELECT COUNT(*)::int AS requests,
              COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,
              COALESCE(SUM(output_tokens),0)::bigint AS output_tokens
       FROM ai_bot_usage WHERE instance_id=$1 AND telegram_user_id=$2`,
      [instanceId, telegramId]
    )
  ).rows[0] || {};
  return {
    requests: Number(row.requests || 0),
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0)
  };
}

async function handleOwnerAdmin(db, config, instance, token, chatId) {
  const [stats, models] = await Promise.all([
    db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM ai_bot_end_users WHERE instance_id=$1) AS users,
         (SELECT COUNT(*)::int FROM ai_bot_end_users WHERE instance_id=$1 AND pro_until>NOW()) AS pro_users,
         (SELECT COUNT(*)::int FROM ai_bot_usage WHERE instance_id=$1 AND created_at>=CURRENT_DATE) AS requests_today`,
      [instance.id]
    ),
    activeProfiles(db, instance.id)
  ]);
  const row = stats.rows[0] || {};
  const modelLines = models.map((model) => `• ${model.display_name} — ${model.access_level.toUpperCase()}`).join("\n");
  const manageUrl = `${config.appBaseUrl}/products/ai-chatbot?instance=${encodeURIComponent(instance.id)}`;
  await telegramJson(config, token, "sendMessage", {
    chat_id: chatId,
    text: [
      `⚙️ إدارة ${instance.display_name}`,
      "",
      `👥 المستخدمون: ${Number(row.users || 0)}`,
      `⭐ مشتركو PRO: ${Number(row.pro_users || 0)}`,
      `💬 طلبات اليوم: ${Number(row.requests_today || 0)}`,
      "",
      "🤖 النماذج:",
      modelLines || "لا توجد نماذج مفعلة."
    ].join("\n"),
    reply_markup: {
      inline_keyboard: [
        [{ text: "🖥 لوحة الإدارة الكاملة", url: manageUrl }],
        [{ text: "🧠 فوترة OpenAI", url: config.openAiBillingUrl }]
      ]
    }
  });
}

async function handleCallback(db, config, instance, token, callback, user) {
  const chatId = callback?.message?.chat?.id;
  if (!chatId) return;
  const data = String(callback.data || "");
  await answerCallback(config, token, callback.id);

  if (data === "ai:home") {
    await sendHome(db, config, instance, token, chatId, user, { editMessageId: callback.message?.message_id });
    return;
  }
  if (data === "ai:clear") {
    await db.query(
      `UPDATE ai_bot_end_users SET previous_response_id=NULL, active_mode='general', last_seen_at=NOW()
       WHERE instance_id=$1 AND telegram_user_id=$2`,
      [instance.id, user.telegram_user_id]
    );
    user.previous_response_id = null;
    user.active_mode = "general";
    await answerCallback(config, token, callback.id, "تم بدء محادثة جديدة ✅");
    await sendHome(db, config, instance, token, chatId, user, { editMessageId: callback.message?.message_id });
    return;
  }
  if (data === "ai:account") {
    const usage = await usageSummary(db, instance.id, user.telegram_user_id);
    const profile = await resolveActiveProfile(db, instance.id, user);
    const until = hasPro(user) ? new Date(user.pro_until).toISOString().slice(0, 10) : "—";
    await editOrSend(
      config,
      token,
      callback,
      chatId,
      [
        "👤 حسابي",
        "",
        `🆔 ${user.telegram_user_id}`,
        `⭐ الخطة: ${hasPro(user) ? "PRO" : "مجاني"}`,
        `📅 PRO حتى: ${until}`,
        `🤖 النموذج الحالي: ${profile.display_name}`,
        `💬 الطلبات: ${usage.requests}`,
        `🧠 Tokens داخلة: ${usage.inputTokens}`,
        `📝 Tokens خارجة: ${usage.outputTokens}`
      ].join("\n"),
      { inline_keyboard: [[{ text: "↩️ رجوع", callback_data: "ai:home" }]] }
    );
    return;
  }
  if (data === "ai:pro") {
    if (hasPro(user)) {
      await editOrSend(
        config,
        token,
        callback,
        chatId,
        `⭐ اشتراك PRO مفعّل حتى ${new Date(user.pro_until).toISOString().slice(0, 10)}.`,
        { inline_keyboard: [[{ text: "↩️ رجوع", callback_data: "ai:home" }]] }
      );
      return;
    }
    const proModels = (await activeProfiles(db, instance.id)).filter((model) => model.access_level === "pro");
    const lines = proModels.map((model) => `• ${model.display_name}: ${model.intelligence_label} / ${model.analysis_label}`).join("\n");
    const rows = [];
    if (instance.pro_subscribe_url) rows.push([{ text: "💳 اشترك الآن", url: instance.pro_subscribe_url }]);
    rows.push([{ text: "↩️ رجوع", callback_data: "ai:home" }]);
    await editOrSend(
      config,
      token,
      callback,
      chatId,
      [
        "🟡 UCHIHA AI PRO",
        "",
        lines || "نماذج PRO المتقدمة.",
        "",
        "🔥 ذكاء وتحليل أعلى",
        "🎨 إنشاء صور بجودة أعلى",
        "💻 برمجة متقدمة",
        instance.pro_subscribe_url ? "اضغط اشتراك للمتابعة." : "تواصل مع إدارة البوت لتفعيل الاشتراك."
      ].join("\n"),
      { inline_keyboard: rows }
    );
    return;
  }
  if (data.startsWith("ai:model:")) {
    const slug = text(data.slice("ai:model:".length), 80);
    const profile = (
      await db.query(
        `SELECT * FROM ai_bot_model_profiles
         WHERE instance_id=$1 AND slug=$2 AND enabled=TRUE`,
        [instance.id, slug]
      )
    ).rows[0];
    if (!profile) {
      await answerCallback(config, token, callback.id, "هذا النموذج غير متاح حاليًا.");
      return;
    }
    const locked = profile.access_level === "pro" && !hasPro(user);
    if (!locked) {
      await db.query(
        `UPDATE ai_bot_end_users
         SET active_model_slug=$3, previous_response_id=NULL, last_seen_at=NOW()
         WHERE instance_id=$1 AND telegram_user_id=$2`,
        [instance.id, user.telegram_user_id, profile.slug]
      );
    }
    await editOrSend(config, token, callback, chatId, modelDescription(profile, locked), modelKeyboard(profile, locked));
    return;
  }
  if (data.startsWith("ai:mode:")) {
    const [, , slug, mode] = data.split(":");
    if (!MODES.has(mode)) return;
    const profile = (
      await db.query(
        `SELECT * FROM ai_bot_model_profiles
         WHERE instance_id=$1 AND slug=$2 AND enabled=TRUE`,
        [instance.id, slug]
      )
    ).rows[0];
    if (!profile || (profile.access_level === "pro" && !hasPro(user))) {
      await answerCallback(config, token, callback.id, "هذا النموذج يحتاج اشتراك PRO.");
      return;
    }
    if (mode === "image" && !profile.image_enabled) {
      await answerCallback(config, token, callback.id, "إنشاء الصور غير متاح في هذا النموذج.");
      return;
    }
    await db.query(
      `UPDATE ai_bot_end_users
       SET active_model_slug=$3, active_mode=$4, previous_response_id=NULL, last_seen_at=NOW()
       WHERE instance_id=$1 AND telegram_user_id=$2`,
      [instance.id, user.telegram_user_id, profile.slug, mode]
    );
    await editOrSend(
      config,
      token,
      callback,
      chatId,
      [
        `✅ تم اختيار ${profile.display_name}`,
        `الوضع: ${MODE_LABELS[mode]}`,
        "",
        mode === "image" ? "🎨 أرسل الآن وصف الصورة التي تريدها." : "✍️ أرسل رسالتك الآن."
      ].join("\n"),
      {
        inline_keyboard: [
          [{ text: "🔁 تغيير الاستخدام", callback_data: `ai:model:${profile.slug}` }],
          [{ text: "🏠 الرئيسية", callback_data: "ai:home" }]
        ]
      }
    );
  }
}

async function recordUsage(db, instanceId, telegramId, profile, kind, data = {}, status = "completed", errorCode = null) {
  await db.query(
    `INSERT INTO ai_bot_usage (
       id, instance_id, telegram_user_id, model_profile_id, provider_model,
       request_kind, input_tokens, output_tokens, total_tokens,
       provider_response_id, status, error_code
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      randomUUID(), instanceId, telegramId, profile?.id || null,
      profile?.provider_model || "unknown", kind,
      Number(data.input || 0), Number(data.output || 0), Number(data.total || 0),
      data.responseId || null, status, errorCode
    ]
  );
}

async function handleUserPrompt(db, config, instance, token, chatId, user, prompt) {
  const profile = await resolveActiveProfile(db, instance.id, user);
  try {
    if (user.active_mode === "image") {
      await telegramJson(config, token, "sendChatAction", { chat_id: chatId, action: "upload_photo" }).catch(() => undefined);
      const image = await generateImage(config, profile, prompt);
      await telegramPhoto(config, token, chatId, image.base64, `🎨 ${profile.display_name}`);
      await recordUsage(db, instance.id, user.telegram_user_id, profile, "image", {}, "completed", null);
      return;
    }
    await telegramJson(config, token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
    const answer = await generateText(config, profile, user, prompt);
    await db.query(
      `UPDATE ai_bot_end_users
       SET previous_response_id=$3, last_seen_at=NOW()
       WHERE instance_id=$1 AND telegram_user_id=$2`,
      [instance.id, user.telegram_user_id, answer.id]
    );
    await recordUsage(
      db,
      instance.id,
      user.telegram_user_id,
      profile,
      "chat",
      { ...answer.usage, responseId: answer.id },
      "completed",
      null
    );
    await sendLong(config, token, chatId, answer.text, {
      reply_markup: { inline_keyboard: [[{ text: "🏠 النماذج", callback_data: "ai:home" }]] }
    });
  } catch (error) {
    await recordUsage(
      db,
      instance.id,
      user.telegram_user_id,
      profile,
      user.active_mode === "image" ? "image" : "chat",
      {},
      "failed",
      text(error.code || "request_failed", 100)
    ).catch(() => undefined);
    const message = error instanceof AiBotProductError
      ? error.message
      : "حدث خطأ مؤقت أثناء معالجة الطلب. حاول مرة أخرى.";
    await sendLong(config, token, chatId, `⚠️ ${message}`);
  }
}

async function processTelegramUpdate(db, config, instance, update) {
  const token = decryptSecret(instance.token_ciphertext, config.encryptionKey);
  const callback = update?.callback_query;
  const message = update?.message;
  const from = callback?.from || message?.from;
  const chatId = callback?.message?.chat?.id || message?.chat?.id;
  if (!from?.id || !chatId) return;
  const user = await upsertEndUser(db, instance.id, from);
  if (user.is_banned) {
    if (callback) await answerCallback(config, token, callback.id, "تم إيقاف حسابك عن استخدام هذا البوت.");
    else await sendLong(config, token, chatId, "🚫 تم إيقاف حسابك عن استخدام هذا البوت.");
    return;
  }
  if (callback) {
    await handleCallback(db, config, instance, token, callback, user);
    return;
  }
  const messageText = text(message?.text, 12000);
  if (!messageText) return;
  if (messageText.startsWith("/start")) {
    await sendHome(db, config, instance, token, chatId, user);
    return;
  }
  if (messageText === "/admin") {
    if (instance.owner_telegram_id && String(from.id) === String(instance.owner_telegram_id)) {
      await handleOwnerAdmin(db, config, instance, token, chatId);
    } else {
      await sendLong(config, token, chatId, "هذا الأمر مخصص لمالك البوت.");
    }
    return;
  }
  if (messageText.startsWith("/")) {
    await sendHome(db, config, instance, token, chatId, user);
    return;
  }
  await handleUserPrompt(db, config, instance, token, chatId, user, messageText);
}

async function dashboardForInstance(db, instanceId) {
  const [stats, users] = await Promise.all([
    db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM ai_bot_end_users WHERE instance_id=$1) AS users,
         (SELECT COUNT(*)::int FROM ai_bot_end_users WHERE instance_id=$1 AND pro_until>NOW()) AS pro_users,
         (SELECT COUNT(*)::int FROM ai_bot_end_users WHERE instance_id=$1 AND is_banned=TRUE) AS banned_users,
         (SELECT COUNT(*)::int FROM ai_bot_usage WHERE instance_id=$1) AS requests,
         (SELECT COUNT(*)::int FROM ai_bot_usage WHERE instance_id=$1 AND created_at>=CURRENT_DATE) AS requests_today,
         (SELECT COALESCE(SUM(input_tokens),0)::bigint FROM ai_bot_usage WHERE instance_id=$1) AS input_tokens,
         (SELECT COALESCE(SUM(output_tokens),0)::bigint FROM ai_bot_usage WHERE instance_id=$1) AS output_tokens`,
      [instanceId]
    ),
    db.query(
      `SELECT u.*,
              (SELECT COUNT(*)::int FROM ai_bot_usage x
               WHERE x.instance_id=u.instance_id AND x.telegram_user_id=u.telegram_user_id) AS request_count
       FROM ai_bot_end_users u
       WHERE u.instance_id=$1
       ORDER BY u.last_seen_at DESC LIMIT 80`,
      [instanceId]
    )
  ]);
  const row = stats.rows[0] || {};
  return {
    stats: {
      users: Number(row.users || 0),
      proUsers: Number(row.pro_users || 0),
      bannedUsers: Number(row.banned_users || 0),
      requests: Number(row.requests || 0),
      requestsToday: Number(row.requests_today || 0),
      inputTokens: Number(row.input_tokens || 0),
      outputTokens: Number(row.output_tokens || 0)
    },
    users: users.rows.map((user) => ({
      telegramUserId: user.telegram_user_id,
      username: user.username || "",
      fullName: user.full_name,
      isPro: hasPro(user),
      proUntil: user.pro_until || null,
      isBanned: Boolean(user.is_banned),
      activeModelSlug: user.active_model_slug,
      activeMode: user.active_mode,
      requestCount: Number(user.request_count || 0),
      firstSeenAt: user.first_seen_at,
      lastSeenAt: user.last_seen_at
    }))
  };
}

function route(handler) {
  return async (request, reply) => handler(request, reply);
}

export function installAiBotProductRoutes(app, { db, config }) {
  app.get("/products/ai-chatbot", async (_request, reply) => reply.sendFile("ai-bot-product.html"));

  app.get(
    "/api/public/products/ai-chatbot",
    route(async () => ({ product: productDto(await productRow(db), config) }))
  );

  app.get(
    "/api/platform/ai-bots",
    route(async (request) => {
      const user = await authenticate(db, request);
      const [product, wallet, instances] = await Promise.all([
        productRow(db),
        db.query("SELECT * FROM platform_account_wallets WHERE user_id=$1", [user.id]),
        db.query("SELECT * FROM ai_bot_instances WHERE user_id=$1 ORDER BY created_at DESC", [user.id])
      ]);
      const rows = [];
      for (const instance of instances.rows) {
        rows.push(instanceDto(instance, await instanceModels(db, instance.id)));
      }
      const walletRow = wallet.rows[0];
      return {
        product: productDto(product, config),
        wallet: walletRow
          ? {
              currency: walletRow.currency,
              balanceMinor: Number(walletRow.balance_minor || 0),
              heldMinor: Number(walletRow.held_minor || 0),
              availableMinor: Math.max(0, Number(walletRow.balance_minor || 0) - Number(walletRow.held_minor || 0))
            }
          : { currency: "USD", balanceMinor: 0, heldMinor: 0, availableMinor: 0 },
        instances: rows
      };
    })
  );

  app.get(
    "/api/platform/ai-bots/:instanceId",
    route(async (request) => {
      const user = await authenticate(db, request);
      const instance = await requireInstance(db, user, request.params.instanceId);
      const [models, dashboard] = await Promise.all([
        instanceModels(db, instance.id),
        dashboardForInstance(db, instance.id)
      ]);
      return {
        instance: instanceDto(instance, models),
        dashboard,
        openAi: {
          configured: Boolean(config.openAiApiKey),
          billingUrl: config.openAiBillingUrl
        }
      };
    })
  );

  app.post(
    "/api/platform/ai-bots/purchase",
    route(async (request, reply) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      if (!config.openAiApiKey) {
        throw new AiBotProductError(503, "openai_not_configured", "لا يمكن بيع البوت قبل ربط OpenAI المركزي من إدارة المنصة");
      }
      const idempotencyKey = requiredText(request.headers["idempotency-key"], "مفتاح العملية", 160);
      const product = await productRow(db);
      if (!product || product.status !== "active" || !product.is_catalog_product) {
        throw new AiBotProductError(404, "product_unavailable", "منتج بوت الذكاء الاصطناعي غير متاح حاليًا");
      }
      const amountMinor = Number(product.starting_price_minor || 0);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        throw new AiBotProductError(409, "product_price_not_configured", "يجب أن يحدد مدير المنصة سعر البوت قبل البيع");
      }
      const displayName = text(request.body?.displayName, 120) || "UCHIHA AI";
      const requestHash = sha256(JSON.stringify({ userId: user.id, serviceId: product.id, amountMinor, currency: product.currency, displayName }));
      const previous = (
        await db.query(
          `SELECT o.*, i.id AS instance_id
           FROM platform_catalog_orders o
           LEFT JOIN ai_bot_instances i ON i.order_id=o.id
           WHERE o.user_id=$1 AND o.idempotency_key=$2`,
          [user.id, idempotencyKey]
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) {
          throw new AiBotProductError(409, "idempotency_conflict", "استخدم مفتاح عملية جديدًا عند تغيير بيانات الشراء");
        }
        return { duplicate: true, orderId: previous.id, instanceId: previous.instance_id };
      }

      const orderId = randomUUID();
      const projectId = randomUUID();
      const componentId = randomUUID();
      const instanceId = randomUUID();
      await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO platform_account_wallets (user_id, currency)
           VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING`,
          [user.id, product.currency]
        );
        const wallet = (
          await client.query("SELECT * FROM platform_account_wallets WHERE user_id=$1 FOR UPDATE", [user.id])
        ).rows[0];
        if (!wallet) throw new AiBotProductError(409, "wallet_unavailable", "محفظة الحساب غير متاحة");
        if (wallet.currency !== product.currency) {
          throw new AiBotProductError(409, "wallet_currency_mismatch", "عملة المحفظة لا تطابق عملة المنتج");
        }
        const available = Number(wallet.balance_minor || 0) - Number(wallet.held_minor || 0);
        if (available < amountMinor) {
          throw new AiBotProductError(402, "insufficient_balance", "رصيد حساب UCHIHA غير كافٍ لشراء البوت");
        }
        const nextBalance = Number(wallet.balance_minor) - amountMinor;
        await client.query(
          "UPDATE platform_account_wallets SET balance_minor=$2, updated_at=NOW() WHERE user_id=$1",
          [user.id, nextBalance]
        );
        await client.query(
          `INSERT INTO platform_account_ledger (
             id, user_id, entry_type, amount_minor, balance_after_minor,
             currency, reference_type, reference_id, description, metadata
           ) VALUES ($1,$2,'purchase',$3,$4,$5,'platform_catalog_order',$6,$7,$8)`,
          [
            randomUUID(), user.id, -amountMinor, nextBalance, product.currency, orderId,
            `شراء ${product.name_ar}`, JSON.stringify({ serviceKey: PRODUCT_KEY })
          ]
        );
        await client.query(
          `INSERT INTO platform_projects (
             id, user_id, name, project_type, status, source_channel, metadata
           ) VALUES ($1,$2,$3,'bot','configuring','web',$4)`,
          [projectId, user.id, displayName, JSON.stringify({ productKey: PRODUCT_KEY, aiBotInstanceId: instanceId })]
        );
        await client.query(
          `INSERT INTO project_components (
             id, project_id, service_key, status, configuration
           ) VALUES ($1,$2,$3,'pending_configuration',$4)`,
          [componentId, projectId, COMPONENT_KEY, JSON.stringify({ aiBotInstanceId: instanceId })]
        );
        await client.query(
          `INSERT INTO platform_catalog_orders (
             id, user_id, service_id, project_id, status, amount_minor,
             currency, configuration, idempotency_key, request_hash
           ) VALUES ($1,$2,$3,$4,'pending_configuration',$5,$6,$7,$8,$9)`,
          [
            orderId, user.id, product.id, projectId, amountMinor, product.currency,
            JSON.stringify({ displayName }), idempotencyKey, requestHash
          ]
        );
        await client.query(
          `INSERT INTO ai_bot_instances (
             id, order_id, project_id, user_id, service_id, display_name, status
           ) VALUES ($1,$2,$3,$4,$5,$6,'awaiting_token')`,
          [instanceId, orderId, projectId, user.id, product.id, displayName]
        );
        await seedDefaultModels(client, instanceId, config);
        await client.query(
          `INSERT INTO platform_account_notifications (
             id, user_id, notification_type, title, body, action_url
           ) VALUES ($1,$2,'product',$3,$4,$5)`,
          [
            randomUUID(), user.id, "تم شراء بوت الذكاء الاصطناعي",
            "أضف Telegram Bot Token الآن ليتم التحقق منه وتشغيل البوت.",
            `/products/ai-chatbot?instance=${instanceId}`
          ]
        );
      });
      reply.code(201);
      return { orderId, instanceId, status: "awaiting_token" };
    })
  );

  app.post(
    "/api/platform/ai-bots/:instanceId/token",
    route(async (request) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      const instance = await requireInstance(db, user, request.params.instanceId);
      const botToken = requiredText(request.body?.telegramBotToken, "Telegram Bot Token", 300);
      const gateway = new TelegramGateway(config, request.log);
      let botInfo;
      try {
        botInfo = await gateway.validateToken(botToken, "ai");
      } catch (error) {
        throw new AiBotProductError(422, "telegram_token_invalid", text(error.message, 500) || "Telegram Bot Token غير صالح");
      }
      const fingerprint = sha256(botToken);
      const duplicate = (
        await db.query(
          "SELECT id FROM ai_bot_instances WHERE token_fingerprint=$1 AND id<>$2",
          [fingerprint, instance.id]
        )
      ).rows[0];
      if (duplicate) throw new AiBotProductError(409, "telegram_bot_in_use", "هذا Telegram Bot مربوط بمنتج آخر");
      const displayName = text(request.body?.displayName, 120) || instance.display_name;
      const ownerTelegramId = telegramUserId(request.body?.ownerTelegramId, { nullable: true });
      const proSubscribeUrl = safeSubscribeUrl(request.body?.proSubscribeUrl);
      const welcomeText = text(request.body?.welcomeText, 600) || instance.welcome_text;
      const webhookSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
      if (config.telegramMode !== "fake") {
        if (!config.appBaseUrl?.startsWith("https://")) {
          throw new AiBotProductError(503, "public_https_required", "تشغيل Telegram Webhook يحتاج APP_BASE_URL عام عبر HTTPS");
        }
        try {
          await gateway.request(botToken, "setWebhook", {
            url: `${config.appBaseUrl}/webhooks/ai-bots/${instance.id}`,
            secret_token: webhookSecret,
            allowed_updates: ["message", "callback_query"],
            drop_pending_updates: false
          });
        } catch (error) {
          throw new AiBotProductError(502, "telegram_webhook_failed", text(error.message, 500) || "تعذر ربط Telegram Webhook");
        }
      }
      await db.transaction(async (client) => {
        await client.query(
          `UPDATE ai_bot_instances SET
             display_name=$2, telegram_bot_id=$3, telegram_username=$4,
             token_ciphertext=$5, token_fingerprint=$6, token_masked=$7,
             webhook_secret_ciphertext=$8, webhook_secret_hash=$9,
             owner_telegram_id=$10, pro_subscribe_url=$11, welcome_text=$12,
             status='active', last_error=NULL, last_checked_at=NOW(), updated_at=NOW()
           WHERE id=$1 AND user_id=$13`,
          [
            instance.id, displayName, String(botInfo.id), botInfo.username,
            encryptSecret(botToken, config.encryptionKey), fingerprint, maskSecret(botToken),
            encryptSecret(webhookSecret, config.encryptionKey), sha256(webhookSecret),
            ownerTelegramId, proSubscribeUrl, welcomeText, user.id
          ]
        );
        await client.query(
          "UPDATE platform_catalog_orders SET status='active', updated_at=NOW() WHERE id=$1 AND user_id=$2",
          [instance.order_id, user.id]
        );
        if (instance.project_id) {
          await client.query(
            "UPDATE platform_projects SET status='active', updated_at=NOW() WHERE id=$1 AND user_id=$2",
            [instance.project_id, user.id]
          );
          await client.query(
            `UPDATE project_components SET status='active', updated_at=NOW()
             WHERE project_id=$1 AND service_key=$2`,
            [instance.project_id, COMPONENT_KEY]
          );
        }
        await client.query(
          `INSERT INTO platform_account_notifications (
             id, user_id, notification_type, title, body, action_url
           ) VALUES ($1,$2,'product',$3,$4,$5)`,
          [
            randomUUID(), user.id, "بوت الذكاء الاصطناعي أصبح فعالًا",
            `@${botInfo.username} متصل الآن بخدمة UCHIHA AI المركزية.`,
            `/products/ai-chatbot?instance=${instance.id}`
          ]
        );
      });
      const updated = await requireInstance(db, user, instance.id);
      return { instance: instanceDto(updated, await instanceModels(db, instance.id)) };
    })
  );

  app.patch(
    "/api/platform/ai-bots/:instanceId",
    route(async (request) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      const instance = await requireInstance(db, user, request.params.instanceId);
      const displayName = text(request.body?.displayName, 120) || instance.display_name;
      const welcomeText = text(request.body?.welcomeText, 600) || instance.welcome_text;
      const ownerTelegramId = request.body?.ownerTelegramId === undefined
        ? instance.owner_telegram_id
        : telegramUserId(request.body.ownerTelegramId, { nullable: true });
      const proSubscribeUrl = request.body?.proSubscribeUrl === undefined
        ? instance.pro_subscribe_url
        : safeSubscribeUrl(request.body.proSubscribeUrl);
      const requestedStatus = text(request.body?.status, 30);
      let status = instance.status;
      if (requestedStatus) {
        if (!["active", "paused"].includes(requestedStatus)) {
          throw new AiBotProductError(422, "invalid_status", "يمكن فقط تشغيل البوت أو إيقافه مؤقتًا");
        }
        if (!instance.token_ciphertext) throw new AiBotProductError(409, "bot_token_required", "أضف Telegram Bot Token أولاً");
        status = requestedStatus;
      }
      await db.query(
        `UPDATE ai_bot_instances SET display_name=$2, welcome_text=$3,
           owner_telegram_id=$4, pro_subscribe_url=$5, status=$6, updated_at=NOW()
         WHERE id=$1 AND user_id=$7`,
        [instance.id, displayName, welcomeText, ownerTelegramId, proSubscribeUrl, status, user.id]
      );
      const updated = await requireInstance(db, user, instance.id);
      return { instance: instanceDto(updated, await instanceModels(db, instance.id)) };
    })
  );

  app.patch(
    "/api/platform/ai-bots/:instanceId/models/:slug",
    route(async (request) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      const instance = await requireInstance(db, user, request.params.instanceId);
      const current = (
        await db.query(
          "SELECT * FROM ai_bot_model_profiles WHERE instance_id=$1 AND slug=$2",
          [instance.id, request.params.slug]
        )
      ).rows[0];
      if (!current) throw new AiBotProductError(404, "model_not_found", "النموذج غير موجود");
      const accessLevel = text(request.body?.accessLevel, 10) || current.access_level;
      if (!["free", "pro"].includes(accessLevel)) throw new AiBotProductError(422, "invalid_access", "نوع الوصول غير صالح");
      const maxOutputTokens = request.body?.maxOutputTokens === undefined
        ? Number(current.max_output_tokens)
        : integer(request.body.maxOutputTokens, { minimum: 128, maximum: 8192, field: "حد الرد" });
      await db.query(
        `UPDATE ai_bot_model_profiles SET
           display_name=$3, access_level=$4, enabled=$5,
           intelligence_label=$6, analysis_label=$7, image_quality_label=$8,
           coding_label=$9, education_label=$10, image_enabled=$11,
           max_output_tokens=$12, updated_at=NOW()
         WHERE instance_id=$1 AND slug=$2`,
        [
          instance.id, current.slug,
          text(request.body?.displayName, 120) || current.display_name,
          accessLevel,
          request.body?.enabled === undefined ? current.enabled : bool(request.body.enabled),
          text(request.body?.intelligenceLabel, 120) || current.intelligence_label,
          text(request.body?.analysisLabel, 120) || current.analysis_label,
          text(request.body?.imageQualityLabel, 120) || current.image_quality_label,
          text(request.body?.codingLabel, 120) || current.coding_label,
          text(request.body?.educationLabel, 120) || current.education_label,
          request.body?.imageEnabled === undefined ? current.image_enabled : bool(request.body.imageEnabled),
          maxOutputTokens
        ]
      );
      const updated = (
        await db.query("SELECT * FROM ai_bot_model_profiles WHERE instance_id=$1 AND slug=$2", [instance.id, current.slug])
      ).rows[0];
      return { model: modelDto(updated) };
    })
  );

  app.post(
    "/api/platform/ai-bots/:instanceId/users/:telegramUserId/pro",
    route(async (request) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      const instance = await requireInstance(db, user, request.params.instanceId);
      const target = telegramUserId(request.params.telegramUserId);
      const days = integer(request.body?.days ?? 30, { minimum: 0, maximum: 3650, field: "مدة PRO" });
      const found = (
        await db.query(
          "SELECT 1 FROM ai_bot_end_users WHERE instance_id=$1 AND telegram_user_id=$2",
          [instance.id, target]
        )
      ).rows[0];
      if (!found) throw new AiBotProductError(404, "end_user_not_found", "المستخدم لم يبدأ البوت بعد");
      const proUntil = days === 0 ? null : new Date(Date.now() + days * 86_400_000);
      await db.query(
        `UPDATE ai_bot_end_users SET pro_until=$3, previous_response_id=NULL, last_seen_at=NOW()
         WHERE instance_id=$1 AND telegram_user_id=$2`,
        [instance.id, target, proUntil]
      );
      return { telegramUserId: target, proUntil };
    })
  );

  app.post(
    "/api/platform/ai-bots/:instanceId/users/:telegramUserId/ban",
    route(async (request) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      const instance = await requireInstance(db, user, request.params.instanceId);
      const target = telegramUserId(request.params.telegramUserId);
      const banned = bool(request.body?.banned, true);
      const result = await db.query(
        `UPDATE ai_bot_end_users SET is_banned=$3, previous_response_id=NULL, last_seen_at=NOW()
         WHERE instance_id=$1 AND telegram_user_id=$2 RETURNING telegram_user_id`,
        [instance.id, target, banned]
      );
      if (!result.rows[0]) throw new AiBotProductError(404, "end_user_not_found", "المستخدم غير موجود");
      return { telegramUserId: target, banned };
    })
  );

  app.get(
    "/api/platform/admin/ai-product",
    route(async (request) => {
      const user = await authenticate(db, request);
      requirePlatformAdmin(user);
      const [product, counts, usage] = await Promise.all([
        productRow(db),
        db.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE status='active')::int AS active,
                  COUNT(*) FILTER (WHERE status='awaiting_token')::int AS awaiting_token
           FROM ai_bot_instances`
        ),
        db.query(
          `SELECT COUNT(*)::int AS requests,
                  COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,
                  COALESCE(SUM(output_tokens),0)::bigint AS output_tokens
           FROM ai_bot_usage`
        )
      ]);
      return {
        product: productDto(product, config),
        openAi: {
          configured: Boolean(config.openAiApiKey),
          freeModel: config.openAiFreeModel,
          proModel: config.openAiProModel,
          imageModel: config.openAiImageModel,
          billingUrl: config.openAiBillingUrl
        },
        instances: {
          total: Number(counts.rows[0]?.total || 0),
          active: Number(counts.rows[0]?.active || 0),
          awaitingToken: Number(counts.rows[0]?.awaiting_token || 0)
        },
        usage: {
          requests: Number(usage.rows[0]?.requests || 0),
          inputTokens: Number(usage.rows[0]?.input_tokens || 0),
          outputTokens: Number(usage.rows[0]?.output_tokens || 0)
        }
      };
    })
  );

  app.patch(
    "/api/platform/admin/ai-product",
    route(async (request) => {
      const user = await authenticate(db, request);
      requirePlatformAdmin(user);
      requireCsrf(request, user);
      const product = await productRow(db);
      if (!product) throw new AiBotProductError(404, "product_not_found", "منتج البوت غير موجود");
      const priceMinor = request.body?.priceMinor === null
        ? null
        : integer(request.body?.priceMinor ?? product.starting_price_minor ?? 0, {
            minimum: 0,
            maximum: 9_000_000_000_000,
            field: "سعر المنتج"
          });
      const status = text(request.body?.status, 30) || product.status;
      if (!["active", "hidden", "coming_soon"].includes(status)) {
        throw new AiBotProductError(422, "invalid_product_status", "حالة المنتج غير صالحة");
      }
      const currency = text(request.body?.currency, 3).toUpperCase() || product.currency;
      if (!/^[A-Z]{3}$/.test(currency)) throw new AiBotProductError(422, "invalid_currency", "رمز العملة غير صالح");
      await db.query(
        `UPDATE platform_services SET starting_price_minor=$2, currency=$3, status=$4,
           is_catalog_product=TRUE, updated_by=$5, updated_at=NOW()
         WHERE id=$1`,
        [product.id, priceMinor, currency, status, user.id]
      );
      return { product: productDto(await productRow(db), config) };
    })
  );

  app.patch(
    "/api/platform/admin/ai-bots/:instanceId/models/:slug/provider",
    route(async (request) => {
      const user = await authenticate(db, request);
      requirePlatformAdmin(user);
      requireCsrf(request, user);
      const current = (
        await db.query(
          "SELECT * FROM ai_bot_model_profiles WHERE instance_id=$1 AND slug=$2",
          [request.params.instanceId, request.params.slug]
        )
      ).rows[0];
      if (!current) throw new AiBotProductError(404, "model_not_found", "النموذج غير موجود");
      const providerModel = text(request.body?.providerModel, 120) || current.provider_model;
      const reasoningEffort = text(request.body?.reasoningEffort, 30) || current.reasoning_effort;
      const imageModel = text(request.body?.imageModel, 120) || current.image_model;
      const imageQuality = text(request.body?.imageQuality, 30) || current.image_quality;
      await db.query(
        `UPDATE ai_bot_model_profiles SET provider_model=$3, reasoning_effort=$4,
           image_model=$5, image_quality=$6, updated_at=NOW()
         WHERE instance_id=$1 AND slug=$2`,
        [request.params.instanceId, current.slug, providerModel, reasoningEffort, imageModel, imageQuality]
      );
      const updated = (
        await db.query("SELECT * FROM ai_bot_model_profiles WHERE instance_id=$1 AND slug=$2", [request.params.instanceId, current.slug])
      ).rows[0];
      return { model: modelDto(updated, { includeProvider: true }) };
    })
  );

  app.post(
    "/webhooks/ai-bots/:instanceId",
    route(async (request, reply) => {
      const instance = (
        await db.query(
          `SELECT * FROM ai_bot_instances
           WHERE id=$1 AND status='active' AND token_ciphertext IS NOT NULL`,
          [request.params.instanceId]
        )
      ).rows[0];
      if (!instance) return reply.code(404).send({ ok: false });
      const incomingSecret = text(request.headers["x-telegram-bot-api-secret-token"], 200);
      if (!incomingSecret || !secureEqual(sha256(incomingSecret), instance.webhook_secret_hash)) {
        return reply.code(403).send({ ok: false });
      }
      await processTelegramUpdate(db, config, instance, request.body || {});
      return { ok: true };
    })
  );
}

export { AiBotProductError, PRODUCT_KEY, COMPONENT_KEY, productDto, modelDto, instanceDto };