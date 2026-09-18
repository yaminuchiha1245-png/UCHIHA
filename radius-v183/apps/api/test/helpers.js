import { createMemoryDatabase } from "../src/database.js";
import { seedDatabase, DEMO } from "../src/seed.js";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth-service.js";
import { id, nowIso } from "../src/utils.js";

export function testConfig(overrides = {}) {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    publicBaseUrl: "http://127.0.0.1",
    databaseDriver: "sqlite",
    databasePath: ":memory:",
    databaseUrl: "",
    logLevel: "silent",
    googleClientId: "",
    bootstrapOwnerEmail: "owner@example.test",
    sessionTtlHours: 12,
    allowDevAuth: true,
    requireInstallationBinding: false,
    encryptionKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    connectorSigningSecret: "connector-test-secret-0123456789abcdef",
    billingWebhookSecret: "billing-test-secret-0123456789abcdef12",
    billingCheckoutEndpoint: "",
    billingCheckoutToken: "",
    billingCheckoutAllowedHosts: [],
    telegramBotToken: "",
    telegramWebhookSecret: "telegram-test-secret",
    outboxWorkerEnabled: false,
    metricsToken: "metrics-test-token-1234567890",
    trustProxy: false,
    corsOrigins: ["http://localhost"],
    ...overrides
  };
}

export async function setup(overrides = {}) {
  const config = testConfig(overrides);
  const db = createMemoryDatabase();
  await seedDatabase(db);
  const app = await buildApp({ config, db, logger: false });
  return {
    app,
    db,
    config,
    async close() { await app.close(); await db.close(); }
  };
}

export async function devSession(app, mode = "provider") {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/dev", payload: { mode } });
  if (response.statusCode !== 200) throw new Error(response.body);
  return response.json().data;
}

export function headers(token, tenantId = DEMO.tenantId, extra = {}) {
  return { authorization: `Bearer ${token}`, ...(tenantId ? { "x-tenant-id": tenantId } : {}), ...extra };
}

export async function createTenant(db, suffix = "two", subscriptionStatus = "active") {
  const now = nowIso();
  const tenantId = `ten_test_${suffix}`;
  await db.run(`INSERT INTO tenants (id,name,slug,currency,time_zone,status,created_at,updated_at)
    VALUES (?, ?, ?, 'USD', 'UTC', 'active', ?, ?)`, [tenantId, `Tenant ${suffix}`, `tenant-${suffix}`, now, now]);
  await db.run(`INSERT INTO tenant_subscriptions
    (id,tenant_id,product_id,status,provider,external_id,starts_at,ends_at,created_at,updated_at)
    VALUES (?,?,'prd_starter',?,'test',NULL,?,NULL,?,?)`, [`sub_test_${suffix}`, tenantId, subscriptionStatus, now, now, now]);
  return tenantId;
}

export async function createUserSession(db, config, { tenantId = DEMO.tenantId, role = "viewer", email = `${role}-${id("mail")}@example.test`, platformRole = "none" } = {}) {
  const now = nowIso();
  const userId = id("usr");
  await db.run(`INSERT INTO users (id,email,google_sub,display_name,avatar_url,platform_role,created_at,updated_at)
    VALUES (?,?,NULL,?,NULL,?,?,?)`, [userId, email, `Test ${role}`, platformRole, now, now]);
  if (tenantId) {
    await db.run(`INSERT INTO memberships (id,tenant_id,user_id,role,status,created_at,updated_at)
      VALUES (?,?,?,?,'active',?,?)`, [id("mem"), tenantId, userId, role, now, now]);
  }
  const auth = new AuthService({ db, config, googleVerifier: { verify: async () => { throw new Error("unused"); } } });
  const session = await auth.issueSession({ id: userId });
  return { ...session, userId, tenantId, role };
}
