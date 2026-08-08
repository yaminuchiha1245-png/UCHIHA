import { randomToken, sha256, encryptSecret, maskSecret } from "./security.mjs";

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function secureSetupSecret(config) {
  return sha256(`${config.aiSetupBotToken || ""}:${String(config.encryptionKey || "")}`).slice(0, 64);
}

async function telegram(token, method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram HTTP ${response.status}`);
  return data.result;
}

async function say(config, chatId, message, keyboard = null) {
  if (!config.aiSetupBotToken) return;
  await telegram(config.aiSetupBotToken, "sendMessage", {
    chat_id: chatId,
    text: message,
    ...(keyboard ? { reply_markup: keyboard } : {})
  });
}

function tokenLooksValid(value) {
  return /^\d{6,20}:[A-Za-z0-9_-]{20,}$/.test(String(value || "").trim());
}

export function installAiSetupBot(app, { db, config }) {
  const expectedSecret = secureSetupSecret(config);

  app.post("/webhooks/ai-setup", async (request, reply) => {
    if (!config.aiSetupBotToken) return reply.code(404).send({ ok: false });
    if (String(request.headers["x-telegram-bot-api-secret-token"] || "") !== expectedSecret) {
      return reply.code(403).send({ ok: false });
    }

    const message = request.body?.message;
    const fromId = message?.from?.id ? String(message.from.id) : "";
    const chatId = message?.chat?.id;
    const messageText = text(message?.text, 4000);
    if (!fromId || !chatId || !messageText) return { ok: true };

    if (messageText === "/cancel") {
      await db.query("DELETE FROM ai_bot_setup_sessions WHERE telegram_user_id=$1", [fromId]);
      await say(config, chatId, "تم إلغاء عملية الإعداد.");
      return { ok: true };
    }

    if (messageText.startsWith("/start")) {
      const code = text(messageText.replace(/^\/start\s*/i, ""), 200);
      if (!code) {
        await say(config, chatId, "هذا البوت مخصص لإعداد المنتجات التي اشتريتها من UCHIHA. افتح رابط التفعيل الموجود بعد عملية الشراء.");
        return { ok: true };
      }
      const instance = (
        await db.query(
          `SELECT id, display_name FROM ai_bot_instances
           WHERE setup_code_hash=$1 AND setup_code_expires_at>NOW()
           LIMIT 1`,
          [sha256(code)]
        )
      ).rows[0];
      if (!instance) {
        await say(config, chatId, "رابط التفعيل غير صالح أو انتهت مدته. ارجع لطلبك في UCHIHA وأصدر رابط إعداد جديد.");
        return { ok: true };
      }
      await db.query(
        `INSERT INTO ai_bot_setup_sessions (telegram_user_id, instance_id, state, expires_at)
         VALUES ($1,$2,'awaiting_bot_token',NOW()+INTERVAL '30 minutes')
         ON CONFLICT (telegram_user_id) DO UPDATE SET
           instance_id=EXCLUDED.instance_id, state='awaiting_bot_token',
           expires_at=EXCLUDED.expires_at, updated_at=NOW()`,
        [fromId, instance.id]
      );
      await say(
        config,
        chatId,
        [
          `✅ تم تأكيد شراء ${instance.display_name}.`,
          "",
          "الآن أرسل Telegram Bot Token الذي أخذته من BotFather.",
          "🔐 سيتم تشفيره ولن يظهر بعد الحفظ.",
          "",
          "لإلغاء العملية أرسل /cancel"
        ].join("\n")
      );
      return { ok: true };
    }

    const session = (
      await db.query(
        `SELECT s.*, i.display_name
         FROM ai_bot_setup_sessions s
         JOIN ai_bot_instances i ON i.id=s.instance_id
         WHERE s.telegram_user_id=$1 AND s.expires_at>NOW()`,
        [fromId]
      )
    ).rows[0];
    if (!session) {
      await say(config, chatId, "لا توجد عملية إعداد مفتوحة. استخدم رابط التفعيل الذي ظهر لك بعد شراء البوت.");
      return { ok: true };
    }

    if (session.state === "awaiting_bot_token") {
      const botToken = messageText.trim();
      if (!tokenLooksValid(botToken)) {
        await say(config, chatId, "Token غير صالح. انسخه كاملًا من BotFather وأرسله برسالة واحدة.");
        return { ok: true };
      }
      let bot;
      try {
        bot = await telegram(botToken, "getMe");
      } catch {
        await say(config, chatId, "تعذر التحقق من Token. تأكد أنه صحيح ولم يتم إلغاؤه من BotFather.");
        return { ok: true };
      }

      const webhookSecret = randomToken(24);
      const webhookUrl = `${config.appBaseUrl.replace(/\/$/, "")}/webhooks/ai-bots/${session.instance_id}`;
      if (config.telegramMode !== "fake") {
        try {
          await telegram(botToken, "setWebhook", {
            url: webhookUrl,
            secret_token: webhookSecret,
            allowed_updates: ["message", "callback_query"],
            drop_pending_updates: true
          });
        } catch {
          await say(config, chatId, "Token صحيح، لكن تعذر ربط Webhook. تأكد أن رابط UCHIHA يعمل عبر HTTPS ثم حاول مجددًا.");
          return { ok: true };
        }
      }

      await db.query(
        `UPDATE ai_bot_instances SET
           token_ciphertext=$2,
           token_fingerprint=$3,
           token_masked=$4,
           telegram_bot_id=$5,
           telegram_username=$6,
           owner_telegram_id=$7,
           webhook_secret_ciphertext=$8,
           webhook_secret_hash=$9,
           status='active',
           setup_completed_at=NOW(),
           setup_code_hash=NULL,
           setup_code_expires_at=NULL,
           last_error=NULL,
           last_checked_at=NOW(),
           updated_at=NOW()
         WHERE id=$1`,
        [
          session.instance_id,
          encryptSecret(botToken, config.encryptionKey),
          sha256(botToken),
          maskSecret(botToken),
          String(bot.id),
          text(bot.username, 100) || null,
          fromId,
          encryptSecret(webhookSecret, config.encryptionKey),
          sha256(webhookSecret)
        ]
      );
      await db.query("DELETE FROM ai_bot_setup_sessions WHERE telegram_user_id=$1", [fromId]);

      const botUrl = bot.username ? `https://t.me/${bot.username}` : null;
      await say(
        config,
        chatId,
        [
          "✅ تم ربط البوت وتشغيله بنجاح.",
          "",
          `🤖 ${session.display_name}`,
          bot.username ? `🔗 @${bot.username}` : "",
          "",
          "افتح البوت واكتب /admin.",
          "من لوحة الإدارة داخل البوت ستربط OpenAI وتضبط النماذج وPRO والمستخدمين والحدود وكل الإعدادات."
        ].filter(Boolean).join("\n"),
        botUrl ? { inline_keyboard: [[{ text: "🤖 فتح البوت", url: botUrl }]] } : null
      );
      return { ok: true };
    }

    return { ok: true };
  });

  return {
    async activate() {
      if (!config.aiSetupBotToken || config.telegramMode === "fake") return { configured: false };
      const baseUrl = String(config.appBaseUrl || "");
      if (!baseUrl.startsWith("https://")) return { configured: false, reason: "https_required" };
      const bot = await telegram(config.aiSetupBotToken, "getMe");
      await telegram(config.aiSetupBotToken, "setWebhook", {
        url: `${baseUrl.replace(/\/$/, "")}/webhooks/ai-setup`,
        secret_token: expectedSecret,
        allowed_updates: ["message"],
        drop_pending_updates: false
      });
      return { configured: true, username: bot.username || null };
    }
  };
}
