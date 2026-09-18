import assert from "node:assert/strict";
import test from "node:test";
import { DEMO } from "../src/seed.js";
import { createTenant, createUserSession, devSession, headers, setup } from "./helpers.js";
import { nowIso, toJson } from "../src/utils.js";

test("provider and platform owner receive separate valid contexts", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const provider = await devSession(env.app, "provider");
  const providerMe = await env.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: headers(provider.token) });
  assert.equal(providerMe.statusCode, 200);
  assert.equal(providerMe.json().data.role, "owner");
  assert.equal(providerMe.json().data.user.platformRole, "none");
  assert.equal(providerMe.json().data.canWrite, true);

  const owner = await devSession(env.app, "owner");
  const ownerOverview = await env.app.inject({ method: "GET", url: "/api/v1/owner/overview", headers: headers(owner.token, null) });
  assert.equal(ownerOverview.statusCode, 200);
  assert.equal(ownerOverview.json().data.metrics.tenants, 1);
});

test("a user cannot select a tenant where they have no membership", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const secondTenant = await createTenant(env.db);
  const provider = await devSession(env.app);
  const response = await env.app.inject({ method: "GET", url: "/api/v1/subscribers", headers: headers(provider.token, secondTenant) });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "FORBIDDEN");
});

test("read-only browsing remains available while writes require active subscription", async (t) => {
  const env = await setup(); t.after(() => env.close());
  await env.db.run("UPDATE tenant_subscriptions SET status = 'past_due' WHERE tenant_id = ?", [DEMO.tenantId]);
  const provider = await devSession(env.app);
  const list = await env.app.inject({ method: "GET", url: "/api/v1/subscribers", headers: headers(provider.token) });
  assert.equal(list.statusCode, 200);
  const create = await env.app.inject({
    method: "POST", url: "/api/v1/subscribers",
    headers: headers(provider.token, DEMO.tenantId, { "idempotency-key": "subscription-block-01" }),
    payload: { username: "blocked-1", fullName: "Blocked User" }
  });
  assert.equal(create.statusCode, 402);
  assert.equal(create.json().error.code, "SUBSCRIPTION_REQUIRED");
});

test("suspending a tenant keeps reads available but blocks every tenant write", async (t) => {
  const env = await setup(); t.after(() => env.close());
  await env.db.run("UPDATE tenants SET status='suspended' WHERE id=?", [DEMO.tenantId]);
  const provider = await devSession(env.app);
  const me = await env.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: headers(provider.token) });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().data.canWrite, false);
  assert.equal((await env.app.inject({ method: "GET", url: "/api/v1/subscribers", headers: headers(provider.token) })).statusCode, 200);
  const denied = await env.app.inject({ method: "POST", url: "/api/v1/subscribers",
    headers: headers(provider.token, DEMO.tenantId, { "idempotency-key": "suspended-tenant-write" }),
    payload: { username: "tenant-suspended", fullName: "Blocked Tenant" } });
  assert.equal(denied.statusCode, 402);
});

test("subscription limits are enforced on subscribers, reserved vouchers, devices and team members", async (t) => {
  const env = await setup(); t.after(() => env.close());
  await env.db.run("UPDATE subscription_products SET limits_json=? WHERE id='prd_growth'",
    [JSON.stringify({ subscribers: 4, devices: 1, team: 2 })]);
  const provider = await devSession(env.app);
  const writeHeaders = (key) => headers(provider.token, DEMO.tenantId, { "idempotency-key": key });
  const subscriber = await env.app.inject({ method: "POST", url: "/api/v1/subscribers", headers: writeHeaders("limit-subscriber"),
    payload: { username: "over-limit", fullName: "Over Limit" } });
  assert.equal(subscriber.statusCode, 400);
  const vouchers = await env.app.inject({ method: "POST", url: "/api/v1/voucher-batches", headers: writeHeaders("limit-voucher"),
    payload: { planId: "pln_demo_home", quantity: 1, validDays: 7 } });
  assert.equal(vouchers.statusCode, 400);
  const device = await env.app.inject({ method: "POST", url: "/api/v1/devices", headers: writeHeaders("limit-device"),
    payload: { name: "Over Device", host: "192.0.2.55", apiPort: 8728, connectionMethod: "agent" } });
  assert.equal(device.statusCode, 400);
  const member = await env.app.inject({ method: "POST", url: "/api/v1/team/invitations", headers: writeHeaders("limit-team"),
    payload: { email: "limit@example.test", displayName: "Limit User", role: "viewer", reason: "اختبار حد أعضاء الفريق" } });
  assert.equal(member.statusCode, 400);
});

