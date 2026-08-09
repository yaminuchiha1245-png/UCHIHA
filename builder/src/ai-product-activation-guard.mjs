import { sha256 } from "./security.mjs";

const SESSION_COOKIE = "uchiha_builder_session";
const REQUIRED_MIGRATION = "032_ai_bot_telegram_identity_unique";
const REQUIRED_INDEX = "idx_ai_bot_instances_telegram_bot_id_unique";

function pathOf(request) {
  return String(request.raw?.url || request.url || "")
    .split("?")[0]
    .replace(/\/+$/, "") || "/";
}

function publicHttps(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (/^(?:127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    return host !== "::1" && host !== "[::1]";
  } catch {
    return false;
  }
}

function runtimeBlockers(config) {
  const blockers = [];
  if (config.nodeEnv !== "production") blockers.push("NODE_ENV");
  if (config.databaseMode !== "postgres" || !config.databaseUrl || !config.requirePersistentDatabase) blockers.push("PostgreSQL");
  if (!publicHttps(config.appBaseUrl)) blockers.push("HTTPS");
  if (!config.cookieSecure) blockers.push("Secure Cookie");
  if (config.telegramMode !== "live") blockers.push("Telegram live");
  if (!config.rateLimitEnabled) blockers.push("Rate Limit");
  if (config.previewMemoryMode || config.demoSeed || config.allowDemoBilling) blockers.push("Demo mode");
  return blockers;
}

async function authenticatedSession(db, request) {
  const sessionToken = request.cookies?.[SESSION_COOKIE];
  const csrfToken = String(request.headers["x-csrf-token"] || "");
  if (!sessionToken || !csrfToken) return null;
  const row = (
    await db.query(
      `SELECT u.id, u.is_platform_admin, s.csrf_hash
       FROM sessions s
       JOIN platform_users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL
         AND s.expires_at>NOW() AND u.status='active'`,
      [sha256(sessionToken)]
    )
  ).rows[0];
  if (!row?.csrf_hash || sha256(csrfToken) !== row.csrf_hash) return null;
  return row;
}

async function schemaBlockers(db, config) {
  if (config.databaseMode !== "postgres") return ["PostgreSQL"];
  const row = (
    await db.query(
      `SELECT
         EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1) AS migration_applied,
         to_regclass($2) IS NOT NULL AS unique_index_present`,
      [REQUIRED_MIGRATION, `public.${REQUIRED_INDEX}`]
    )
  ).rows[0] || {};
  const blockers = [];
  if (!row.migration_applied) blockers.push("Migration 032");
  if (!row.unique_index_present) blockers.push("Telegram identity unique index");
  return blockers;
}

async function launchBlockers(db, config) {
  const blockers = runtimeBlockers(config);
  if (blockers.includes("PostgreSQL")) return blockers;
  try {
    blockers.push(...await schemaBlockers(db, config));
  } catch {
    blockers.push("Launch schema");
  }
  return [...new Set(blockers)];
}

export function installAiProductActivationGuard(app, { db, config }) {
  app.addHook("preHandler", async (request, reply) => {
    const method = String(request.method || "").toUpperCase();
    const path = pathOf(request);
    const isPurchase = method === "POST" && path === "/api/platform/ai-bots/purchase";
    const isProductPatch = method === "PATCH" && path === "/api/platform/admin/ai-product";
    if (!isPurchase && !isProductPatch) return;

    // Let the canonical route produce its normal 401/403 response for bad sessions.
    const session = await authenticatedSession(db, request);
    if (!session) return;

    if (isProductPatch) {
      if (!session.is_platform_admin) return;
      let finalStatus = String(request.body?.status || "").trim();
      if (!finalStatus) {
        finalStatus = String((
          await db.query(
            `SELECT status FROM platform_services
             WHERE service_key='ai-chatbot' AND tenant_id IS NULL AND store_id IS NULL
             LIMIT 1`
          )
        ).rows[0]?.status || "");
      }
      if (finalStatus !== "active") return;
    }

    const blockers = await launchBlockers(db, config);
    if (!blockers.length) return;

    if (isPurchase) {
      return reply.code(503).send({
        error: "ai_product_launch_not_ready",
        message: "منتج بوت الذكاء الاصطناعي غير متاح للشراء حاليًا. حاول لاحقًا."
      });
    }

    return reply.code(409).send({
      error: "ai_product_launch_not_ready",
      message: `لا يمكن فتح بيع بوت AI قبل اكتمال بيئة الإنتاج: ${blockers.join("، ")}`,
      blockers
    });
  });
}

export { publicHttps, runtimeBlockers, schemaBlockers, launchBlockers };
