import { randomUUID } from "node:crypto";
import { decryptSecret } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

const LEASE_INTERVAL = "3 minutes";

function pathOf(request) {
  return String(request.raw?.url || request.url || "")
    .split("?")[0]
    .replace(/\/+$/, "") || "/";
}

function promptIdentity(request) {
  if (String(request.method || "").toUpperCase() !== "POST") return null;
  const match = /^\/webhooks\/ai-bots\/([0-9a-f-]+)$/i.exec(pathOf(request));
  if (!match) return null;
  const message = request.body?.message;
  const prompt = String(message?.text || "").trim();
  const telegramUserId = message?.from?.id ? String(message.from.id) : "";
  const chatId = message?.chat?.id;
  if (!prompt || prompt.startsWith("/") || !/^\d{1,20}$/.test(telegramUserId) || !chatId) return null;
  return { instanceId: match[1], telegramUserId, chatId };
}

async function notifyBusy(db, config, identity) {
  try {
    const instance = (
      await db.query(
        "SELECT token_ciphertext FROM ai_bot_instances WHERE id=$1 AND status='active'",
        [identity.instanceId]
      )
    ).rows[0];
    if (!instance?.token_ciphertext) return;
    const token = decryptSecret(instance.token_ciphertext, config.encryptionKey);
    const gateway = new TelegramGateway(config);
    await gateway.sendMessage(
      token,
      identity.chatId,
      "⏳ الطلب السابق ما زال قيد التنفيذ. انتظر وصول الرد ثم أرسل طلبك التالي."
    );
  } catch {
    // Busy protection is primary; the explanatory Telegram message is best-effort.
  }
}

async function releasePromptLease(db, request) {
  const lease = request.uchihaAiPromptLease;
  if (!lease) return;
  request.uchihaAiPromptLease = null;
  await db.query(
    `DELETE FROM ai_bot_prompt_leases
     WHERE instance_id=$1 AND telegram_user_id=$2 AND lease_token=$3`,
    [lease.instanceId, lease.telegramUserId, lease.leaseToken]
  ).catch(() => undefined);
}

export function installAiBotPromptLease(app, { db, config }) {
  app.addHook("preHandler", async (request, reply) => {
    if (config.databaseMode !== "postgres") return;
    const identity = promptIdentity(request);
    if (!identity) return;

    const leaseToken = randomUUID();
    const acquired = (
      await db.query(
        `INSERT INTO ai_bot_prompt_leases (
           instance_id, telegram_user_id, lease_token, expires_at
         ) VALUES ($1,$2,$3,NOW()+INTERVAL '${LEASE_INTERVAL}')
         ON CONFLICT (instance_id, telegram_user_id) DO UPDATE SET
           lease_token=EXCLUDED.lease_token,
           expires_at=EXCLUDED.expires_at,
           updated_at=NOW()
         WHERE ai_bot_prompt_leases.expires_at<=NOW()
         RETURNING lease_token`,
        [identity.instanceId, identity.telegramUserId, leaseToken]
      )
    ).rows[0];

    if (!acquired) {
      await notifyBusy(db, config, identity);
      return reply.code(200).send({ ok: true, busy: true });
    }

    request.uchihaAiPromptLease = {
      instanceId: identity.instanceId,
      telegramUserId: identity.telegramUserId,
      leaseToken
    };
  });

  app.addHook("onResponse", async (request) => releasePromptLease(db, request));
  app.addHook("onError", async (request) => releasePromptLease(db, request));
}

export { promptIdentity, releasePromptLease, LEASE_INTERVAL };
