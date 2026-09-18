import assert from "node:assert/strict";
import { createMemoryDatabase } from "../apps/api/src/database.js";
import { seedDatabase, DEMO } from "../apps/api/src/seed.js";
import { buildApp } from "../apps/api/src/app.js";

const config = {
  nodeEnv: "test", host: "127.0.0.1", port: 0, publicBaseUrl: "http://127.0.0.1", databaseDriver: "sqlite", databasePath: ":memory:", databaseUrl: "", logLevel: "silent", googleClientId: "", bootstrapOwnerEmail: "owner@example.test", sessionTtlHours: 12, allowDevAuth: true,
  encryptionKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  connectorSigningSecret: "connector-test-secret-0123456789abcdef", billingWebhookSecret: "billing-test-secret-0123456789abcdef12", billingCheckoutEndpoint: "", billingCheckoutToken: "", telegramBotToken: "", telegramWebhookSecret: "telegram-test-secret", outboxWorkerEnabled: false, metricsToken: "metrics-test-token-1234567890", trustProxy: false, corsOrigins: ["http://localhost"]
};

const db = createMemoryDatabase();
await seedDatabase(db);
const app = await buildApp({ config, db });
try {
  assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/provider/" })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/owner/" })).statusCode, 200);
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/dev", payload: { mode: "provider" } });
  assert.equal(login.statusCode, 200);
  const token = login.json().data.token;
  const headers = { authorization: `Bearer ${token}`, "x-tenant-id": DEMO.tenantId };
  for (const url of ["/api/v1/dashboard", "/api/v1/subscribers", "/api/v1/plans", "/api/v1/sessions", "/api/v1/invoices", "/api/v1/devices", "/api/v1/team"]) {
    assert.equal((await app.inject({ method: "GET", url, headers })).statusCode, 200, url);
  }
  console.log("Smoke check passed: provider app, owner app, API and core data paths are reachable.");
} finally {
  await app.close();
  await db.close();
}
