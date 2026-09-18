import assert from "node:assert/strict";
import test from "node:test";
import { createDatabaseForUrl } from "../src/database.js";
import { seedDatabase, DEMO } from "../src/seed.js";
import { buildApp } from "../src/app.js";
import { signPayload } from "../src/security.js";
import { testConfig } from "./helpers.js";

const enabled = process.env.TEST_POSTGRES === "true";

if (enabled && (!process.env.POSTGRES_ADMIN_URL || !process.env.BACKUP_DATABASE_URL)) {
  throw new Error("POSTGRES_ADMIN_URL and BACKUP_DATABASE_URL are required when TEST_POSTGRES=true");
}

test("PostgreSQL runtime roles have no BYPASSRLS and tenant context is enforced", { skip: !enabled }, async () => {
  const config = testConfig({
    databaseDriver: "postgres",
    databaseUrl: process.env.DATABASE_URL,
    platformDatabaseUrl: process.env.PLATFORM_DATABASE_URL,
    migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL
  });
  const admin = createDatabaseForUrl(config, process.env.POSTGRES_ADMIN_URL);
  const runtime = createDatabaseForUrl(config, process.env.DATABASE_URL);
  const platform = createDatabaseForUrl(config, process.env.PLATFORM_DATABASE_URL);
  const backup = createDatabaseForUrl(config, process.env.BACKUP_DATABASE_URL);
  let app;
  try {
    await admin.exec("TRUNCATE TABLE webhook_events, connector_nonces, idempotency_records, outbox, audit_logs, payments, invoices, radius_sessions, alerts, integrations, network_devices, subscribers, plans, tenant_subscriptions, subscription_products, auth_sessions, memberships, tenants, users CASCADE");
    await seedDatabase(admin);
    await seedDatabase(admin);
    const roles = await admin.all("SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('uchiha_runtime','uchiha_platform','uchiha_backup') ORDER BY rolname");
    assert.equal(roles.length, 3);
    assert.ok(roles.every((role) => role.rolsuper === false && role.rolbypassrls === false));
    assert.equal((await runtime.get("SELECT COUNT(*)::int AS total FROM subscribers")).total, 0);
    const tenantCount = await runtime.withContext({ tenantId: DEMO.tenantId }, () => runtime.get("SELECT COUNT(*)::int AS total FROM subscribers"));
    assert.equal(tenantCount.total, 4);
    assert.equal((await platform.get("SELECT COUNT(*)::int AS total FROM subscribers")).total, 4);
    assert.equal((await backup.get("SELECT COUNT(*)::int AS total FROM subscribers")).total, 4);
    assert.equal((await backup.get("SELECT has_table_privilege(current_user, 'subscribers', 'INSERT') AS allowed")).allowed, false);

    const tenantContext = { tenantId: DEMO.tenantId };
    await runtime.withContext(tenantContext, () => runtime.run(`INSERT INTO network_sites
      (id,tenant_id,name,code,address,latitude,longitude,status,created_at,updated_at)
      VALUES ('sit_pg_test',?,'Postgres Site','PG',NULL,NULL,NULL,'active',NOW(),NOW())`, [DEMO.tenantId]));
    assert.equal((await runtime.get("SELECT COUNT(*)::int AS total FROM network_sites")).total, 0);
    assert.equal((await runtime.withContext(tenantContext, () => runtime.get("SELECT COUNT(*)::int AS total FROM network_sites"))).total, 1);

    app = await buildApp({ config, db: runtime, platformDb: platform });
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/dev", payload: { mode: "provider" } });
    assert.equal(login.statusCode, 200);
    const token = login.json().data.token;
    const dashboard = await app.inject({ method: "GET", url: "/api/v1/dashboard", headers: { authorization: `Bearer ${token}`, "x-tenant-id": DEMO.tenantId } });
    assert.equal(dashboard.statusCode, 200);
    assert.equal(dashboard.json().data.metrics.subscribers, 4);
    const credential = await app.inject({ method: "PUT", url: "/api/v1/subscribers/cus_demo_1/credential",
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": DEMO.tenantId, "idempotency-key": "pg-radius-credential" },
      payload: { radiusPassword: "postgres-radius-password", reason: "اختبار دليل PostgreSQL" } });
    assert.equal(credential.statusCode, 200, credential.body);
    const directoryBody = { agentId: "postgres-agent", nonce: "postgres-directory-nonce", nonceExpiresAt: new Date(Date.now() + 60_000).toISOString(), afterUsername: "", limit: 100 };
    const raw = JSON.stringify(directoryBody);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const directory = await app.inject({ method: "POST", url: "/connectors/radius/elite-demo/directory",
      headers: { "content-type": "application/json", "x-uchiha-timestamp": timestamp,
        "x-uchiha-signature": signPayload(config.connectorSigningSecret, timestamp, raw) }, payload: raw });
    assert.equal(directory.statusCode, 200, directory.body);
    assert.match(directory.headers["cache-control"], /no-store/);
    assert.equal(directory.json().data.principals.find((item) => item.username === "ahmad-101").password, "postgres-radius-password");
    assert.equal((await app.inject({ method: "GET", url: "/ready" })).statusCode, 200);
    const metrics = await app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${config.metricsToken}` } });
    assert.equal(metrics.statusCode, 200, metrics.body);
    assert.match(metrics.body, /uchiha_radius_unhealthy_nodes/);
  } finally {
    if (app) await app.close();
    await Promise.all([admin.close(), runtime.close(), platform.close(), backup.close()]);
  }
});
