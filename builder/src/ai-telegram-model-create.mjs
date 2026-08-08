import { randomUUID, timingSafeEqual } from "node:crypto";
import { decryptSecret, sha256 } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

function pathOf(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

async function telegram(config, token, method, payload = {}) {
  if (config.telegramMode === "fake") return { ok: true, simulated: true };
  return new TelegramGateway(config).request(token, method, payload);
}

async function send(config, token, chatId, text, keyboard = null) {
  return telegram(config, token, "sendMessage", {
    chat_id: chatId,
    text,
    ...(keyboard ? { reply_markup: keyboard } : {})
  });
}

async function edit(config, token, callback, text, keyboard) {
  const chatId = callback?.message?.chat?.id;
  const messageId = callback?.message?.message_id;
  if (!chatId) return;
  if (messageId) {
    try {
      await telegram(config, token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: keyboard
      });
      return;
    } catch {
      // Send a fresh message if Telegram no longer lets us edit the old one.
    }
  }
  await send(config, token, chatId, text, keyboard);
}

async function answer(config, token, callbackId, text = "") {
  if (!callbackId) return;
  await telegram(config, token, "answerCallbackQuery", {
    callback_query_id: callbackId,
    ...(text ? { text: text.slice(0, 180) } : {})
  }).catch(() => undefined);
}

async function getSession(db, instanceId, ownerId) {
  return (
    await db.query(
      `SELECT * FROM ai_bot_admin_sessions
       WHERE instance_id=$1 AND telegram_user_id=$2
         AND state LIKE 'model_create_%' AND expires_at>NOW()`,
      [instanceId, ownerId]
    )
  ).rows[0] || null;
}

async function setSession(db, instanceId, ownerId, state, payload = {}) {
  await db.query(
    `INSERT INTO ai_bot_admin_sessions (instance_id, telegram_user_id, state, payload, expires_at)
     VALUES ($1,$2,$3,$4,NOW()+INTERVAL '15 minutes')
     ON CONFLICT (instance_id, telegram_user_id) DO UPDATE SET
       state=EXCLUDED.state, payload=EXCLUDED.payload,
       expires_at=EXCLUDED.expires_at, updated_at=NOW()`,
    [instanceId, ownerId, state, JSON.stringify(payload)]
  );
}

async function clearSession(db, instanceId, ownerId) {
  await db.query(
    "DELETE FROM ai_bot_admin_sessions WHERE instance_id=$1 AND telegram_user_id=$2",
    [instanceId, ownerId]
  );
}

