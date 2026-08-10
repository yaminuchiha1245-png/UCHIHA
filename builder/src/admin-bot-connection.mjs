import { randomUUID } from "node:crypto";
import { TelegramGateway } from "./telegram.mjs";
import {
  encryptSecret,
  maskSecret,
  randomToken,
  safeText,
  sha256
} from "./security.mjs";

const SESSION_COOKIE = "uchiha_builder_session";

class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requiredText(value, field, maxLength = 250) {
  const text = safeText(value, maxLength);
  if (!text) throw new ApiError(422, "missing_field", `الحقل ${field} مطلوب`);
  return text;
}

function jsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object" && !Array.isArray(value)) return { ...value };
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function authenticate(db, request) {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) throw new ApiError(401, "authentication_required", "يجب تسجيل الدخول");
  const result = await db.query(
    `SELECT u.*, s.csrf_hash, s.expires_at
     FROM sessions s
     JOIN platform_users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
       AND u.status = 'active'`,
    [sha256(token)]
  );
  const user = result.rows[0];
  if (!user) throw new ApiError(401, "invalid_session", "انتهت الجلسة أو ألغيت");
  return user;
}

function requireCsrf(request, user) {
  const token = request.headers?.["x-csrf-token"];
  if (!token || sha256(token) !== user.csrf_hash) {
    throw new ApiError(403, "csrf_failed", "تعذر التحقق من الطلب");
  }
}

async function requireOwnerStore(db, user, storeId) {
  const result = await db.query(
    `SELECT s.*, tm.role_key
     FROM stores s
     JOIN tenant_memberships tm ON tm.tenant_id=s.tenant_id
     WHERE s.id=$1 AND tm.user_id=$2 AND tm.status='active'`,
    [storeId, user.id]
  );
  const store = result.rows[0];
  if (!store) throw new ApiError(404, "store_not_found", "المتجر غير موجود");
  if (store.role_key !== "owner") {
    throw new ApiError(403, "owner_required", "ربط بوت الإدارة متاح لمالك المتجر فقط");
  }
  return store;
}

function botDto(row, ownerTelegramId = null) {
  if (!row) return { connected: false, ownerTelegramId: ownerTelegramId || null };
  return {
    connected: true,
    id: row.id,
    purpose: "admin",
    username: row.username,
    telegramBotId: String(row.telegram_bot_id),
    token: row.token_masked,
    status: row.status,
    ownerTelegramId: ownerTelegramId || null,
    lastCheckedAt: row.last_checked_at || null
  };
}

