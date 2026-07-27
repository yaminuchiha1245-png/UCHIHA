import { createHash, randomBytes } from "node:crypto";

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function integerValue(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid integer configuration: ${value}`);
  return parsed;
}

function encryptionKey(mode, rawValue, { demoSeed = false, databaseUrl = "" } = {}) {
  if (rawValue) {
    const decoded = Buffer.from(rawValue, "base64");
    if (decoded.length !== 32) {
      throw new Error("APP_ENCRYPTION_KEY must decode to exactly 32 bytes");
    }
    return decoded;
  }
  if (mode === "memory" || process.env.NODE_ENV === "test") {
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
  const databaseMode = env.DATABASE_MODE || "postgres";
  const nodeEnv = env.NODE_ENV || "development";
  const demoSeed = booleanValue(env.DEMO_SEED);
  if (!["postgres", "memory"].includes(databaseMode)) {
    throw new Error("DATABASE_MODE must be postgres or memory");
  }
  if (nodeEnv === "production" && databaseMode !== "postgres") {
    throw new Error("Production cannot run with the in-memory database");
  }
  if (databaseMode === "postgres" && !env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for PostgreSQL mode");
  }

  return {
    nodeEnv,
    port: integerValue(env.PORT, 4100),
    host: env.HOST || "0.0.0.0",
    databaseMode,
    databaseUrl: env.DATABASE_URL || "",
    databaseSsl: booleanValue(env.DATABASE_SSL),
    appBaseUrl: (
      env.APP_BASE_URL ||
      (nodeEnv === "production" ? "" : "http://localhost:4100")
    ).replace(/\/+$/, ""),
    storeBaseDomain: env.STORE_BASE_DOMAIN || "uchiha.store",
    cookieSecure: booleanValue(env.COOKIE_SECURE, nodeEnv === "production"),
    encryptionKey: encryptionKey(databaseMode, env.APP_ENCRYPTION_KEY, {
      demoSeed,
      databaseUrl: env.DATABASE_URL || ""
    }),
    allowDemoBilling: booleanValue(env.ALLOW_DEMO_BILLING, demoSeed),
    demoSeed,
    telegramMode: env.TELEGRAM_MODE || (demoSeed ? "fake" : "live"),
    sessionHours: integerValue(env.SESSION_HOURS, 168),
    offerSeed: {
      name: env.UCHIHA_FULL_NAME || "UCHIHA Full",
      priceMinor: integerValue(env.UCHIHA_FULL_PRICE_MINOR, null),
      renewalPriceMinor: integerValue(env.UCHIHA_FULL_RENEWAL_PRICE_MINOR, null),
      currency: env.UCHIHA_FULL_CURRENCY || "USD",
      durationUnit: env.UCHIHA_FULL_DURATION_UNIT || null,
      durationCount: integerValue(env.UCHIHA_FULL_DURATION_COUNT, null),
      trialDays: integerValue(env.UCHIHA_FULL_TRIAL_DAYS, null)
    },
    platformAdminEmail: env.PLATFORM_ADMIN_EMAIL || "",
    platformAdminPassword: env.PLATFORM_ADMIN_PASSWORD || "",
    providerToken: env.UCHIHA_API_1_TOKEN || "",
    providerMode: env.UCHIHA_API_1_MODE || "test"
  };
}