async function modelExistsForKey(instance, config, modelId) {
  if (!instance.openai_api_key_ciphertext) return false;
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

async function renderModels(db, config, instance, token, callback) {
  const models = (
    await db.query(
      `SELECT slug, display_name, provider_model, access_level, enabled
       FROM ai_bot_model_profiles WHERE instance_id=$1
       ORDER BY sort_order, created_at LIMIT 12`,
      [instance.id]
    )
  ).rows;
  const lines = models.map((model) =>
    `• ${model.display_name} — ${model.access_level === "pro" ? "PRO" : "مجاني"} — ${model.enabled ? "فعال" : "متوقف"}`
  ).join("\n");
  const rows = models.map((model) => {
    const row = [{ text: `⚙️ ${model.display_name}`, callback_data: `admin:model:${model.slug}` }];
    if (String(model.slug).startsWith("custom-")) {
      row.push({ text: "🗑 حذف", callback_data: `admin:model:delete:${model.slug}` });
    }
    return row;
  });
  if (models.length < 12) rows.push([{ text: "➕ إضافة نموذج", callback_data: "admin:model:add" }]);
  rows.push([{ text: "↩️ رجوع", callback_data: "admin:home" }]);
  await edit(
    config,
    token,
    callback,
    ["🤖 إدارة النماذج", "", lines || "لا توجد نماذج."].join("\n"),
    { inline_keyboard: rows }
  );
}

async function createModel(db, instance, ownerId, accessLevel, payload) {
  const count = Number((
    await db.query("SELECT COUNT(*)::int AS count FROM ai_bot_model_profiles WHERE instance_id=$1", [instance.id])
  ).rows[0]?.count || 0);
  if (count >= 12) throw new Error("وصلت للحد الأقصى: 12 نموذجًا");

  const baseSlug = accessLevel === "pro" ? "uchiha-v2" : "uchiha-v1";
  const base = (
    await db.query(
      `SELECT * FROM ai_bot_model_profiles
       WHERE instance_id=$1
       ORDER BY CASE WHEN slug=$2 THEN 0 ELSE 1 END, sort_order, created_at LIMIT 1`,
      [instance.id, baseSlug]
    )
  ).rows[0];
  if (!base) throw new Error("لا يوجد نموذج أساسي يمكن النسخ منه");

  const slug = `custom-${randomUUID().slice(0, 8)}`;
  const sortOrder = Number((
    await db.query("SELECT COALESCE(MAX(sort_order),0)::int AS value FROM ai_bot_model_profiles WHERE instance_id=$1", [instance.id])
  ).rows[0]?.value || 0) + 10;

  await db.query(
    `INSERT INTO ai_bot_model_profiles (
       id, instance_id, slug, display_name, provider_model, access_level,
       enabled, sort_order, intelligence_label, analysis_label,
       image_quality_label, coding_label, education_label, max_output_tokens,
       reasoning_effort, image_enabled, image_model, image_quality, system_prompt
     ) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      randomUUID(), instance.id, slug, payload.name, payload.providerModel, accessLevel,
      sortOrder, base.intelligence_label, base.analysis_label, base.image_quality_label,
      base.coding_label, base.education_label, base.max_output_tokens,
      base.reasoning_effort, base.image_enabled, base.image_model, base.image_quality,
      `أنت ${payload.name}، مساعد ذكاء اصطناعي واضح وعملي. اتبع طلب المستخدم بدقة.`
    ]
  );
  await clearSession(db, instance.id, ownerId);
  return slug;
}

async function deleteCustomModel(db, instance, slug) {
  if (!String(slug).startsWith("custom-")) {
    return { ok: false, message: "UCHIHA AI V1 وV2 نماذج أساسية ولا يمكن حذفهما." };
  }
  const model = (
    await db.query(
      "SELECT * FROM ai_bot_model_profiles WHERE instance_id=$1 AND slug=$2",
      [instance.id, slug]
    )
  ).rows[0];
  if (!model) return { ok: false, message: "النموذج غير موجود." };

  if (model.enabled && model.access_level === "free") {
    const otherFree = Number((
      await db.query(
        `SELECT COUNT(*)::int AS count FROM ai_bot_model_profiles
         WHERE instance_id=$1 AND slug<>$2 AND enabled=TRUE AND access_level='free'`,
        [instance.id, slug]
      )
    ).rows[0]?.count || 0);
    if (!otherFree) {
      return { ok: false, message: "لا يمكن حذف آخر نموذج مجاني فعال." };
    }
  }

  await db.query(
    "DELETE FROM ai_bot_model_profiles WHERE instance_id=$1 AND slug=$2",
    [instance.id, slug]
  );
  // Any end user still pointing at the removed profile is reset. The normal
  // profile resolver will pick the first currently enabled free model on use.
  await db.query(
    `UPDATE ai_bot_end_users SET active_model_slug='uchiha-v1', active_mode='general',
       previous_response_id=NULL, updated_at=NOW()
     WHERE instance_id=$1 AND active_model_slug=$2`,
    [instance.id, slug]
  );
  return { ok: true };
}

export function installAiTelegramModelCreate(app, { db, config }) {
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
    const fromId = String(callback?.from?.id || message?.from?.id || "");
    const chatId = callback?.message?.chat?.id || message?.chat?.id;
    const data = String(callback?.data || "");
    const messageText = clean(message?.text, 500);
    if (!fromId || !chatId || fromId !== String(instance.owner_telegram_id)) return;

    const session = await getSession(db, instance.id, fromId);
    const relevant =
      data === "admin:models" ||
      data === "admin:model:add" ||
      data.startsWith("admin:model:add:") ||
      data.startsWith("admin:model:delete:") ||
      session;
    if (!relevant) return;

    const token = decryptSecret(instance.token_ciphertext, config.encryptionKey);

    if (data === "admin:models") {
      await answer(config, token, callback?.id);
      await renderModels(db, config, instance, token, callback);
      return reply.code(200).send({ ok: true, admin: true, models: true });
    }

    if (data.startsWith("admin:model:delete:")) {
      await answer(config, token, callback?.id);
      const slug = clean(data.slice("admin:model:delete:".length), 80);
      const result = await deleteCustomModel(db, instance, slug);
      if (!result.ok) {
        await answer(config, token, callback?.id, result.message);
        return reply.code(200).send({ ok: true, admin: true, deleted: false });
      }
      await renderModels(db, config, instance, token, callback);
      return reply.code(200).send({ ok: true, admin: true, deleted: true });
    }

    if (data === "admin:model:add") {
      await answer(config, token, callback?.id);
      const count = Number((
        await db.query("SELECT COUNT(*)::int AS count FROM ai_bot_model_profiles WHERE instance_id=$1", [instance.id])
      ).rows[0]?.count || 0);
      if (count >= 12) {
        await answer(config, token, callback?.id, "وصلت للحد الأقصى: 12 نموذجًا");
        return reply.code(200).send({ ok: true, admin: true });
      }
      if (!instance.openai_api_key_ciphertext) {
        await edit(config, token, callback, "اربط OpenAI أولًا، ثم ارجع لإضافة النموذج.", {
          inline_keyboard: [
            [{ text: "🧠 ربط OpenAI", callback_data: "admin:openai" }],
            [{ text: "↩️ النماذج", callback_data: "admin:models" }]
          ]
        });
        return reply.code(200).send({ ok: true, admin: true });
      }
      await setSession(db, instance.id, fromId, "model_create_name");
      await edit(config, token, callback, "➕ إضافة نموذج\n\nأرسل الاسم التجاري الذي سيظهر للمستخدم، مثل:\nUCHIHA AI V3", {
        inline_keyboard: [[{ text: "إلغاء", callback_data: "admin:models" }]]
      });
      return reply.code(200).send({ ok: true, admin: true });
    }

    if (session?.state === "model_create_name" && messageText) {
      if (messageText.length < 2) {
        await send(config, token, chatId, "الاسم قصير جدًا. أرسل اسمًا أوضح.");
        return reply.code(200).send({ ok: true, admin: true });
      }
      await setSession(db, instance.id, fromId, "model_create_provider", { name: messageText });
      await send(config, token, chatId, "أرسل الآن اسم نموذج OpenAI الحقيقي.\nمثال: gpt-5.6-sol أو gpt-5.6-luna");
      return reply.code(200).send({ ok: true, admin: true });
    }

    if (session?.state === "model_create_provider" && messageText) {
      if (!(await modelExistsForKey(instance, config, messageText))) {
        await send(config, token, chatId, "هذا النموذج غير متاح للمفتاح المرتبط. تأكد من الاسم وحاول مرة ثانية.");
        return reply.code(200).send({ ok: true, admin: true });
      }
      const previous = typeof session.payload === "string" ? JSON.parse(session.payload || "{}") : (session.payload || {});
      await setSession(db, instance.id, fromId, "model_create_access", {
        name: clean(previous.name, 120),
        providerModel: messageText
      });
      await send(config, token, chatId, "اختر نوع الوصول لهذا النموذج:", {
        inline_keyboard: [[
          { text: "🆓 مجاني", callback_data: "admin:model:add:free" },
          { text: "⭐ PRO", callback_data: "admin:model:add:pro" }
        ], [{ text: "إلغاء", callback_data: "admin:models" }]]
      });
      return reply.code(200).send({ ok: true, admin: true });
    }

    if (session?.state === "model_create_access" && /^admin:model:add:(free|pro)$/.test(data)) {
      await answer(config, token, callback?.id);
      const accessLevel = data.endsWith(":pro") ? "pro" : "free";
      const payload = typeof session.payload === "string" ? JSON.parse(session.payload || "{}") : (session.payload || {});
      try {
        await createModel(db, instance, fromId, accessLevel, payload);
        await edit(config, token, callback, `✅ تم إنشاء ${payload.name} بنجاح.`, {
          inline_keyboard: [[{ text: "🤖 إدارة النماذج", callback_data: "admin:models" }]]
        });
      } catch (error) {
        await send(config, token, chatId, `تعذر إنشاء النموذج: ${clean(error.message, 180)}`);
      }
      return reply.code(200).send({ ok: true, admin: true });
    }
  });
}

export { deleteCustomModel };
