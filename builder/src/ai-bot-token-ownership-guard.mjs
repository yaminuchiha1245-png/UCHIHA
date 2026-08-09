import { sha256 } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

const SESSION_COOKIE = "uchiha_builder_session";
const STALE_PROVISIONING_INTERVAL = "2 minutes";

function pathOf(request) {
  return String(request.raw?.url || request.url || "")
    .split("?")[0]
    .replace(/\/+$/, "") || "/";
}

function settingsValue(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return {}; }
}

async function authenticate(db, request) {
  const sessionToken = request.cookies?.[SESSION_COOKIE];
  const csrf = String(request.headers["x-csrf-token"] || "");
  if (!sessionToken || !csrf) return null;
  const row = (
    await db.query(
      `SELECT u.id, s.csrf_hash
       FROM sessions s
       JOIN platform_users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL
         AND s.expires_at>NOW() AND u.status='active'`,
      [sha256(sessionToken)]
    )
  ).rows[0];
  if (!row?.id || !row.csrf_hash || sha256(csrf) !== row.csrf_hash) return null;
  return row;
}

async function restoreStaleProvisioning(db, instance) {
  if (instance.status !== "provisioning") return instance;
  const settings = settingsValue(instance.settings);
  const previousStatus = String(settings.provisioningPreviousStatus || (instance.token_ciphertext ? "active" : "awaiting_token"));
  const previousBotId = settings.provisioningPreviousBotId || null;
  const restored = (
    await db.query(
      `UPDATE ai_bot_instances SET
         status=$2,
         telegram_bot_id=$3,
         settings=(COALESCE(settings, '{}'::jsonb)
           - 'provisioningPreviousStatus'
           - 'provisioningPreviousBotId'
           - 'provisioningStartedAt'),
         updated_at=NOW()
       WHERE id=$1 AND status='provisioning'
         AND updated_at < NOW() - INTERVAL '${STALE_PROVISIONING_INTERVAL}'
       RETURNING *`,
      [instance.id, previousStatus, previousBotId]
    )
  ).rows[0];
  return restored || instance;
}

async function rollbackReservation(db, reservation) {
  if (!reservation?.instanceId) return;
  await db.query(
    `UPDATE ai_bot_instances SET
       status=$3,
       telegram_bot_id=$4,
       settings=(COALESCE(settings, '{}'::jsonb)
         - 'provisioningPreviousStatus'
         - 'provisioningPreviousBotId'
         - 'provisioningStartedAt'),
       updated_at=NOW()
     WHERE id=$1 AND status='provisioning' AND telegram_bot_id=$2`,
    [
      reservation.instanceId,
      reservation.reservedBotId,
      reservation.previousStatus,
      reservation.previousBotId
    ]
  );
}

async function finalizeReservation(db, request, reply) {
  const reservation = request.uchihaAiBotReservation;
  if (!reservation) return;
  request.uchihaAiBotReservation = null;
  if (Number(reply?.statusCode || 500) >= 400) {
    await rollbackReservation(db, reservation).catch(() => undefined);
    return;
  }

  const row = (
    await db.query("SELECT status, telegram_bot_id FROM ai_bot_instances WHERE id=$1", [reservation.instanceId])
  ).rows[0];
  if (!row || row.status === "provisioning") {
    await rollbackReservation(db, reservation).catch(() => undefined);
    return;
  }
  if (String(row.telegram_bot_id || "") === reservation.reservedBotId) {
    await db.query(
      `UPDATE ai_bot_instances SET
         settings=(COALESCE(settings, '{}'::jsonb)
           - 'provisioningPreviousStatus'
           - 'provisioningPreviousBotId'
           - 'provisioningStartedAt'),
         updated_at=NOW()
       WHERE id=$1`,
      [reservation.instanceId]
    ).catch(() => undefined);
  }
}

