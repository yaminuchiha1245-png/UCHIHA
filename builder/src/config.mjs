import { randomBytes } from "node:crypto";

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

function encryptionKey(mode, rawValue, { nodeEnv = "development" } = {}) {
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
  throw new Error("APP_ENCRYPTION_KEY is required outside memory/test mode");
}

function providerConfiguration(env, previewMemoryMode) {
  if (previewMemoryMode) {
    return { mode: "test", adapterKey: "mock", baseUrl: "", token: "" };
  }
  const mode = configuredValue(env.UCHIHA_API_1_MODE) || "test";
  if (!new Set(["test", "live"]).has(mode)) {
    throw new Error("UCHIHA_API_1_MODE must be test or live");
  }
  const adapterKey = configuredValue(env.UCHIHA_API_1_ADAPTER) || "mock";
  if (!new Set(["mock", "http-json-v1"]).has(adapterKey)) {
    throw new Error("UCHIHA_API_1_ADAPTER is not supported");
  }
  const candidate = configuredValue(env.UCHIHA_API_1_BASE_URL);
  let baseUrl = "";
  if (candidate) {
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error("UCHIHA_API_1_BASE_URL must be a valid HTTPS URL");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("UCHIHA_API_1_BASE_URL must be a clean HTTPS URL");
    }
    baseUrl = parsed.toString().replace(/\/$/, "");
  }
  const token = configuredValue(env.UCHIHA_API_1_TOKEN);
  if (mode === "live" && (adapterKey === "mock" || !baseUrl || !token)) {
    throw new Error("Live UCHIHA API requires http-json-v1, an HTTPS base URL, and a token");
  }
  return { mode, adapterKey, baseUrl, token };
}

export function loadConfig(env = process.env) {
  const nodeEnv = configuredValue(env.NODE_ENV) || "development";
  const previewMemoryMode = booleanValue(env.PREVIEW_MEMORY_MODE);
  const requirePersistentDatabase = booleanValue(
    env.REQUIRE_PERSISTENT_DATABASE,
    nodeEnv === "production" && !previewMemoryMode
  );
  if (previewMemoryMode && requirePersistentDatabase) {
    throw new Error("PREVIEW_MEMORY_MODE and REQUIRE_PERSISTENT_DATABASE cannot both be enabled");
  }

  const demoSeed = previewMemoryMode || booleanValue(env.DEMO_SEED);
  const database = databaseConnection(env);
  const requestedDatabaseMode = previewMemoryMode
    ? "memory"
    : configuredValue(env.DATABASE_MODE) ||
      (database.url ? "postgres" : demoSeed && !requirePersistentDatabase ? "memory" : "postgres");
  if (!["postgres", "memory"].includes(requestedDatabaseMode)) {
    throw new Error("DATABASE_MODE must be postgres or memory");
  }

  const databaseMode = requestedDatabaseMode;
  const databaseFallbackReason = previewMemoryMode ? "preview_memory_mode" : "";

  if (requirePersistentDatabase && databaseMode !== "postgres") {
    throw new Error("A persistent PostgreSQL database is required");
  }
  if (nodeEnv === "production" && databaseMode !== "postgres" && !previewMemoryMode) {
    throw new Error("Production cannot run with the in-memory database unless PREVIEW_MEMORY_MODE=true");
  }
  if (databaseMode === "postgres" && !database.url) {
    throw new Error("DATABASE_URL is required for PostgreSQL mode");
  }

  const baseUrl = applicationBaseUrl(env, nodeEnv);
  const provider = providerConfiguration(env, previewMemoryMode);

  return {
    nodeEnv,
    port: integerValue(env.PORT, 4100, { minimum: 1, maximum: 65_535 }),
    host: configuredValue(env.HOST) || "0.0.0.0",
    databaseMode,
    databaseUrl: databaseMode === "postgres" ? database.url : "",
    databaseSource: databaseMode === "postgres" ? database.source : "none",
    databaseFallbackReason,
    previewMemoryMode,
    requirePersistentDatabase,
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
    platformWhatsappNumber:
      configuredValue(env.PLATFORM_WHATSAPP_NUMBER) || "+963942586044",
    cookieSecure: booleanValue(env.COOKIE_SECURE, nodeEnv === "production"),
    encryptionKey: encryptionKey(databaseMode, configuredValue(env.APP_ENCRYPTION_KEY), { nodeEnv }),
    allowDemoBilling: previewMemoryMode ? true : booleanValue(env.ALLOW_DEMO_BILLING, demoSeed),
    demoSeed,
    telegramMode: previewMemoryMode
      ? "fake"
      : configuredValue(env.TELEGRAM_MODE) || (demoSeed ? "fake" : "live"),
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
    webhookRateLimitMax: integerValue(env.WEBHOOK_RATE_LIMIT_MAX, 120, {
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
    platformAdminEmail:
      configuredValue(env.PLATFORM_ADMIN_EMAIL) ||
      (previewMemoryMode ? "preview-admin@uchiha.local" : ""),
    platformAdminPassword:
      configuredValue(env.PLATFORM_ADMIN_PASSWORD) ||
      (previewMemoryMode ? `${randomBytes(24).toString("base64url")}Aa1!` : ""),
    previewCustomerEmail: previewMemoryMode
      ? configuredValue(env.PREVIEW_CUSTOMER_EMAIL) || "preview-customer@uchiha.local"
      : "",
    previewCustomerPassword: previewMemoryMode
      ? configuredValue(env.PREVIEW_CUSTOMER_PASSWORD) || `${randomBytes(24).toString("base64url")}Aa1!`
      : "",
    providerToken: provider.token,
    providerMode: provider.mode,
    providerAdapterKey: provider.adapterKey,
    providerBaseUrl: provider.baseUrl,
    deployment: {
      environment: configuredValue(env.RAILWAY_ENVIRONMENT_NAME),
      service: configuredValue(env.RAILWAY_SERVICE_NAME),
      deploymentId: configuredValue(env.RAILWAY_DEPLOYMENT_ID),
      commitSha: configuredValue(env.RAILWAY_GIT_COMMIT_SHA)
    }
  };
}
