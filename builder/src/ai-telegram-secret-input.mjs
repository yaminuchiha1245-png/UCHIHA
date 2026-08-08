import { timingSafeEqual } from "node:crypto";
import { decryptSecret, encryptSecret, maskSecret, sha256 } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

function pathOf(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

async function tg(config, token, method, payload = {}) {
  if (config.telegramMode === "fake") return { ok: true, simulated: true };
  return new TelegramGateway(config).request(token, method, payload);
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

export function installAiTelegramSecretInput(app, { db, config }) {
  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;
    const match = /^\/webhooks\/ai-bots\/([0-9a-f-]+)$/i.exec(pathOf(request));
    if (!match) return;
    const message = request.body?.message;
    const messageText = String(message?.text || "").trim();
    const fromId = String(message?.from?.id || "");
    const chatId = message?.chat?.id;
    const messageId = message?.message_id;
    if (!messageText || !fromId || !chatId) return;

    const instance = (
      await db.query("SELECT * FROM ai_bot_instances WHERE id=$1 AND status='active'", [match[1]])
    ).rows[0];
    if (!instance?.token_ciphertext || !instance.owner_telegram_id || !instance.webhook_secret_hash) return;
    const incoming = String(request.headers["x-telegram-bot-api-secret-token"] || "");
    if (!secureEqual(sha256(incoming), instance.webhook_secret_hash)) return;
    if (fromId !== String(instance.owner_telegram_id)) return;

    const session = (
      await db.query(
        `SELECT state FROM ai_bot_admin_sessions
         WHERE instance_id=$1 AND telegram_user_id=$2 AND expires_at>NOW()`,
        [instance.id, fromId]
      )
    ).rows[0];
    if (session?.state !== "openai_key") return;

    const botToken = decryptSecret(instance.token_ciphertext, config.encryptionKey);
    // Remove the owner's secret message even when the key is invalid. The owner can
    // resend a corrected key, but the previous credential should not remain in chat.
    const deleteSecretMessage = async () => {
      if (!messageId) return;
      await tg(config, botToken, "deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => undefined);
    };

    const key = messageText;
    if (!/^sk-[A-Za-z0-9_\-]{20,}$/.test(key) || !(await validateOpenAiKey(key))) {
      await deleteSecretMessage();
      await tg(config, botToken, "sendMessage", {
        chat_id: chatId,
        text: "❌ مفتاح OpenAI غير صالح أو تعذر الاتصال به. تم حذف رسالة المفتاح من المحادثة. أرسل مفتاحًا صحيحًا أو /cancel."
      });
      return reply.code(200).send({ ok: true, admin: true, secretDeleted: true, openAiSaved: false });
    }

    await db.query(
      `UPDATE ai_bot_instances SET
         openai_api_key_ciphertext=$2, openai_key_masked=$3,
         openai_key_fingerprint=$4, updated_at=NOW()
       WHERE id=$1`,
      [instance.id, encryptSecret(key, config.encryptionKey), maskSecret(key), sha256(key)]
    );
    await db.query(
      "DELETE FROM ai_bot_admin_sessions WHERE instance_id=$1 AND telegram_user_id=$2",
      [instance.id, fromId]
    );
    await deleteSecretMessage();
    await tg(config, botToken, "sendMessage", {
      chat_id: chatId,
      text: "✅ تم ربط OpenAI وتشفير المفتاح، وتم حذف رسالة المفتاح من المحادثة.",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🧪 اختبار OpenAI", callback_data: "admin:openai:test" }],
          [{ text: "🧠 إعداد OpenAI", callback_data: "admin:openai" }],
          [{ text: "⚙️ لوحة الإدارة", callback_data: "admin:home" }]
        ]
      }
    });
    return reply.code(200).send({ ok: true, admin: true, secretDeleted: true, openAiSaved: true });
  });
}
