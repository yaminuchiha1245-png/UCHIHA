import { sha256 } from "./security.mjs";

const SESSION_COOKIE = "uchiha_builder_session";
const TELEGRAM_IDENTITY_MIGRATION = "032_ai_bot_telegram_identity_unique";
const PROMPT_LEASE_MIGRATION = "033_ai_bot_prompt_leases";
const TELEGRAM_IDENTITY_INDEX = "idx_ai_bot_instances_telegram_bot_id_unique";
const PROMPT_LEASE_TABLE = "ai_bot_prompt_leases";

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
         EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1) AS identity_migration_applied,
         EXISTS(SELECT 1 FROM schema_migrations WHERE version=$2) AS prompt_lease_migration_applied,
         to_regclass($3) IS NOT NULL AS unique_index_present,
         to_regclass($4) IS NOT NULL AS prompt_lease_table_present`,
      [
        TELEGRAM_IDENTITY_MIGRATION,
        PROMPT_LEASE_MIGRATION,
        `public.${TELEGRAM_IDENTITY_INDEX}`,
        `public.${PROMPT_LEASE_TABLE}`
      ]
    )
  ).rows[0] || {};
  const blockers = [];
  if (!row.identity_migration_applied) blockers.push("Migration 032");
  if (!row.unique_index_present) blockers.push("Telegram identity unique index");
  if (!row.prompt_lease_migration_applied) blockers.push("Migration 033");
  if (!row.prompt_lease_table_present) blockers.push("AI prompt lease table");
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

async function productPatchState(db, request) {
  const current = (
    await db.query(
      `SELECT status, starting_price_minor, currency
       FROM platform_services
       WHERE service_key='ai-chatbot' AND tenant_id IS NULL AND store_id IS NULL
       LIMIT 1`
    )
  ).rows[0] || null;
  if (!current) return { status: "", priceMinor: null, currency: "" };
  const body = request.body || {};
  return {
    status: String(body.status ?? current.status ?? "").trim(),
    priceMinor: body.priceMinor === undefined ? current.starting_price_minor : body.priceMinor,
    currency: String(body.currency ?? current.currency ?? "").trim().toUpperCase()
  };
}

function productStateBlockers(state) {
  const blockers = [];
  const price = Number(state?.priceMinor);
  if (!Number.isSafeInteger(price) || price <= 0) blockers.push("Product price");
  if (!/^[A-Z]{3}$/.test(String(state?.currency || ""))) blockers.push("Product currency");
  return blockers;
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

    let patchBlockers = [];
    if (isProductPatch) {
      if (!session.is_platform_admin) return;
      const finalState = await productPatchState(db, request);
      if (finalState.status !== "active") return;
      patchBlockers = productStateBlockers(finalState);
    }

    const blockers = [...new Set([...(await launchBlockers(db, config)), ...patchBlockers])];
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

export {
  publicHttps,
  runtimeBlockers,
  schemaBlockers,
  launchBlockers,
  productPatchState,
  productStateBlockers
};
