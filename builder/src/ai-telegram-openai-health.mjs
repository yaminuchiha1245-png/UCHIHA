import { timingSafeEqual } from "node:crypto";
import { decryptSecret, sha256 } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

function pathOf(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function clean(value, max = 220) {
  return String(value ?? "").replace(/[\u0000-\u001F]/g, " ").trim().slice(0, max);
}

async function tg(config, token, method, payload = {}) {
  if (config.telegramMode === "fake") return { ok: true, simulated: true };
  return new TelegramGateway(config).request(token, method, payload);
}

async function answer(config, token, callbackId, text = "") {
  if (!callbackId) return;
  await tg(config, token, "answerCallbackQuery", {
    callback_query_id: callbackId,
    ...(text ? { text: text.slice(0, 180) } : {})
  }).catch(() => undefined);
}

async function edit(config, token, callback, text, keyboard) {
  const chatId = callback?.message?.chat?.id;
  const messageId = callback?.message?.message_id;
  if (!chatId) return;
  if (messageId) {
    try {
      await tg(config, token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: keyboard
      });
      return;
    } catch {
      // Fall through to a fresh message when the prior admin message is stale.
    }
  }
  await tg(config, token, "sendMessage", { chat_id: chatId, text, reply_markup: keyboard });
}

function openAiKeyboard(configured) {
  const rows = [
    [{ text: configured ? "🔄 تغيير API Key" : "➕ إضافة API Key", callback_data: "admin:openai:set" }],
    [{ text: "🔑 إنشاء API Key في OpenAI", url: "https://platform.openai.com/api-keys" }]
  ];
  if (configured) {
    rows.push([{ text: "🧪 اختبار OpenAI الآن", callback_data: "admin:openai:test" }]);
    rows.push([{ text: "🗑 إزالة الربط", callback_data: "admin:openai:remove" }]);
  }
  rows.push([{ text: "💳 تجديد / فوترة OpenAI", url: "https://platform.openai.com/settings/organization/billing/overview" }]);
  rows.push([{ text: "↩️ رجوع", callback_data: "admin:home" }]);
  return { inline_keyboard: rows };
}

async function renderOpenAi(config, instance, token, callback, extra = "") {
  const configured = Boolean(instance.openai_api_key_ciphertext);
  const lines = [
    "🧠 إعداد OpenAI",
    "",
    `الحالة: ${configured ? "✅ المفتاح محفوظ" : "❌ غير مربوط"}`,
    configured ? `المفتاح: ${instance.openai_key_masked || "محفوظ بأمان"}` : "أنشئ API Key في OpenAI ثم أرسله هنا لتشغيل الذكاء في هذا البوت.",
    "",
    "المفتاح مشفّر على السيرفر ولا يظهر بعد الحفظ."
  ];
  if (extra) lines.push("", extra);
  await edit(config, token, callback, lines.join("\n"), openAiKeyboard(configured));
}

async function liveCheck(config, instance) {
  if (!instance.openai_api_key_ciphertext) {
    return { ok: false, message: "اربط OpenAI أولًا." };
  }
  const profile = (
    await config.db.query(
      `SELECT provider_model FROM ai_bot_model_profiles
       WHERE instance_id=$1 AND enabled=TRUE
       ORDER BY CASE WHEN access_level='free' THEN 0 ELSE 1 END, sort_order, created_at
       LIMIT 1`,
      [instance.id]
    )
  ).rows[0];
  if (!profile?.provider_model) return { ok: false, message: "لا يوجد نموذج فعال لاختباره." };

  const key = decryptSecret(instance.openai_api_key_ciphertext, config.encryptionKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${String(config.openAiBaseUrl || "https://api.openai.com/v1").replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: profile.provider_model,
        input: "Reply only with OK.",
        max_output_tokens: 16
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        message: clean(data?.error?.message || `OpenAI HTTP ${response.status}`, 180)
      };
    }
    return { ok: true, model: profile.provider_model };
  } catch (error) {
    return { ok: false, message: clean(error?.name === "AbortError" ? "انتهت مهلة الاتصال بـOpenAI." : error?.message, 180) };
  } finally {
    clearTimeout(timeout);
  }
}

export function installAiTelegramOpenAiHealth(app, { db, config }) {
  const healthConfig = Object.create(config);
  Object.defineProperty(healthConfig, "db", { value: db, enumerable: false });

  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;
    const match = /^\/webhooks\/ai-bots\/([0-9a-f-]+)$/i.exec(pathOf(request));
    if (!match) return;
    const callback = request.body?.callback_query;
    const data = String(callback?.data || "");
    if (!["admin:openai", "admin:openai:test"].includes(data)) return;

    const instance = (
      await db.query("SELECT * FROM ai_bot_instances WHERE id=$1 AND status='active'", [match[1]])
    ).rows[0];
    if (!instance?.token_ciphertext || !instance.owner_telegram_id || !instance.webhook_secret_hash) return;
    const incoming = String(request.headers["x-telegram-bot-api-secret-token"] || "");
    if (!secureEqual(sha256(incoming), instance.webhook_secret_hash)) return;
    const fromId = String(callback?.from?.id || "");
    if (!fromId || fromId !== String(instance.owner_telegram_id)) return;

    const token = decryptSecret(instance.token_ciphertext, config.encryptionKey);
    await answer(config, token, callback.id, data.endsWith(":test") ? "جارٍ اختبار OpenAI…" : "");

    if (data === "admin:openai") {
      await renderOpenAi(config, instance, token, callback);
      return reply.code(200).send({ ok: true, admin: true, openAi: true });
    }

    const result = await liveCheck(healthConfig, instance);
    const fresh = (await db.query("SELECT * FROM ai_bot_instances WHERE id=$1", [instance.id])).rows[0] || instance;
    await renderOpenAi(
      config,
      fresh,
      token,
      callback,
      result.ok
        ? `✅ الاختبار نجح. النموذج ${result.model} قادر على تنفيذ طلب فعلي.`
        : `❌ الاختبار فشل: ${result.message || "تحقق من المفتاح والرصيد والنموذج."}`
    );
    return reply.code(200).send({ ok: true, admin: true, openAiTest: result.ok });
  });
}
