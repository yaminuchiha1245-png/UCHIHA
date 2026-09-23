import fs from "node:fs";
import path from "node:path";

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function asInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(overrides = {}) {
  const envPath = overrides.envPath ?? path.resolve(process.cwd(), ".env");
  const fileEnv = parseEnvFile(envPath);
  const env = { ...fileEnv, ...process.env, ...overrides };
  const nodeEnv = env.NODE_ENV ?? "development";
  const config = {
    nodeEnv,
    host: env.HOST ?? "127.0.0.1",
    port: asInteger(env.PORT, 8787),
    publicBaseUrl: env.PUBLIC_BASE_URL ?? "http://127.0.0.1:8787",
    databaseDriver: env.DATABASE_DRIVER ?? "sqlite",
    databasePath: path.resolve(process.cwd(), env.DATABASE_PATH ?? "./data/uchiha-radius.sqlite"),
    databaseUrl: env.DATABASE_URL ?? "",
    platformDatabaseUrl: env.PLATFORM_DATABASE_URL ?? env.DATABASE_URL ?? "",
    migrationDatabaseUrl: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL ?? "",
    logLevel: env.LOG_LEVEL ?? "info",
    googleClientId: env.GOOGLE_CLIENT_ID ?? "",
    bootstrapOwnerEmail: String(env.BOOTSTRAP_OWNER_EMAIL ?? "owner@example.com").toLowerCase(),
    sessionTtlHours: asInteger(env.SESSION_TTL_HOURS, 12),
    allowDevAuth: asBoolean(env.ALLOW_DEV_AUTH, nodeEnv !== "production"),
    requireInstallationBinding: asBoolean(env.REQUIRE_INSTALLATION_BINDING, nodeEnv === "production"),
    encryptionKey: env.APP_ENCRYPTION_KEY ?? "",
    connectorSigningSecret: env.CONNECTOR_SIGNING_SECRET ?? "",
    billingWebhookSecret: env.BILLING_WEBHOOK_SECRET ?? "",
    billingCheckoutEndpoint: env.BILLING_CHECKOUT_ENDPOINT ?? "",
    billingCheckoutToken: env.BILLING_CHECKOUT_TOKEN ?? "",
    billingCheckoutAllowedHosts: String(env.BILLING_CHECKOUT_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
    telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? (env.CREDENTIALS_DIRECTORY
      ? fs.readFileSync(path.join(env.CREDENTIALS_DIRECTORY, "telegram-token"), "utf8").trim()
      : ""),
    telegramWebhookSecret: env.TELEGRAM_WEBHOOK_SECRET ?? "",
    telegramBotUsername: /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(env.TELEGRAM_BOT_USERNAME || "")
      ? env.TELEGRAM_BOT_USERNAME : "",
    outboxWorkerEnabled: asBoolean(env.OUTBOX_WORKER_ENABLED, nodeEnv !== "test"),
    metricsToken: env.METRICS_TOKEN ?? "",
    trustProxy: asBoolean(env.TRUST_PROXY, false),
    corsOrigins: String(env.CORS_ORIGINS ?? "http://127.0.0.1:8787")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  };

  validateConfig(config);
  return Object.freeze(config);
}

export function validateConfig(config) {
  if (!["sqlite", "postgres"].includes(config.databaseDriver)) {
    throw new Error("DATABASE_DRIVER must be sqlite or postgres");
  }
  if (config.databaseDriver === "postgres" && !config.databaseUrl) {
    throw new Error("DATABASE_URL is required for PostgreSQL");
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  if (!Number.isInteger(config.sessionTtlHours) || config.sessionTtlHours < 1 || config.sessionTtlHours > 168) {
    throw new Error("SESSION_TTL_HOURS must be between 1 and 168");
  }
  if (!Array.isArray(config.corsOrigins) || !config.corsOrigins.length || config.corsOrigins.includes("*")) {
    throw new Error("CORS_ORIGINS must contain explicit origins");
  }
  if (config.nodeEnv !== "production") return;

  const failures = [];
  if (config.databaseDriver !== "postgres") failures.push("production requires PostgreSQL");
  if (!config.platformDatabaseUrl) failures.push("PLATFORM_DATABASE_URL is missing");
  if (!config.migrationDatabaseUrl) failures.push("MIGRATION_DATABASE_URL is missing");
  if (config.platformDatabaseUrl === config.databaseUrl) failures.push("PLATFORM_DATABASE_URL must use a separate database role");
  if (config.migrationDatabaseUrl === config.databaseUrl || config.migrationDatabaseUrl === config.platformDatabaseUrl) failures.push("MIGRATION_DATABASE_URL must use a separate database role");
  if (config.allowDevAuth) failures.push("ALLOW_DEV_AUTH must be false");
  if (!config.requireInstallationBinding) failures.push("REQUIRE_INSTALLATION_BINDING must be true");
  if (!/^https:\/\//.test(config.publicBaseUrl)) failures.push("PUBLIC_BASE_URL must use HTTPS");
  if (!config.googleClientId || config.googleClientId.startsWith("replace-")) failures.push("GOOGLE_CLIENT_ID is missing");
  if (!config.trustProxy) failures.push("TRUST_PROXY must be true behind the production reverse proxy");
  if (config.corsOrigins.some((origin) => !/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(origin))) failures.push("CORS_ORIGINS must use explicit HTTPS origins");
  if (!/^[a-f0-9]{64}$/i.test(config.encryptionKey)) failures.push("APP_ENCRYPTION_KEY must be 64 hex characters");
  if (config.connectorSigningSecret && config.connectorSigningSecret.length < 32) failures.push("CONNECTOR_SIGNING_SECRET must have at least 32 characters when set");
  if (config.billingWebhookSecret.length < 32) failures.push("BILLING_WEBHOOK_SECRET must have at least 32 characters");
  if (Boolean(config.billingCheckoutEndpoint) !== Boolean(config.billingCheckoutToken)) failures.push("BILLING_CHECKOUT_ENDPOINT and BILLING_CHECKOUT_TOKEN must be configured together");
  if (config.billingCheckoutEndpoint && !/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[^\s]*)?$/.test(config.billingCheckoutEndpoint)) failures.push("BILLING_CHECKOUT_ENDPOINT must use HTTPS");
  if (config.billingCheckoutToken && config.billingCheckoutToken.length < 24) failures.push("BILLING_CHECKOUT_TOKEN must have at least 24 characters");
  if (config.billingCheckoutEndpoint && !config.billingCheckoutAllowedHosts?.length) failures.push("BILLING_CHECKOUT_ALLOWED_HOSTS is required when checkout is enabled");
  if (config.billingCheckoutAllowedHosts?.some((host) => !/^[a-z0-9.-]+$/.test(host) || host.startsWith(".") || host.endsWith("."))) failures.push("BILLING_CHECKOUT_ALLOWED_HOSTS contains an invalid hostname");
  if (Boolean(config.telegramBotToken) !== Boolean(config.telegramWebhookSecret)) failures.push("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be configured together");
  if (config.telegramBotToken && !/^\d{6,12}:[A-Za-z0-9_-]{20,}$/.test(config.telegramBotToken)) failures.push("TELEGRAM_BOT_TOKEN format is invalid");
  if (config.telegramWebhookSecret && !/^[A-Za-z0-9_-]{16,256}$/.test(config.telegramWebhookSecret)) failures.push("TELEGRAM_WEBHOOK_SECRET format is invalid");
  if (config.metricsToken.length < 24) failures.push("METRICS_TOKEN must have at least 24 characters");
  if (failures.length) throw new Error(`Unsafe production configuration: ${failures.join("; ")}`);
}
