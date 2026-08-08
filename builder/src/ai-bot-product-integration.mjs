import { timingSafeEqual } from "node:crypto";
import { sha256 } from "./security.mjs";

function requestPath(request) {
  return String(request.raw?.url || request.url || "").split("?")[0].replace(/\/+$/, "") || "/";
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

async function catalogMetadata(db) {
  try {
    const rows = await db.query(
      `SELECT id, service_key, slug, is_catalog_product, catalog_category_slug,
              catalog_subcategory_slug, product_image_url, order_schema
       FROM platform_services
       WHERE tenant_id IS NULL AND store_id IS NULL AND is_catalog_product=TRUE`
    );
    return new Map(
      rows.rows.map((row) => [row.id, {
        isProduct: true,
        categorySlug: row.service_key === "ai-chatbot" ? "telegram-bots" : row.catalog_category_slug,
        subcategorySlug: row.service_key === "ai-chatbot" ? "ai-bots" : row.catalog_subcategory_slug,
        imageUrl: row.product_image_url || null,
        orderSchema: row.order_schema || {}
      }])
    );
  } catch (error) {
    if (["42P01", "42703"].includes(error?.code)) return new Map();
    throw error;
  }
}

async function claimTelegramUpdate(db, request, reply) {
  const path = requestPath(request);
  const match = /^\/webhooks\/ai-bots\/([0-9a-f-]+)$/i.exec(path);
  if (request.method !== "POST" || !match) return;
  const instanceId = match[1];
  const updateId = Number(request.body?.update_id);
  if (!Number.isSafeInteger(updateId) || updateId < 0) return;

  // Verify Telegram's secret before touching the idempotency ledger. Otherwise an
  // unauthenticated caller who guessed an instance UUID could poison update IDs.
  const instance = (
    await db.query(
      `SELECT webhook_secret_hash FROM ai_bot_instances
       WHERE id=$1 AND status='active' AND token_ciphertext IS NOT NULL`,
      [instanceId]
    )
  ).rows[0];
  const incomingSecret = String(request.headers["x-telegram-bot-api-secret-token"] || "").trim();
  if (!instance?.webhook_secret_hash || !incomingSecret) return;
  if (!secureEqual(sha256(incomingSecret), instance.webhook_secret_hash)) return;

  const claimed = await db.query(
    `INSERT INTO ai_bot_telegram_updates (
       instance_id, update_id, status, attempt_count, received_at
     ) VALUES ($1,$2,'processing',1,NOW())
     ON CONFLICT (instance_id, update_id) DO UPDATE SET
       status='processing',
       attempt_count=ai_bot_telegram_updates.attempt_count+1,
       received_at=NOW(),
       completed_at=NULL,
       last_error=NULL
     WHERE ai_bot_telegram_updates.status='failed'
        OR (
          ai_bot_telegram_updates.status='processing'
          AND ai_bot_telegram_updates.received_at < NOW() - INTERVAL '2 minutes'
        )
     RETURNING instance_id, update_id, attempt_count`,
    [instanceId, updateId]
  );
  if (!claimed.rows[0]) {
    return reply.code(200).send({ ok: true, duplicate: true });
  }
  request.uchihaAiTelegramUpdate = { instanceId, updateId };
}

async function finishTelegramUpdate(db, request, reply) {
  const claim = request.uchihaAiTelegramUpdate;
  if (!claim) return;
  const completed = Number(reply.statusCode || 500) < 500;
  try {
    await db.query(
      `UPDATE ai_bot_telegram_updates SET
         status=$3,
         completed_at=CASE WHEN $3='completed' THEN NOW() ELSE NULL END,
         last_error=CASE WHEN $3='failed' THEN $4 ELSE NULL END
       WHERE instance_id=$1 AND update_id=$2`,
      [
        claim.instanceId,
        claim.updateId,
        completed ? "completed" : "failed",
        completed ? null : `HTTP ${Number(reply.statusCode || 500)}`
      ]
    );
  } catch (error) {
    request.log?.error?.({ error, claim }, "Failed to finalize AI Telegram update ledger");
  }
}

export function installAiBotProductIntegration(app, { db, config = {} }) {
  app.get("/product/ai-chatbot", async (_request, reply) => reply.sendFile("ai-bot-product.html"));

  app.addHook("preHandler", async (request, reply) => claimTelegramUpdate(db, request, reply));
  app.addHook("onResponse", async (request, reply) => finishTelegramUpdate(db, request, reply));

  app.addHook("preSerialization", async (request, _reply, payload) => {
    const path = requestPath(request);
    if (request.method === "GET" && path === "/api/public/portal" && payload?.services) {
      const catalog = await catalogMetadata(db);
      return {
        ...payload,
        services: payload.services.map((service) => {
          const metadata = catalog.get(service.id);
          return metadata
            ? {
                ...service,
                isCatalogProduct: true,
                catalogCategorySlug: metadata.categorySlug,
                catalogSubcategorySlug: metadata.subcategorySlug,
                productImageUrl: metadata.imageUrl,
                catalog: metadata
              }
            : service;
        })
      };
    }

    // The merchant can see whether the shared AI service is ready, but billing for
    // the platform-owned OpenAI account remains visible only to platform admins.
    if (
      request.method === "GET" &&
      /^\/api\/platform\/ai-bots\/[0-9a-f-]+$/i.test(path) &&
      payload?.openAi
    ) {
      return {
        ...payload,
        openAi: { configured: Boolean(payload.openAi.configured) }
      };
    }

    if (
      request.method === "GET" &&
      path === "/api/platform/admin/ai-product" &&
      payload?.openAi &&
      config.platformOpenAiBillingUrl
    ) {
      const today = (
        await db.query(
          `SELECT COUNT(*)::int AS count
           FROM ai_bot_usage
           WHERE status='completed' AND created_at>=CURRENT_DATE`
        )
      ).rows[0];
      return {
        ...payload,
        openAi: {
          ...payload.openAi,
          billingUrl: config.platformOpenAiBillingUrl,
          dailyRequestLimit: Number(config.aiPlatformDailyRequestLimit || 50_000),
          dailyRequestsUsed: Number(today?.count || 0)
        }
      };
    }
    return payload;
  });
}