export function installAiBotTokenOwnershipGuard(app, { db, config }) {
  app.addHook("preHandler", async (request, reply) => {
    if (String(request.method || "").toUpperCase() !== "POST") return;
    const match = /^\/api\/platform\/ai-bots\/([0-9a-f-]+)\/token$/i.exec(pathOf(request));
    if (!match) return;

    const owner = await authenticate(db, request);
    const botToken = String(request.body?.telegramBotToken || "").trim();
    if (!owner || !botToken) return;

    let instance = (
      await db.query("SELECT * FROM ai_bot_instances WHERE id=$1 AND user_id=$2", [match[1], owner.id])
    ).rows[0];
    if (!instance) return;

    instance = await restoreStaleProvisioning(db, instance);
    if (instance.status === "provisioning") {
      return reply.code(409).send({
        error: "provisioning_in_progress",
        message: "هناك عملية ربط Telegram قيد التنفيذ لهذا البوت. حاول مرة أخرى بعد قليل."
      });
    }

    const previousStatus = instance.status;
    const previousBotId = instance.telegram_bot_id || null;
    const locked = (
      await db.query(
        `UPDATE ai_bot_instances SET
           status='provisioning',
           settings=COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
             'provisioningPreviousStatus', status,
             'provisioningPreviousBotId', telegram_bot_id,
             'provisioningStartedAt', NOW()
           ),
           updated_at=NOW()
         WHERE id=$1 AND user_id=$2 AND status<>'provisioning'
         RETURNING id`,
        [instance.id, owner.id]
      )
    ).rows[0];
    if (!locked) {
      return reply.code(409).send({
        error: "provisioning_in_progress",
        message: "هناك عملية ربط Telegram قيد التنفيذ لهذا البوت. حاول مرة أخرى بعد قليل."
      });
    }

    let botInfo;
    try {
      botInfo = await new TelegramGateway(config, request.log).validateToken(botToken, "ai");
    } catch (error) {
      await db.query(
        `UPDATE ai_bot_instances SET
           status=$2,
           telegram_bot_id=$3,
           settings=(COALESCE(settings, '{}'::jsonb)
             - 'provisioningPreviousStatus'
             - 'provisioningPreviousBotId'
             - 'provisioningStartedAt'),
           updated_at=NOW()
         WHERE id=$1 AND status='provisioning'`,
        [instance.id, previousStatus, previousBotId]
      ).catch(() => undefined);
      return reply.code(422).send({
        error: "telegram_token_invalid",
        message: String(error?.message || "Telegram Bot Token غير صالح").slice(0, 500)
      });
    }

    const reservedBotId = String(botInfo.id);
    try {
      await db.query(
        `UPDATE ai_bot_instances SET telegram_bot_id=$3, updated_at=NOW()
         WHERE id=$1 AND user_id=$2 AND status='provisioning'`,
        [instance.id, owner.id, reservedBotId]
      );
    } catch (error) {
      await db.query(
        `UPDATE ai_bot_instances SET
           status=$2,
           telegram_bot_id=$3,
           settings=(COALESCE(settings, '{}'::jsonb)
             - 'provisioningPreviousStatus'
             - 'provisioningPreviousBotId'
             - 'provisioningStartedAt'),
           updated_at=NOW()
         WHERE id=$1 AND status='provisioning'`,
        [instance.id, previousStatus, previousBotId]
      ).catch(() => undefined);
      if (error?.code === "23505") {
        return reply.code(409).send({
          error: "telegram_bot_in_use",
          message: "هذا Telegram Bot مربوط بمنتج آخر. استخدم بوتًا آخر من BotFather أو عد إلى المنتج المرتبط به."
        });
      }
      throw error;
    }

    request.uchihaAiBotReservation = {
      instanceId: instance.id,
      reservedBotId,
      previousStatus,
      previousBotId
    };
  });

  app.addHook("onResponse", async (request, reply) => finalizeReservation(db, request, reply));
  app.addHook("onError", async (request, reply) => finalizeReservation(db, request, reply));
}
