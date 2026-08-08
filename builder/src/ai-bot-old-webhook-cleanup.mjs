import { decryptSecret, sha256 } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

const SESSION_COOKIE = "uchiha_builder_session";

function pathOf(request) {
  return String(request.raw?.url || request.url || "")
    .split("?")[0]
    .replace(/\/+$/, "") || "/";
}

async function authorizedInstance(db, request, instanceId) {
  const sessionToken = request.cookies?.[SESSION_COOKIE];
  const csrf = String(request.headers["x-csrf-token"] || "");
  if (!sessionToken || !csrf) return null;
  const session = (
    await db.query(
      `SELECT u.id, s.csrf_hash
       FROM sessions s
       JOIN platform_users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL
         AND s.expires_at>NOW() AND u.status='active'`,
      [sha256(sessionToken)]
    )
  ).rows[0];
  if (!session?.id || !session.csrf_hash || sha256(csrf) !== session.csrf_hash) return null;
  return (
    await db.query(
      `SELECT id, telegram_bot_id, token_ciphertext
       FROM ai_bot_instances WHERE id=$1 AND user_id=$2`,
      [instanceId, session.id]
    )
  ).rows[0] || null;
}

export function installAiBotOldWebhookCleanup(app, { db, config }) {
  app.addHook("preHandler", async (request) => {
    if (String(request.method || "").toUpperCase() !== "POST") return;
    const match = /^\/api\/platform\/ai-bots\/([0-9a-f-]+)\/token$/i.exec(pathOf(request));
    if (!match) return;
    const instance = await authorizedInstance(db, request, match[1]);
    if (!instance?.token_ciphertext || !instance.telegram_bot_id) return;
    request.uchihaAiPreviousTelegram = {
      instanceId: instance.id,
      botId: String(instance.telegram_bot_id),
      tokenCiphertext: instance.token_ciphertext
    };
  });

  app.addHook("onResponse", async (request, reply) => {
    const previous = request.uchihaAiPreviousTelegram;
    if (!previous || Number(reply.statusCode || 500) >= 400) return;
    const current = (
      await db.query(
        "SELECT telegram_bot_id FROM ai_bot_instances WHERE id=$1",
        [previous.instanceId]
      )
    ).rows[0];
    if (!current?.telegram_bot_id || String(current.telegram_bot_id) === previous.botId) return;

    try {
      const oldToken = decryptSecret(previous.tokenCiphertext, config.encryptionKey);
      await new TelegramGateway(config, request.log).request(oldToken, "deleteWebhook", {
        drop_pending_updates: false
      });
    } catch (error) {
      request.log?.warn?.(
        { error, instanceId: previous.instanceId, oldBotId: previous.botId },
        "Failed to remove previous Telegram webhook after bot rotation"
      );
    }
  });
}
