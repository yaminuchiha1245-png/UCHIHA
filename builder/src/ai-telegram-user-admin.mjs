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

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

async function tg(config, token, method, payload = {}) {
  if (config.telegramMode === "fake") return { ok: true, simulated: true };
  return new TelegramGateway(config).request(token, method, payload);
}

async function send(config, token, chatId, text, keyboard = null) {
  return tg(config, token, "sendMessage", {
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
      await tg(config, token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: keyboard
      });
      return;
    } catch {
      // Fall through to a new message when Telegram cannot edit the old one.
    }
  }
  await send(config, token, chatId, text, keyboard);
}

async function answer(config, token, callbackId, text = "") {
  if (!callbackId) return;
  await tg(config, token, "answerCallbackQuery", {
    callback_query_id: callbackId,
    ...(text ? { text: text.slice(0, 180) } : {})
  }).catch(() => undefined);
}

async function setSession(db, instanceId, ownerId, state) {
  await db.query(
    `INSERT INTO ai_bot_admin_sessions (instance_id, telegram_user_id, state, payload, expires_at)
     VALUES ($1,$2,$3,'{}'::jsonb,NOW()+INTERVAL '15 minutes')
     ON CONFLICT (instance_id, telegram_user_id) DO UPDATE SET
       state=EXCLUDED.state, payload='{}'::jsonb,
       expires_at=EXCLUDED.expires_at, updated_at=NOW()`,
    [instanceId, ownerId, state]
  );
}

async function getSession(db, instanceId, ownerId) {
  return (
    await db.query(
      `SELECT state FROM ai_bot_admin_sessions
       WHERE instance_id=$1 AND telegram_user_id=$2
         AND state IN ('grant_pro','ban_user') AND expires_at>NOW()`,
      [instanceId, ownerId]
    )
  ).rows[0] || null;
}

async function clearSession(db, instanceId, ownerId) {
  await db.query(
    "DELETE FROM ai_bot_admin_sessions WHERE instance_id=$1 AND telegram_user_id=$2",
    [instanceId, ownerId]
  );
}

async function userExists(db, instanceId, telegramId) {
  return Boolean((
    await db.query(
      "SELECT 1 FROM ai_bot_end_users WHERE instance_id=$1 AND telegram_user_id=$2",
      [instanceId, telegramId]
    )
  ).rows[0]);
}