export function installAdminBotConnectionRoutes(app, { db, config }) {
  app.get("/api/stores/:storeId/admin-bot", async (request) => {
    const user = await authenticate(db, request);
    const store = await requireOwnerStore(db, user, request.params.storeId);
    const connection = (
      await db.query(
        `SELECT id, telegram_bot_id, username, token_masked, status, last_checked_at
         FROM bot_connections
         WHERE tenant_id=$1 AND store_id=$2 AND purpose='admin'
         LIMIT 1`,
        [store.tenant_id, store.id]
      )
    ).rows[0];
    const contactData = jsonObject(store.contact_data, {});
    return { bot: botDto(connection, contactData.telegramOwnerId) };
  });

  app.post("/api/stores/:storeId/admin-bot", async (request) => {
    const user = await authenticate(db, request);
    requireCsrf(request, user);
    const store = await requireOwnerStore(db, user, request.params.storeId);
    const body = request.body || {};
    const adminToken = requiredText(body.adminToken, "توكن بوت الإدارة", 250);
    const ownerTelegramId = requiredText(body.ownerTelegramId, "معرف المالك في تيليجرام", 40);
    if (!/^\d{4,20}$/.test(ownerTelegramId)) {
      throw new ApiError(422, "invalid_owner_telegram_id", "معرف تيليجرام يجب أن يكون أرقامًا فقط");
    }

    const gateway = new TelegramGateway(config, request.log);
    let profile;
    try {
      profile = await gateway.validateToken(adminToken, "admin");
    } catch (error) {
      throw new ApiError(422, "telegram_token_invalid", error?.message || "توكن بوت الإدارة غير صالح");
    }

    const tokenFingerprint = sha256(adminToken);
    const collision = (
      await db.query(
        `SELECT id, store_id, purpose
         FROM bot_connections
         WHERE (telegram_bot_id=$1 OR token_fingerprint=$2)
           AND NOT (store_id=$3 AND purpose='admin')
         LIMIT 1`,
        [String(profile.id), tokenFingerprint, store.id]
      )
    ).rows[0];
    if (collision) {
      throw new ApiError(409, "telegram_bot_in_use", "هذا البوت مربوط مسبقًا بمتجر أو قناة أخرى");
    }

    const existing = (
      await db.query(
        `SELECT * FROM bot_connections
         WHERE tenant_id=$1 AND store_id=$2 AND purpose='admin'
         LIMIT 1`,
        [store.tenant_id, store.id]
      )
    ).rows[0];
    const connectionId = existing?.id || randomUUID();
    const webhookSecret = randomToken(32);
    const encryptedToken = encryptSecret(adminToken, config.encryptionKey);
    const encryptedWebhookSecret = encryptSecret(webhookSecret, config.encryptionKey);
    const maskedToken = maskSecret(adminToken);

    await db.transaction(async (client) => {
      if (existing) {
        await client.query(
          `UPDATE bot_connections
           SET telegram_bot_id=$1, username=$2, token_ciphertext=$3,
               token_fingerprint=$4, token_masked=$5,
               webhook_secret_ciphertext=$6, webhook_secret_hash=$7,
               status='validated', last_checked_at=NOW(), updated_at=NOW()
           WHERE id=$8 AND tenant_id=$9 AND store_id=$10 AND purpose='admin'`,
          [
            String(profile.id),
            profile.username,
            encryptedToken,
            tokenFingerprint,
            maskedToken,
            encryptedWebhookSecret,
            sha256(webhookSecret),
            connectionId,
            store.tenant_id,
            store.id
          ]
        );
      } else {
        await client.query(
          `INSERT INTO bot_connections (
             id, tenant_id, store_id, purpose, telegram_bot_id, username,
             token_ciphertext, token_fingerprint, token_masked,
             webhook_secret_ciphertext, webhook_secret_hash, status, last_checked_at
           ) VALUES ($1,$2,$3,'admin',$4,$5,$6,$7,$8,$9,$10,'validated',NOW())`,
          [
            connectionId,
            store.tenant_id,
            store.id,
            String(profile.id),
            profile.username,
            encryptedToken,
            tokenFingerprint,
            maskedToken,
            encryptedWebhookSecret,
            sha256(webhookSecret)
          ]
        );
      }

      const contactData = jsonObject(store.contact_data, {});
      contactData.telegramOwnerId = ownerTelegramId;
      await client.query(
        "UPDATE stores SET contact_data=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3",
        [contactData, store.id, store.tenant_id]
      );

      await client.query(
        `INSERT INTO audit_logs (
           id, tenant_id, actor_user_id, action, entity_type, entity_id,
           ip_address, after_data
         ) VALUES ($1,$2,$3,'admin_bot.validated','bot_connection',$4,$5,$6)`,
        [
          randomUUID(),
          store.tenant_id,
          user.id,
          connectionId,
          request.ip,
          { username: profile.username, telegramBotId: String(profile.id), ownerTelegramId }
        ]
      );
    }, store.tenant_id);

    try {
      await gateway.setWebhook(adminToken, connectionId, webhookSecret);
    } catch (error) {
      request.log?.error?.(
        { storeId: store.id, connectionId, message: String(error?.message || error) },
        "Admin bot webhook setup failed"
      );
      throw new ApiError(
        502,
        "telegram_webhook_failed",
        "تم التحقق من البوت وحفظه، لكن تعذر تشغيل Webhook. أعد الضغط على الربط بعد التأكد من رابط المنصة."
      );
    }

    await db.transaction(async (client) => {
      await client.query(
        `UPDATE bot_connections
         SET status='active', last_checked_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND purpose='admin'`,
        [connectionId, store.tenant_id, store.id]
      );
      await client.query(
        `UPDATE project_components
         SET status='active', updated_at=NOW()
         WHERE project_id IN (SELECT id FROM platform_projects WHERE tenant_id=$1)
           AND service_key='admin_bot'`,
        [store.tenant_id]
      );
      await client.query(
        `INSERT INTO audit_logs (
           id, tenant_id, actor_user_id, action, entity_type, entity_id,
           ip_address, after_data
         ) VALUES ($1,$2,$3,'admin_bot.connected','bot_connection',$4,$5,$6)`,
        [
          randomUUID(),
          store.tenant_id,
          user.id,
          connectionId,
          request.ip,
          { username: profile.username, status: "active" }
        ]
      );
    }, store.tenant_id);

    return {
      bot: botDto(
        {
          id: connectionId,
          telegram_bot_id: String(profile.id),
          username: profile.username,
          token_masked: maskedToken,
          status: "active",
          last_checked_at: new Date().toISOString()
        },
        ownerTelegramId
      )
    };
  });
}
