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
    // The actual PostgreSQL runtime must support the same owner-confirmed
    // MikroTik deletion as SQLite, retaining session/accounting evidence and
    // rejecting deletions with active customer sessions.
    const pgDeviceCreate = await app.inject({ method: "POST", url: "/api/v1/devices",
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": DEMO.tenantId,
        "idempotency-key": "pg-router-delete-register" },
      payload: { name: "PG disposable router", host: "10.42.0.12",
        apiPort: 8729, connectionMethod: "agent" } });
    assert.equal(pgDeviceCreate.statusCode, 201, pgDeviceCreate.body);
    const pgDeviceId = pgDeviceCreate.json().data.id;
    const pgDeviceList = await app.inject({ method: "GET", url: "/api/v1/devices",
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": DEMO.tenantId } });
    assert.equal(pgDeviceList.statusCode, 200, pgDeviceList.body);
    const pgDevice = pgDeviceList.json().data.items.find(row => row.id === pgDeviceId);
    assert.ok(pgDevice?.updated_at);
    await runtime.withContext(tenantContext, async () => {
      await runtime.run(`INSERT INTO radius_sessions
        (id,tenant_id,subscriber_id,device_id,external_session_id,username,
         started_at,status,updated_at)
        VALUES ('ses_pg_router_delete',?, 'cus_demo_1',?, 'pg-router-delete-session',
          'ahmad-101',NOW(),'active',NOW())`, [DEMO.tenantId, pgDeviceId]);
      await runtime.run(`INSERT INTO radius_accounting_events
        (id,tenant_id,event_id,session_id,status_type,username,subscriber_id,
         device_id,occurred_at,received_at)
        VALUES ('rac_pg_router_delete',?, 'pg-router-delete-event',
          'pg-router-delete-session','stop','ahmad-101','cus_demo_1',?,NOW(),NOW())`,
      [DEMO.tenantId, pgDeviceId]);
    });
    const pgDeletePayload = { expectedHost: pgDevice.host,
      expectedUpdatedAt: pgDevice.updated_at,
      reason: "Owner confirmed deletion on disposable PostgreSQL" };
    const pgDelete = key => app.inject({ method: "DELETE",
      url: `/api/v1/devices/${pgDeviceId}`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": DEMO.tenantId,
        "idempotency-key": key }, payload: pgDeletePayload });
    const pgBlocked = await pgDelete("pg-router-delete-active-block");
    assert.equal(pgBlocked.statusCode, 409, pgBlocked.body);
    assert.equal((await runtime.withContext(tenantContext, () => runtime.get(
      "SELECT COUNT(*)::int AS n FROM network_devices WHERE id=?", [pgDeviceId]))).n, 1);
    await runtime.withContext(tenantContext, () => runtime.run(
      "UPDATE radius_sessions SET status='stopped',stopped_at=NOW() WHERE id='ses_pg_router_delete'"));
    const pgDeleted = await pgDelete("pg-router-delete-confirm");
    assert.equal(pgDeleted.statusCode, 200, pgDeleted.body);
    assert.deepEqual(pgDeleted.json().data, { id: pgDeviceId, deleted: true });
    assert.equal((await runtime.withContext(tenantContext, () => runtime.get(
      "SELECT COUNT(*)::int AS n FROM network_devices WHERE id=?", [pgDeviceId]))).n, 0);
    const pgHistory = await runtime.withContext(tenantContext, () => runtime.get(
      "SELECT status,device_id FROM radius_sessions WHERE id='ses_pg_router_delete'"));
    assert.equal(pgHistory.status, "stopped");
    assert.equal(pgHistory.device_id, null);
    assert.equal((await runtime.withContext(tenantContext, () => runtime.get(
      "SELECT device_id FROM radius_accounting_events WHERE id='rac_pg_router_delete'"))).device_id, null);
    const pgDeleteReplay = await pgDelete("pg-router-delete-confirm");
    assert.equal(pgDeleteReplay.statusCode, 200, pgDeleteReplay.body);
    assert.equal(pgDeleteReplay.headers["idempotency-replayed"], "true");
    assert.equal((await runtime.withContext(tenantContext, () => runtime.get(
      "SELECT COUNT(*)::int AS n FROM audit_logs WHERE entity_id=? AND action='device.delete'",
      [pgDeviceId]))).n, 1);
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
    // On real PostgreSQL, an auth event's ID must not be reused with
    // different facts, even when a new agent signs it with a fresh nonce.
    const authEvent = {
      agentId: "postgres-auth-agent-one", nonce: "pg-auth-immutable-nonce-one",
      nonceExpiresAt: new Date(Date.now()+60_000).toISOString(),
      eventId: "postgres-auth-immutable-001",
      requestId: "pg-auth-request-001",
      username: "ahmad-101", principalType: "subscriber", principalId: "cus_demo_1",
      nasIp: "192.0.2.10", clientIp: "10.10.0.21", result: "accept",
      occurredAt: new Date().toISOString()
    };
    const sendPgAuth = async (payload) => {
      const raw = JSON.stringify(payload);
      const timestamp = String(Math.floor(Date.now()/1000));
      return app.inject({ method: "POST",
        url: "/connectors/radius/elite-demo/auth-events",
        headers: { "content-type": "application/json",
          "x-uchiha-timestamp": timestamp,
          "x-uchiha-signature": signPayload(config.connectorSigningSecret, timestamp, raw) },
        payload: raw });
    };
    const authFirst = await sendPgAuth(authEvent);
    assert.equal(authFirst.statusCode, 202, authFirst.body);
    const authReplay = await sendPgAuth({
      ...authEvent, agentId: "postgres-auth-agent-two",
      nonce: "pg-auth-immutable-nonce-two"
    });
    assert.equal(authReplay.statusCode, 202, authReplay.body);
    assert.equal(authReplay.json().data.duplicate, true);
    const authConflict = await sendPgAuth({
      ...authEvent, nonce: "pg-auth-immutable-nonce-three", result: "reject"
    });
    assert.equal(authConflict.statusCode, 409, authConflict.body);
    const preservedAuth = await runtime.withContext(tenantContext, () => runtime.get(
      "SELECT result,username,COUNT(*)::int AS n FROM radius_auth_events WHERE tenant_id=? AND event_id=? GROUP BY result,username",
      [DEMO.tenantId,authEvent.eventId]));
    assert.equal(preservedAuth.result, "accept");
    assert.equal(preservedAuth.username, "ahmad-101");
    assert.equal(preservedAuth.n, 1);
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
