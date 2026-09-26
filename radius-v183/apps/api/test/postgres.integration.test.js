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
    // Exercise the subscriber overlay against real PostgreSQL JSONB/RLS, not
    // only SQLite's test schema. These fixtures never touch production.
    const chosenPlan = await runtime.withContext(tenantContext, () => runtime.get(
      "SELECT id FROM plans WHERE tenant_id=? AND status='active' LIMIT 1", [DEMO.tenantId]));
    assert.ok(chosenPlan?.id);
    const tenantCurrency = (await runtime.withContext(tenantContext, () => runtime.get(
      "SELECT currency FROM tenants WHERE id=?", [DEMO.tenantId]))).currency;
    const quotes = { USD: "7.25", SYP: "99000", TRY: "270.00" };
    const profileCreated = await app.inject({ method: "POST", url: "/api/v1/subscribers",
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": DEMO.tenantId, "idempotency-key": "pg-profile-create" },
      payload: { fullName: "PostgreSQL Profile Test", username: "pg-profile-test",
        radiusPassword: "isolated-pg-profile-secret", planId: chosenPlan.id,
        accessProfile: { speedDownMbps: 75, speedUpMbps: 15,
          dailyQuota: { amount: 1500, unit: "MB" }, priceCurrency: tenantCurrency, prices: quotes } } });
    assert.equal(profileCreated.statusCode, 201, profileCreated.body);
    assert.equal(profileCreated.body.includes("isolated-pg-profile-secret"), false);
    const profileSubscriber = profileCreated.json().data;
    assert.equal(profileSubscriber.accessProfile.dailyQuotaBytes, 1_500_000_000);
    assert.deepEqual(profileSubscriber.accessProfile.prices, quotes);
    const storedProfile = await runtime.withContext(tenantContext, () => runtime.get(
      "SELECT prices_json,daily_quota_bytes FROM subscriber_access_profiles WHERE tenant_id=? AND subscriber_id=?",
      [DEMO.tenantId, profileSubscriber.id]));
    assert.deepEqual(storedProfile.prices_json, quotes);
    assert.equal(Number(storedProfile.daily_quota_bytes), 1_500_000_000);
    const crossTenant = await runtime.withContext({ tenantId: "ten_unrelated_unauthorized" }, () => runtime.get(
      "SELECT COUNT(*)::int AS n FROM subscriber_access_profiles WHERE subscriber_id=?", [profileSubscriber.id]));
    assert.equal(crossTenant.n, 0);
    const signedProfileBody = JSON.stringify({ agentId: "postgres-agent", nonce: "postgres-profile-nonce",
      nonceExpiresAt: new Date(Date.now()+60_000).toISOString(), afterUsername: "", limit: 100 });
    const profileTimestamp = String(Math.floor(Date.now()/1000));
    const profileDirectory = await app.inject({ method: "POST", url: "/connectors/radius/elite-demo/directory",
      headers: { "content-type": "application/json", "x-uchiha-timestamp": profileTimestamp,
        "x-uchiha-signature": signPayload(config.connectorSigningSecret, profileTimestamp, signedProfileBody) },
      payload: signedProfileBody });
    assert.equal(profileDirectory.statusCode, 200, profileDirectory.body);
    const profilePrincipal = profileDirectory.json().data.principals.find((item) => item.username === "pg-profile-test");
    assert.ok(profilePrincipal, "PostgreSQL overlay must reach the signed agent directory");
    assert.equal(profilePrincipal.attributes.rateLimitDownMbps, 75);
    assert.equal(profilePrincipal.attributes.rateLimitUpMbps, 15);
    assert.equal(profilePrincipal.attributes.quota.limitBytes, 1_500_000_000);
    const invoice = await app.inject({ method: "POST", url: "/api/v1/invoices",
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": DEMO.tenantId,
        "idempotency-key": "pg-profile-invoice" },
      payload: { subscriberId: profileSubscriber.id, dueAt: new Date(Date.now()+604_800_000).toISOString(),
        reason: "Independent PostgreSQL currency quote" } });
    assert.equal(invoice.statusCode, 201, invoice.body);
    assert.equal(invoice.json().data.amountMinor, { USD:725, SYP:9_900_000, TRY:27_000 }[tenantCurrency]);
    assert.equal(invoice.json().data.currency, tenantCurrency);
    const removedProfile = await app.inject({ method: "PATCH",
      url: `/api/v1/subscribers/${profileSubscriber.id}`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": DEMO.tenantId,
        "idempotency-key": "pg-profile-remove" },
      payload: { accessProfile: null } });
    assert.equal(removedProfile.statusCode, 200, removedProfile.body);
    assert.equal(removedProfile.json().data.accessProfile, null);
    const remainingProfiles = await runtime.withContext(tenantContext, () => runtime.get(
      "SELECT COUNT(*)::int AS n FROM subscriber_access_profiles WHERE tenant_id=? AND subscriber_id=?",
      [DEMO.tenantId, profileSubscriber.id]));
    assert.equal(remainingProfiles.n, 0);
    // Signed accounting must not reassign an existing session to another
    // subscriber even with an otherwise valid tenant HMAC (disposable PG DB).
    const priorSession = await runtime.withContext(tenantContext, () => runtime.get(
      "SELECT subscriber_id,username,nas_ip,status,input_bytes,output_bytes FROM radius_sessions WHERE external_session_id=?",
      ["rad-demo-active"]));
    const conflictingAccounting = JSON.stringify({
      eventId: "pg-session-identity-collision-01",
      nonce: "postgres-session-collision-nonce-001",
      nonceExpiresAt: new Date(Date.now()+60_000).toISOString(),
      statusType: "stop", sessionId: "rad-demo-active", username: "unrelated-pg-user",
      nasIp: "192.0.2.10", occurredAt: new Date().toISOString(),
      inputBytes: 999_000_000, outputBytes: 999_000_000
    });
    const conflictTimestamp = String(Math.floor(Date.now()/1000));
    const conflictResult = await app.inject({ method: "POST",
      url: "/connectors/radius/elite-demo/accounting",
      headers: { "content-type": "application/json",
        "x-uchiha-timestamp": conflictTimestamp,
        "x-uchiha-signature": signPayload(config.connectorSigningSecret, conflictTimestamp, conflictingAccounting) },
      payload: conflictingAccounting });
    assert.equal(conflictResult.statusCode, 409, conflictResult.body);
    const afterConflict = await runtime.withContext(tenantContext, () => runtime.get(
      "SELECT subscriber_id,username,nas_ip,status,input_bytes,output_bytes FROM radius_sessions WHERE external_session_id=?",
      ["rad-demo-active"]));
    assert.deepEqual(afterConflict, priorSession);
    const conflictEvents = await runtime.withContext(tenantContext, () => runtime.get(
      "SELECT COUNT(*)::int AS n FROM radius_accounting_events WHERE event_id=?",
      ["pg-session-identity-collision-01"]));
    assert.equal(conflictEvents.n, 0);
    assert.equal((await app.inject({ method: "GET", url: "/ready" })).statusCode, 200);
    // This is a disposable CI database: simulate an omitted migration 017
    // and ensure the readiness gate blocks rollout until the default is restored.
    await admin.exec("ALTER TABLE network_devices ALTER COLUMN api_port DROP DEFAULT");
    try {
      const notReady = await app.inject({ method: "GET", url: "/ready" });
      assert.equal(notReady.statusCode, 503, notReady.body);
      assert.equal(notReady.json().data.ready, false);
    } finally {
      await admin.exec("ALTER TABLE network_devices ALTER COLUMN api_port SET DEFAULT 8729");
    }
    assert.equal((await app.inject({ method: "GET", url: "/ready" })).statusCode, 200);
    // CI uses a disposable database. A DBA mistake disabling tenant RLS must
    // block release even when the table and migrations otherwise look healthy.
    await admin.exec("ALTER TABLE subscriber_access_profiles DISABLE ROW LEVEL SECURITY");
    try {
      const disabledRls = await app.inject({ method: "GET", url: "/ready" });
      assert.equal(disabledRls.statusCode, 503, disabledRls.body);
      assert.equal(disabledRls.json().data.ready, false);
    } finally {
      await admin.exec("ALTER TABLE subscriber_access_profiles ENABLE ROW LEVEL SECURITY");
    }
    assert.equal((await app.inject({ method: "GET", url: "/ready" })).statusCode, 200);
    await admin.exec("DROP POLICY subscriber_access_profiles_tenant_policy ON subscriber_access_profiles");
    try {
      const noPolicy = await app.inject({ method: "GET", url: "/ready" });
      assert.equal(noPolicy.statusCode, 503, noPolicy.body);
      assert.equal(noPolicy.json().data.ready, false);
    } finally {
      await admin.exec("CREATE POLICY subscriber_access_profiles_tenant_policy ON subscriber_access_profiles USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id))");
    }
    assert.equal((await app.inject({ method: "GET", url: "/ready" })).statusCode, 200);
    const metrics = await app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${config.metricsToken}` } });
    assert.equal(metrics.statusCode, 200, metrics.body);
    assert.match(metrics.body, /uchiha_radius_unhealthy_nodes/);
  } finally {
    if (app) await app.close();
    await Promise.all([admin.close(), runtime.close(), platform.close(), backup.close()]);
  }
});
