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

export function installAiProductActivationGuard(app, { db, config }) {
  app.addHook("preHandler", async (request, reply) => {
    if (
      request.method !== "PATCH" ||
      pathOf(request) !== "/api/platform/admin/ai-product" ||
      String(request.body?.status || "") !== "active"
    ) return;

    const blockers = runtimeBlockers(config);
    const migration = (
      await db.query(
        "SELECT 1 FROM schema_migrations WHERE version='032_ai_bot_telegram_identity_unique' LIMIT 1"
      )
    ).rows[0];
    if (!migration) blockers.push("Migration 032");

    if (blockers.length) {
      return reply.code(409).send({
        error: "ai_product_launch_not_ready",
        message: `لا يمكن فتح بيع بوت AI قبل اكتمال بيئة الإنتاج: ${blockers.join("، ")}`,
        blockers
      });
    }
  });
}

export { publicHttps, runtimeBlockers };
