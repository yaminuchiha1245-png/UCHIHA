import { createHash, randomBytes } from "node:crypto";

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function integerValue(value, fallback, { minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Invalid integer configuration: ${value}`);
  }
  return parsed;
}

function configuredValue(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "<empty string>" || /^\$\{\{[^}]+\}\}$/.test(text)) return "";
  return text;
}

function databaseConnection(env) {
  const candidates = [
    ["DATABASE_URL", env.DATABASE_URL],
    ["DATABASE_PRIVATE_URL", env.DATABASE_PRIVATE_URL],
    ["POSTGRES_URL", env.POSTGRES_URL],
    ["PGURL", env.PGURL]
  ];

  for (const [source, rawValue] of candidates) {
    const value = configuredValue(rawValue);
    if (value) return { url: value, source };
  }

  const host = configuredValue(env.PGHOST);
  const user = configuredValue(env.PGUSER);
  const password = configuredValue(env.PGPASSWORD);
  const database = configuredValue(env.PGDATABASE);
  if (!host || !user || !password || !database) return { url: "", source: "none" };

  const url = new URL("postgresql://localhost");
  url.hostname = host;
  url.port = configuredValue(env.PGPORT) || "5432";
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return { url: url.toString(), source: "PG*" };
}

function applicationBaseUrl(env, nodeEnv) {
  const explicit = configuredValue(env.APP_BASE_URL);
  if (explicit) return { url: explicit.replace(/\/+$/, ""), source: "APP_BASE_URL" };

  const railwayDomain =
    configuredValue(env.RAILWAY_PUBLIC_DOMAIN) || configuredValue(env.RAILWAY_STATIC_URL);
  if (railwayDomain) {
    const url = /^https?:\/\//i.test(railwayDomain) ? railwayDomain : `https://${railwayDomain}`;
    return { url: url.replace(/\/+$/, ""), source: "RAILWAY_PUBLIC_DOMAIN" };
  }

  return {
    url: nodeEnv === "production" ? "" : "http://localhost:4100",
    source: nodeEnv === "production" ? "none" : "development-default"
  };
}

function encryptionKey(mode, rawValue, { demoSeed = false, databaseUrl = "", nodeEnv = "development" } = {}) {
  if (rawValue) {
    const decoded = Buffer.from(rawValue, "base64");
    if (decoded.length !== 32) {
      throw new Error("APP_ENCRYPTION_KEY must decode to exactly 32 bytes");
    }
    return decoded;
  }
  if (mode === "memory" || nodeEnv === "test") {
    return randomBytes(32);
  }
  if (demoSeed && databaseUrl) {
    return createHash("sha256")
      .update("uchiha-builder-staging-key\u0000")
      .update(databaseUrl)
      .digest();
  }
  throw new Error("APP_ENCRYPTION_KEY is required outside memory/test mode");
}

