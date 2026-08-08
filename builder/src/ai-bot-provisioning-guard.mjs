import { timingSafeEqual } from "node:crypto";
import { sha256 } from "./security.mjs";

function pathOf(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

function validTelegramId(value) {
  return /^\d{5,20}$/.test(String(value ?? "").trim());
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export function installAiBotProvisioningGuard(app, { db } = {}) {
  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;
    const path = pathOf(request);

    if (/^\/api\/platform\/ai-bots\/[0-9a-f-]+\/token$/i.test(path)) {
      const token = String(request.body?.telegramBotToken ?? "").trim();
      const ownerTelegramId = String(request.body?.ownerTelegramId ?? "").trim();

      if (!token) {
        return reply.code(422).send({
          error: "telegram_token_required",
          message: "Telegram Bot Token مطلوب لتشغيل البوت"
        });
      }
      if (!validTelegramId(ownerTelegramId)) {
        return reply.code(422).send({
          error: "owner_telegram_id_required",
          message: "Telegram ID الصحيح للمالك مطلوب حتى تعمل لوحة /admin"
        });
      }
      return;
    }

    // Returning to the model list is also the cancel action for the multi-step
    // model creation flow. Clear only after verifying the real Telegram webhook
    // secret and the configured owner so a forged request cannot cancel a session.
    const webhook = /^\/webhooks\/ai-bots\/([0-9a-f-]+)$/i.exec(path);
    const callback = request.body?.callback_query;
    if (!db || !webhook || String(callback?.data || "") !== "admin:models") return;
    const fromId = String(callback?.from?.id || "");
    if (!fromId) return;
    const instance = (
      await db.query(
        `SELECT owner_telegram_id, webhook_secret_hash
         FROM ai_bot_instances WHERE id=$1 AND status='active'`,
        [webhook[1]]
      )
    ).rows[0];
    const incoming = String(request.headers["x-telegram-bot-api-secret-token"] || "");
    if (!instance?.owner_telegram_id || String(instance.owner_telegram_id) !== fromId) return;
    if (!instance.webhook_secret_hash || !secureEqual(sha256(incoming), instance.webhook_secret_hash)) return;
    await db.query(
      `DELETE FROM ai_bot_admin_sessions
       WHERE instance_id=$1 AND telegram_user_id=$2 AND state LIKE 'model_create_%'`,
      [webhook[1], fromId]
    );
  });
}