export function installAiTelegramUserAdmin(app, { db, config }) {
  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;
    const match = /^\/webhooks\/ai-bots\/([0-9a-f-]+)$/i.exec(pathOf(request));
    if (!match) return;

    const update = request.body || {};
    const callback = update.callback_query;
    const message = update.message;
    const data = String(callback?.data || "");
    const messageText = clean(message?.text, 500);
    const fromId = String(callback?.from?.id || message?.from?.id || "");
    const chatId = callback?.message?.chat?.id || message?.chat?.id;
    if (!fromId || !chatId) return;

    const instance = (
      await db.query("SELECT * FROM ai_bot_instances WHERE id=$1 AND status='active'", [match[1]])
    ).rows[0];
    if (!instance?.token_ciphertext || !instance.owner_telegram_id || !instance.webhook_secret_hash) return;
    const incoming = String(request.headers["x-telegram-bot-api-secret-token"] || "");
    if (!secureEqual(sha256(incoming), instance.webhook_secret_hash)) return;
    if (fromId !== String(instance.owner_telegram_id)) return;

    const session = await getSession(db, instance.id, fromId);
    const relevant = data === "admin:pro:set" || data === "admin:ban:set" || session;
    if (!relevant) return;
    const token = decryptSecret(instance.token_ciphertext, config.encryptionKey);

    if (data === "admin:pro:set") {
      await answer(config, token, callback?.id);
      await setSession(db, instance.id, fromId, "grant_pro");
      await edit(config, token, callback, "⭐ منح / إلغاء PRO\n\nأرسل Telegram ID ثم عدد الأيام.\nمثال: 123456789 30\nلإلغاء PRO استخدم: 123456789 0", {
        inline_keyboard: [[{ text: "إلغاء", callback_data: "admin:home" }]]
      });
      return reply.code(200).send({ ok: true, admin: true, userAdmin: true });
    }

    if (data === "admin:ban:set") {
      await answer(config, token, callback?.id);
      await setSession(db, instance.id, fromId, "ban_user");
      await edit(config, token, callback, "🚫 حظر / فك حظر مستخدم\n\nأرسل Telegram ID ثم on أو off.\nمثال: 123456789 on", {
        inline_keyboard: [[{ text: "إلغاء", callback_data: "admin:home" }]]
      });
      return reply.code(200).send({ ok: true, admin: true, userAdmin: true });
    }

    if (!session || !messageText || messageText.startsWith("/")) return;

    if (session.state === "grant_pro") {
      const matchValue = /^(\d{5,20})\s+(\d{1,4})$/.exec(messageText);
      if (!matchValue) {
        await send(config, token, chatId, "الصيغة غير صحيحة. مثال: 123456789 30");
        return reply.code(200).send({ ok: true, admin: true, userAdmin: true });
      }
      const targetId = matchValue[1];
      const days = Number(matchValue[2]);
      if (days > 3650) {
        await send(config, token, chatId, "الحد الأقصى 3650 يومًا.");
        return reply.code(200).send({ ok: true, admin: true, userAdmin: true });
      }
      if (!(await userExists(db, instance.id, targetId))) {
        await send(config, token, chatId, "❌ هذا المستخدم لم يبدأ البوت بعد. اطلب منه الضغط على Start أولًا.");
        return reply.code(200).send({ ok: true, admin: true, userAdmin: true, found: false });
      }
      const proUntil = days === 0 ? null : new Date(Date.now() + days * 86_400_000);
      await db.query(
        `UPDATE ai_bot_end_users SET pro_until=$3, previous_response_id=NULL,
           updated_at=NOW(), last_seen_at=NOW()
         WHERE instance_id=$1 AND telegram_user_id=$2`,
        [instance.id, targetId, proUntil]
      );
      await clearSession(db, instance.id, fromId);
      await send(config, token, chatId, days === 0
        ? `✅ تم إلغاء PRO للمستخدم ${targetId}.`
        : `✅ تم منح PRO للمستخدم ${targetId} لمدة ${days} يوم.`
      );
      return reply.code(200).send({ ok: true, admin: true, userAdmin: true, found: true });
    }

    if (session.state === "ban_user") {
      const matchValue = /^(\d{5,20})\s+(on|off)$/i.exec(messageText);
      if (!matchValue) {
        await send(config, token, chatId, "الصيغة غير صحيحة. مثال: 123456789 on");
        return reply.code(200).send({ ok: true, admin: true, userAdmin: true });
      }
      const targetId = matchValue[1];
      const banned = matchValue[2].toLowerCase() === "on";
      if (!(await userExists(db, instance.id, targetId))) {
        await send(config, token, chatId, "❌ هذا المستخدم غير موجود في البوت.");
        return reply.code(200).send({ ok: true, admin: true, userAdmin: true, found: false });
      }
      await db.query(
        `UPDATE ai_bot_end_users SET is_banned=$3, previous_response_id=NULL,
           updated_at=NOW(), last_seen_at=NOW()
         WHERE instance_id=$1 AND telegram_user_id=$2`,
        [instance.id, targetId, banned]
      );
      await clearSession(db, instance.id, fromId);
      await send(config, token, chatId, banned
        ? `✅ تم حظر المستخدم ${targetId}.`
        : `✅ تم فك الحظر عن المستخدم ${targetId}.`
      );
      return reply.code(200).send({ ok: true, admin: true, userAdmin: true, found: true });
    }
  });
}
