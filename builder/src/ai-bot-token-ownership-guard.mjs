import { sha256 } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

const SESSION_COOKIE = "uchiha_builder_session";

function pathOf(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

export function installAiBotTokenOwnershipGuard(app, { db, config }) {
  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;
    const match = /^\/api\/platform\/ai-bots\/([0-9a-f-]+)\/token$/i.exec(pathOf(request));
    if (!match) return;

    const sessionToken = request.cookies?.[SESSION_COOKIE];
    const botToken = String(request.body?.telegramBotToken || "").trim();
    if (!sessionToken || !botToken) return;

    const owner = (
      await db.query(
        `SELECT u.id
         FROM sessions s
         JOIN platform_users u ON u.id=s.user_id
         WHERE s.token_hash=$1 AND s.revoked_at IS NULL
           AND s.expires_at>NOW() AND u.status='active'`,
        [sha256(sessionToken)]
      )
    ).rows[0];
    if (!owner) return;

    const instance = (
      await db.query(
        "SELECT id FROM ai_bot_instances WHERE id=$1 AND user_id=$2",
        [match[1], owner.id]
      )
    ).rows[0];
    if (!instance) return;

    let botInfo;
    try {
      botInfo = await new TelegramGateway(config, request.log).validateToken(botToken, "ai");
    } catch {
      // The product route returns the canonical invalid-token response.
      return;
    }

    const duplicate = (
      await db.query(
        `SELECT id FROM ai_bot_instances
         WHERE telegram_bot_id=$1 AND id<>$2
         LIMIT 1`,
        [String(botInfo.id), instance.id]
      )
    ).rows[0];
    if (duplicate) {
      return reply.code(409).send({
        error: "telegram_bot_in_use",
        message: "هذا Telegram Bot مربوط بمنتج آخر. استخدم بوتًا آخر من BotFather أو عد إلى المنتج المرتبط به."
      });
    }
  });
}
