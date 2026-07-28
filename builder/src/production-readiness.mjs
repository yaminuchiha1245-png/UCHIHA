import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";

function present(value) {
  const text = String(value ?? "").trim();
  return Boolean(text && !/^\$\{\{[^}]+\}\}$/.test(text));
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function evaluateProductionReadiness(config, env = process.env) {
  const blockers = [];
  const warnings = [];
  const block = (code, message) => blockers.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });

  if (config.nodeEnv !== "production") {
    block("node_env", "NODE_ENV must be production");
  }
  if (config.databaseMode !== "postgres" || !config.databaseUrl) {
    block("persistent_database", "A persistent PostgreSQL connection is required");
  }
  if (!isHttpsUrl(config.appBaseUrl)) {
    block("https_base_url", "APP_BASE_URL or RAILWAY_PUBLIC_DOMAIN must resolve to HTTPS");
  }
  if (!config.cookieSecure) {
    block("secure_cookies", "COOKIE_SECURE must be enabled");
  }
  if (!config.rateLimitEnabled) {
    block("rate_limit", "RATE_LIMIT_ENABLED must be enabled");
  }
  if (config.demoSeed) {
    block("demo_seed", "DEMO_SEED must be disabled for production");
  }
  if (config.allowDemoBilling) {
    block("demo_billing", "ALLOW_DEMO_BILLING must be disabled for production");
  }
  if (!present(env.APP_ENCRYPTION_KEY)) {
    block("encryption_key", "A dedicated APP_ENCRYPTION_KEY is required");
  }
  if (config.telegramMode !== "live") {
    warn("telegram_mode", "Telegram remains in fake mode");
  }
  if (config.providerMode !== "live") {
    warn("provider_mode", "UCHIHA API 1 remains in test mode");
  }
  if (config.databasePoolMax > 20) {
    warn("database_pool", "DATABASE_POOL_MAX is high for a small Railway PostgreSQL plan");
  }
  if (!present(config.storeBaseDomain) || config.storeBaseDomain === "uchiha.store") {
    warn("store_domain", "Set the final store base domain before custom-domain launch");
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    environment: {
      nodeEnv: config.nodeEnv,
      databaseMode: config.databaseMode,
      databaseSource: config.databaseSource,
      appBaseUrl: config.appBaseUrl,
      appBaseUrlSource: config.appBaseUrlSource,
      cookieSecure: config.cookieSecure,
      rateLimitEnabled: config.rateLimitEnabled,
      demoSeed: config.demoSeed,
      allowDemoBilling: config.allowDemoBilling,
      telegramMode: config.telegramMode,
      providerMode: config.providerMode,
      deployment: config.deployment
    }
  };
}

async function main() {
  try {
    const config = loadConfig();
    const result = evaluateProductionReadiness(config);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ready) process.exitCode = 1;
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          ready: false,
          blockers: [{ code: "configuration_error", message: error.message }],
          warnings: []
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  }
}

const executedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (executedFile === fileURLToPath(import.meta.url)) await main();