test("role permissions prevent viewer and collector from managing subscribers", async (t) => {
  const env = await setup(); t.after(() => env.close());
  for (const role of ["viewer", "collector"]) {
    const user = await createUserSession(env.db, env.config, { role });
    const response = await env.app.inject({
      method: "POST", url: "/api/v1/subscribers",
      headers: headers(user.token, DEMO.tenantId, { "idempotency-key": `role-test-${role}` }),
      payload: { username: `blocked-${role}`, fullName: `Blocked ${role}` }
    });
    assert.equal(response.statusCode, 403);
  }
});

test("platform endpoints reject ordinary provider accounts", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const provider = await devSession(env.app);
  const response = await env.app.inject({ method: "GET", url: "/api/v1/owner/overview", headers: headers(provider.token) });
  assert.equal(response.statusCode, 403);
});

test("platform owner can inspect a tenant and explicitly retry a failed job", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const owner = await devSession(env.app, "owner");
  const ownerHeaders = headers(owner.token, null);
  const detail = await env.app.inject({ method: "GET", url: `/api/v1/owner/tenants/${DEMO.tenantId}`, headers: ownerHeaders });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().data.usage.subscribers, 4);
  assert.equal(detail.json().data.subscription.product.code, "growth");
  assert.equal((await env.app.inject({ method: "GET", url: "/api/v1/owner/products", headers: ownerHeaders })).json().data.items.length, 3);

  const now = nowIso();
  await env.db.run(`INSERT INTO outbox
    (id,tenant_id,topic,payload_json,status,attempts,available_at,locked_at,last_error,created_at,updated_at)
    VALUES ('job-owner-retry',?,'telegram.message',?,'failed',8,?,NULL,'temporary failure',?,?)`,
  [DEMO.tenantId, toJson({ chatId: "123", text: "retry" }), now, now, now]);
  const retried = await env.app.inject({
    method: "POST", url: "/api/v1/owner/jobs/job-owner-retry/retry",
    headers: headers(owner.token, null, { "idempotency-key": "owner-job-retry-1" }),
    payload: { reason: "إعادة المحاولة بعد تصحيح إعداد التكامل" }
  });
  assert.equal(retried.statusCode, 200, retried.body);
  assert.deepEqual({ ...(await env.db.get("SELECT status,attempts,last_error FROM outbox WHERE id='job-owner-retry'")) },
    { status: "pending", attempts: 0, last_error: null });
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM audit_logs WHERE action='outbox.job.retry'")).total, 1);

  const changedPlan = await env.app.inject({
    method: "POST", url: `/api/v1/owner/tenants/${DEMO.tenantId}/subscription`,
    headers: headers(owner.token, null, { "idempotency-key": "owner-change-product" }),
    payload: { status: "active", productId: "prd_scale", reason: "ترقية موثقة لخطة المنصة" }
  });
  assert.equal(changedPlan.statusCode, 200, changedPlan.body);
  assert.equal((await env.db.get("SELECT product_id FROM tenant_subscriptions WHERE id='sub_demo_trial'")).product_id, "prd_scale");
});

test("metrics endpoint requires its independent monitoring token", async (t) => {
  const env = await setup(); t.after(() => env.close());
  assert.equal((await env.app.inject({ method: "GET", url: "/metrics" })).statusCode, 401);
  const response = await env.app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${env.config.metricsToken}` } });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /uchiha_radius_http_requests_total/);
  assert.match(response.body, /uchiha_radius_outbox_pending/);
});

test("Capacitor Android origin can preflight the Telegram PUT endpoint", async (t) => {
  const env = await setup({ corsOrigins: ["https://localhost"] });
  t.after(() => env.close());
  const response = await env.app.inject({
    method: "OPTIONS",
    url: "/api/v1/integrations/telegram",
    headers: { origin: "https://localhost", "access-control-request-method": "PUT" }
  });
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], "https://localhost");
  assert.match(response.headers["access-control-allow-methods"], /PUT/);
});