export function loadConfig(env = process.env) {
  const nodeEnv = configuredValue(env.NODE_ENV) || "development";
  const demoSeed = booleanValue(env.DEMO_SEED);
  const database = databaseConnection(env);
  const requestedDatabaseMode =
    configuredValue(env.DATABASE_MODE) || (demoSeed && !database.url ? "memory" : "postgres");
  if (!["postgres", "memory"].includes(requestedDatabaseMode)) {
    throw new Error("DATABASE_MODE must be postgres or memory");
  }

  // Railway may deploy the web service before a cross-service reference becomes
  // available. Only an explicitly marked demo preview may use an isolated memory DB.
  const missingDatabasePreview = demoSeed && requestedDatabaseMode === "postgres" && !database.url;
  const databaseMode = missingDatabasePreview ? "memory" : requestedDatabaseMode;
  const databaseFallbackReason = missingDatabasePreview ? "missing_database_url" : "";

  if (nodeEnv === "production" && databaseMode !== "postgres" && !demoSeed) {
    throw new Error("Production cannot run with the in-memory database");
  }
  if (databaseMode === "postgres" && !database.url) {
    throw new Error("DATABASE_URL is required for PostgreSQL mode");
  }

  const baseUrl = applicationBaseUrl(env, nodeEnv);

  return {
    nodeEnv,
    port: integerValue(env.PORT, 4100, { minimum: 1, maximum: 65_535 }),
    host: configuredValue(env.HOST) || "0.0.0.0",
    databaseMode,
    databaseUrl: database.url,
    databaseSource: database.source,
    databaseFallbackReason,
    databaseSsl: booleanValue(env.DATABASE_SSL),
    databasePoolMax: integerValue(env.DATABASE_POOL_MAX, 10, { minimum: 1, maximum: 100 }),
    databaseIdleTimeoutMs: integerValue(env.DATABASE_IDLE_TIMEOUT_MS, 30_000, {
      minimum: 1_000,
      maximum: 600_000
    }),
    databaseConnectionTimeoutMs: integerValue(env.DATABASE_CONNECTION_TIMEOUT_MS, 10_000, {
      minimum: 1_000,
      maximum: 120_000
    }),
    databaseStatementTimeoutMs: integerValue(env.DATABASE_STATEMENT_TIMEOUT_MS, 30_000, {
      minimum: 1_000,
      maximum: 600_000
    }),
    appBaseUrl: baseUrl.url,
    appBaseUrlSource: baseUrl.source,
    storeBaseDomain: configuredValue(env.STORE_BASE_DOMAIN) || "uchiha.store",
    cookieSecure: booleanValue(env.COOKIE_SECURE, nodeEnv === "production"),
    encryptionKey: encryptionKey(databaseMode, configuredValue(env.APP_ENCRYPTION_KEY), {
      demoSeed,
      databaseUrl: database.url,
      nodeEnv
    }),
    allowDemoBilling: booleanValue(env.ALLOW_DEMO_BILLING, demoSeed),
    demoSeed,
    telegramMode: configuredValue(env.TELEGRAM_MODE) || (demoSeed ? "fake" : "live"),
    sessionHours: integerValue(env.SESSION_HOURS, 168, { minimum: 1, maximum: 8_760 }),
    rateLimitEnabled: booleanValue(env.RATE_LIMIT_ENABLED, nodeEnv === "production"),
    rateLimitWindowMs: integerValue(env.RATE_LIMIT_WINDOW_MS, 60_000, {
      minimum: 1_000,
      maximum: 3_600_000
    }),
    authRateLimitMax: integerValue(env.AUTH_RATE_LIMIT_MAX, 12, { minimum: 1, maximum: 100_000 }),
    purchaseRateLimitMax: integerValue(env.PURCHASE_RATE_LIMIT_MAX, 30, {
      minimum: 1,
      maximum: 100_000
    }),
    workerLeaseSeconds: integerValue(env.WORKER_LEASE_SECONDS, 600, {
      minimum: 30,
      maximum: 86_400
    }),
    offerSeed: {
      name: configuredValue(env.UCHIHA_FULL_NAME) || "UCHIHA Full",
      priceMinor: integerValue(env.UCHIHA_FULL_PRICE_MINOR, null),
      renewalPriceMinor: integerValue(env.UCHIHA_FULL_RENEWAL_PRICE_MINOR, null),
      currency: configuredValue(env.UCHIHA_FULL_CURRENCY) || "USD",
      durationUnit: configuredValue(env.UCHIHA_FULL_DURATION_UNIT) || null,
      durationCount: integerValue(env.UCHIHA_FULL_DURATION_COUNT, null),
      trialDays: integerValue(env.UCHIHA_FULL_TRIAL_DAYS, null)
    },
    platformAdminEmail: configuredValue(env.PLATFORM_ADMIN_EMAIL),
    platformAdminPassword: configuredValue(env.PLATFORM_ADMIN_PASSWORD),
    providerToken: configuredValue(env.UCHIHA_API_1_TOKEN),
    providerMode: configuredValue(env.UCHIHA_API_1_MODE) || "test",
    deployment: {
      environment: configuredValue(env.RAILWAY_ENVIRONMENT_NAME),
      service: configuredValue(env.RAILWAY_SERVICE_NAME),
      deploymentId: configuredValue(env.RAILWAY_DEPLOYMENT_ID),
      commitSha: configuredValue(env.RAILWAY_GIT_COMMIT_SHA)
    }
  };
}
