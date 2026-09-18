import assert from "node:assert/strict";
import test from "node:test";
import { signPayload } from "../src/security.js";
import { devSession, headers, setup } from "./helpers.js";

function signedHeaders(secret, raw) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "content-type": "application/json",
    "x-uchiha-timestamp": timestamp,
    "x-uchiha-signature": signPayload(secret, timestamp, raw)
  };
}

async function connectorPost(env, path, payload) {
  const raw = JSON.stringify(payload);
  return env.app.inject({ method: "POST", url: path, headers: signedHeaders(env.config.connectorSigningSecret, raw), payload: raw });
}

function envelope(extra = {}) {
  return {
    nonce: `quota-nonce-${crypto.randomUUID()}`,
    nonceExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...extra
  };
}

async function updatePlan(env, token, planId, payload, key) {
  return env.app.inject({
    method: "PATCH",
    url: `/api/v1/plans/${planId}`,
    headers: headers(token, "ten_demo_isp", { "idempotency-key": key }),
    payload: { ...payload, reason: "اختبار سياسة الحصة" }
  });
}

test("daily quota blocks authentication and queues one refresh plus session disconnects", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const provider = await devSession(env.app);
  const plan = await updatePlan(env, provider.token, "pln_demo_plus", {
    quotaBytes: 1_000,
    quotaPeriod: "daily",
    quotaAction: "block",
    durationDays: 30,
    simultaneousUse: 2
  }, "quota-block-plan");
  assert.equal(plan.statusCode, 200, plan.body);
  assert.equal(plan.json().data.quotaBytes, 1_000);
  assert.equal(plan.json().data.simultaneousUse, 2);

  const credential = await env.app.inject({
    method: "PUT",
    url: "/api/v1/subscribers/cus_demo_1/credential",
    headers: headers(provider.token, "ten_demo_isp", { "idempotency-key": "quota-credential" }),
    payload: { radiusPassword: "quota-password-55", reason: "اختبار تطبيق الحصة" }
  });
  assert.equal(credential.statusCode, 200, credential.body);

  const occurredAt = new Date().toISOString();
  const accounting = envelope({
    eventId: "quota-block-event-0001",
    statusType: "interim",
    sessionId: "quota-block-session",
    username: "ahmad-101",
    nasIp: "192.0.2.10",
    framedIp: "10.10.0.55",
    startedAt: occurredAt,
    occurredAt,
    inputBytes: 600,
    outputBytes: 500
  });
  const accepted = await connectorPost(env, "/connectors/radius/elite-demo/accounting", accounting);
  assert.equal(accepted.statusCode, 202, accepted.body);
  assert.equal(accepted.json().data.quotaEnforcement.action, "block");
  assert.equal(accepted.json().data.quotaEnforcement.usedBytes, 1_100);

  const jobs = await env.db.all(`SELECT topic, payload_json FROM outbox
    WHERE tenant_id = 'ten_demo_isp' AND status <> 'sent' ORDER BY topic`);
  assert.equal(jobs.filter((job) => job.topic === "radius.directory.refresh").length, 1);
  assert.equal(jobs.filter((job) => job.topic === "radius.session.disconnect").length, 2);

  const directory = await connectorPost(env, "/connectors/radius/elite-demo/directory", envelope({ agentId: "quota-test-agent", afterUsername: "", limit: 500 }));
  assert.equal(directory.statusCode, 200, directory.body);
  const principal = directory.json().data.principals.find((item) => item.username === "ahmad-101");
  assert.equal(principal.status, "quota_blocked");
  assert.equal(principal.attributes.quota.exceeded, true);
  assert.equal(principal.attributes.simultaneousUse, 2);

  const repeated = await connectorPost(env, "/connectors/radius/elite-demo/accounting", { ...accounting, nonce: `quota-nonce-${crypto.randomUUID()}` });
  assert.equal(repeated.statusCode, 202, repeated.body);
  assert.equal(repeated.json().data.duplicate, true);
  const repeatedJobs = await env.db.all("SELECT id FROM outbox WHERE tenant_id = ? AND topic = 'radius.directory.refresh'", ["ten_demo_isp"]);
  assert.equal(repeatedJobs.length, 1);
});

test("quota throttle changes RADIUS speed and renewal follows the plan duration", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const provider = await devSession(env.app);
  const plan = await updatePlan(env, provider.token, "pln_demo_home", {
    quotaBytes: 1_000,
    quotaPeriod: "monthly",
    quotaAction: "throttle",
    throttleDownMbps: 1,
    throttleUpMbps: 1,
    durationDays: 45
  }, "quota-throttle-plan");
  assert.equal(plan.statusCode, 200, plan.body);

  const credential = await env.app.inject({
    method: "PUT",
    url: "/api/v1/subscribers/cus_demo_2/credential",
    headers: headers(provider.token, "ten_demo_isp", { "idempotency-key": "quota-throttle-credential" }),
    payload: { radiusPassword: "throttle-password-55", reason: "اختبار خفض السرعة" }
  });
  assert.equal(credential.statusCode, 200, credential.body);

  const occurredAt = new Date().toISOString();
  const accepted = await connectorPost(env, "/connectors/radius/elite-demo/accounting", envelope({
    eventId: "quota-throttle-event-0001",
    statusType: "interim",
    sessionId: "quota-throttle-session",
    username: "sara-204",
    nasIp: "192.0.2.10",
    occurredAt,
    inputBytes: 900,
    outputBytes: 200
  }));
  assert.equal(accepted.statusCode, 202, accepted.body);
  assert.equal(accepted.json().data.quotaEnforcement.action, "throttle");

  const directory = await connectorPost(env, "/connectors/radius/elite-demo/directory", envelope({ agentId: "quota-test-agent", afterUsername: "", limit: 500 }));
  const principal = directory.json().data.principals.find((item) => item.username === "sara-204");
  assert.equal(principal.status, "active");
  assert.equal(principal.attributes.rateLimitDownMbps, 1);
  assert.equal(principal.attributes.rateLimitUpMbps, 1);
  assert.equal(principal.attributes.quota.throttled, true);

  const before = await env.db.get("SELECT service_expires_at FROM subscribers WHERE id = 'cus_demo_2'");
  const renewed = await env.app.inject({
    method: "POST",
    url: "/api/v1/subscribers/cus_demo_2/renew",
    headers: headers(provider.token, "ten_demo_isp", { "idempotency-key": "subscriber-renew-45" }),
    payload: { reason: "تجديد اشتراك الاختبار" }
  });
  assert.equal(renewed.statusCode, 200, renewed.body);
  const daysAdded = Math.round((Date.parse(renewed.json().data.serviceExpiresAt) - Date.parse(before.service_expires_at)) / 86_400_000);
  assert.equal(daysAdded, 45);
});

test("plan quota validation rejects incomplete throttle and invalid scoped targets", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const provider = await devSession(env.app);
  const incomplete = await updatePlan(env, provider.token, "pln_demo_home", {
    quotaBytes: 10_000,
    quotaPeriod: "daily",
    quotaAction: "throttle"
  }, "quota-invalid-throttle");
  assert.equal(incomplete.statusCode, 400, incomplete.body);

  const invalidScope = await updatePlan(env, provider.token, "pln_demo_home", {
    scopeType: "device",
    scopeId: "dev_missing"
  }, "quota-invalid-scope");
  assert.equal(invalidScope.statusCode, 400, invalidScope.body);
});
