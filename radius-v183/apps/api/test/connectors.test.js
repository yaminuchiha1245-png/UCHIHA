import assert from "node:assert/strict";
import test from "node:test";
import { signPayload } from "../src/security.js";
import { devSession, headers, setup } from "./helpers.js";
import { nowIso, toJson } from "../src/utils.js";

function signedHeaders(secret, raw, timestamp = String(Math.floor(Date.now() / 1000))) {
  return { "content-type": "application/json", "x-uchiha-timestamp": timestamp, "x-uchiha-signature": signPayload(secret, timestamp, raw) };
}

function radiusEvent(overrides = {}) {
  const now = new Date().toISOString();
  return { eventId: "radius-event-0001", nonce: "nonce-abcdefghijklmnop", nonceExpiresAt: new Date(Date.now() + 60_000).toISOString(), statusType: "start", sessionId: "radius-session-900", username: "ahmad-101", nasIp: "192.0.2.10", framedIp: "10.10.0.99", occurredAt: now, inputBytes: 0, outputBytes: 0, ...overrides };
}

test("RADIUS accounting rejects unsigned requests", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const response = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/accounting", payload: radiusEvent() });
  assert.equal(response.statusCode, 401);
});

test("signed RADIUS start and stop are stored once", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const start = radiusEvent();
  const startRaw = JSON.stringify(start);
  const accepted = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/accounting", headers: signedHeaders(env.config.connectorSigningSecret, startRaw), payload: startRaw });
  assert.equal(accepted.statusCode, 202);
  assert.equal(accepted.json().data.subscriberMatched, true);
  const stop = radiusEvent({ eventId: "radius-event-0002", nonce: "nonce-qrstuvwxyzabcdef", nonceExpiresAt: new Date(Date.now() + 60_000).toISOString(), statusType: "stop", inputBytes: 1000, outputBytes: 5000, terminateCause: "User-Request" });
  const stopRaw = JSON.stringify(stop);
  assert.equal((await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/accounting", headers: signedHeaders(env.config.connectorSigningSecret, stopRaw), payload: stopRaw })).statusCode, 202);
  const stored = await env.db.get("SELECT status,input_bytes,output_bytes FROM radius_sessions WHERE external_session_id='radius-session-900'");
  assert.deepEqual({ ...stored }, { status: "stopped", input_bytes: 1000, output_bytes: 5000 });

  const lateInterim = radiusEvent({ eventId: "radius-event-0003", nonce: "nonce-late-interim-abcdef", nonceExpiresAt: new Date(Date.now() + 60_000).toISOString(), statusType: "interim", inputBytes: 900, outputBytes: 4500 });
  const lateRaw = JSON.stringify(lateInterim);
  assert.equal((await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/accounting", headers: signedHeaders(env.config.connectorSigningSecret, lateRaw), payload: lateRaw })).statusCode, 202);
  assert.deepEqual({ ...await env.db.get("SELECT status,input_bytes,output_bytes FROM radius_sessions WHERE external_session_id='radius-session-900'") },
    { status: "stopped", input_bytes: 1000, output_bytes: 5000 });
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM radius_accounting_events WHERE session_id='radius-session-900'")).total, 3);
});

test("RADIUS accounting retries accept a fresh nonce but reject changed event content", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const event = radiusEvent();
  async function send(body) {
    const raw = JSON.stringify(body);
    return env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/accounting",
      headers: signedHeaders(env.config.connectorSigningSecret, raw), payload: raw });
  }
  assert.equal((await send(event)).statusCode, 202);
  const retry = await send({ ...event, nonce: "retry-fresh-nonce-abcdefghijkl", nonceExpiresAt: new Date(Date.now() + 90_000).toISOString() });
  assert.equal(retry.statusCode, 202, retry.body);
  assert.equal(retry.json().data.duplicate, true);
  const conflict = await send({ ...event, nonce: "changed-content-nonce-abcdef", inputBytes: 99 });
  assert.equal(conflict.statusCode, 409, conflict.body);
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM radius_accounting_events WHERE event_id = ?", [event.eventId])).total, 1);
});

test("RADIUS replay nonce is rejected and unknown users raise an alert", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const event = radiusEvent({ eventId: "radius-unknown-01", sessionId: "unknown-session", username: "ghost-user" });
  const raw = JSON.stringify(event);
  const first = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/accounting", headers: signedHeaders(env.config.connectorSigningSecret, raw), payload: raw });
  const replay = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/accounting", headers: signedHeaders(env.config.connectorSigningSecret, raw), payload: raw });
  assert.equal(first.statusCode, 202);
  assert.equal(replay.statusCode, 409);
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM alerts WHERE category='radius'")).total, 1);
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM outbox WHERE topic='telegram.alert'")).total, 1);
});

test("RADIUS connector rejects expired and excessively long nonce lifetimes", async (t) => {
  const env = await setup(); t.after(() => env.close());
  for (const [nonce, nonceExpiresAt] of [
    ["nonce-expired-abcdefgh", new Date(Date.now() - 1_000).toISOString()],
    ["nonce-too-short-abcdefg", new Date(Date.now() + 5_000).toISOString()],
    ["nonce-too-far-abcdefgh", new Date(Date.now() + 11 * 60_000).toISOString()]
  ]) {
    const body = { agentId: "agent-test-1", nonce, nonceExpiresAt };
    const raw = JSON.stringify(body);
    const response = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/commands/claim",
      headers: signedHeaders(env.config.connectorSigningSecret, raw), payload: raw });
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM connector_nonces")).total, 0);
});

test("billing webhook updates a subscription and ignores duplicate events", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const event = { id: "billing-event-0001", type: "subscription.updated", tenantId: "ten_demo_isp", subscriptionId: "sub_demo_trial", externalSubscriptionId: "bill-sub-1", provider: "testpay", status: "active", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString() };
  const raw = JSON.stringify(event);
  const headers = signedHeaders(env.config.billingWebhookSecret, raw);
  const first = await env.app.inject({ method: "POST", url: "/webhooks/billing", headers, payload: raw });
  const duplicate = await env.app.inject({ method: "POST", url: "/webhooks/billing", headers, payload: raw });
  assert.equal(first.statusCode, 202);
  assert.equal(duplicate.statusCode, 202);
  assert.equal(duplicate.json().data.duplicate, true);
  assert.equal((await env.db.get("SELECT status FROM tenant_subscriptions WHERE id='sub_demo_trial'")).status, "active");
});

test("billing webhook rejects a reused event id with changed content", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const event = { id: "billing-event-conflict", type: "subscription.updated", tenantId: "ten_demo_isp",
    subscriptionId: "sub_demo_trial", provider: "testpay", status: "active" };
  const raw = JSON.stringify(event);
  assert.equal((await env.app.inject({ method: "POST", url: "/webhooks/billing",
    headers: signedHeaders(env.config.billingWebhookSecret, raw), payload: raw })).statusCode, 202);
  const changedRaw = JSON.stringify({ ...event, status: "canceled" });
  const changed = await env.app.inject({ method: "POST", url: "/webhooks/billing",
    headers: signedHeaders(env.config.billingWebhookSecret, changedRaw), payload: changedRaw });
  assert.equal(changed.statusCode, 409, changed.body);
  assert.equal((await env.db.get("SELECT status FROM tenant_subscriptions WHERE id='sub_demo_trial'")).status, "active");
});

test("activating a new subscription closes the previous live subscription", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const provider = await devSession(env.app);
  const requested = await env.app.inject({
    method: "POST",
    url: "/api/v1/subscriptions/select",
    headers: headers(provider.token, "ten_demo_isp", { "idempotency-key": "replacement-plan-request" }),
    payload: { productId: "prd_starter" }
  });
  assert.equal(requested.statusCode, 202);
  const event = {
    id: "billing-event-replacement-01",
    type: "subscription.updated",
    tenantId: "ten_demo_isp",
    subscriptionId: requested.json().data.subscriptionId,
    externalSubscriptionId: "bill-sub-replacement",
    provider: "testpay",
    status: "active",
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString()
  };
  const raw = JSON.stringify(event);
  assert.equal((await env.app.inject({ method: "POST", url: "/webhooks/billing", headers: signedHeaders(env.config.billingWebhookSecret, raw), payload: raw })).statusCode, 202);
  const live = await env.db.all("SELECT id,status FROM tenant_subscriptions WHERE tenant_id='ten_demo_isp' ORDER BY created_at");
  assert.equal(live.filter((item) => ["trialing", "active", "grace"].includes(item.status)).length, 1);
  assert.equal(live.find((item) => item.id === "sub_demo_trial").status, "canceled");
});

test("RADIUS agent claims a queued command once and reports a successful result", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const now = nowIso();
  await env.db.run(`INSERT INTO outbox
    (id, tenant_id, topic, payload_json, status, attempts, available_at, locked_at, last_error, created_at, updated_at)
    VALUES ('job-agent-disconnect-001', 'ten_demo_isp', 'radius.session.disconnect', ?, 'pending', 0, ?, NULL, NULL, ?, ?)`,
  [toJson({ sessionId: "ses_demo_active", externalSessionId: "rad-demo-active", username: "ahmad-101", framedIp: "10.10.0.21", nasIp: "192.0.2.10", deviceId: "dev_demo_core" }), now, now, now]);

  const claimBody = { agentId: "agent-test-1", nonce: "claim-nonce-abcdefghijkl", nonceExpiresAt: new Date(Date.now() + 60_000).toISOString() };
  const claimRaw = JSON.stringify(claimBody);
  const claim = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/commands/claim", headers: signedHeaders(env.config.connectorSigningSecret, claimRaw), payload: claimRaw });
  assert.equal(claim.statusCode, 200);
  assert.equal(claim.json().data.command.id, "job-agent-disconnect-001");
  assert.equal(claim.json().data.command.topic, "radius.session.disconnect");

  const emptyBody = { agentId: "agent-test-1", nonce: "claim-nonce-second-abcdef", nonceExpiresAt: new Date(Date.now() + 60_000).toISOString() };
  const emptyRaw = JSON.stringify(emptyBody);
  const empty = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/commands/claim", headers: signedHeaders(env.config.connectorSigningSecret, emptyRaw), payload: emptyRaw });
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.json().data.command, null);

  const resultBody = { agentId: "agent-test-1", nonce: "result-nonce-abcdefghijk", nonceExpiresAt: new Date(Date.now() + 60_000).toISOString(), jobId: "job-agent-disconnect-001", status: "succeeded", detail: "removed one PPP session" };
  const resultRaw = JSON.stringify(resultBody);
  const result = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/commands/result", headers: signedHeaders(env.config.connectorSigningSecret, resultRaw), payload: resultRaw });
  assert.equal(result.statusCode, 200);
  assert.equal((await env.db.get("SELECT status FROM outbox WHERE id='job-agent-disconnect-001'")).status, "sent");
  const session = await env.db.get("SELECT status,terminate_cause FROM radius_sessions WHERE id='ses_demo_active'");
  assert.deepEqual({ ...session }, { status: "stopped", terminate_cause: "Admin-Reset" });
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM audit_logs WHERE action='radius.command.succeeded'")).total, 1);
});

test("RADIUS agent failure is delayed for retry and connector nonces cannot replay", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const now = nowIso();
  await env.db.run(`INSERT INTO outbox
    (id, tenant_id, topic, payload_json, status, attempts, available_at, locked_at, last_error, created_at, updated_at)
    VALUES ('job-agent-sync-00000001', 'ten_demo_isp', 'radius.subscriber.sync', ?, 'pending', 0, ?, NULL, NULL, ?, ?)`,
  [toJson({ subscriberId: "cus_demo_1", username: "ahmad-101", status: "suspended" }), now, now, now]);
  const claimBody = { agentId: "agent-test-1", nonce: "retry-claim-nonce-abcdef", nonceExpiresAt: new Date(Date.now() + 60_000).toISOString() };
  const claimRaw = JSON.stringify(claimBody);
  assert.equal((await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/commands/claim", headers: signedHeaders(env.config.connectorSigningSecret, claimRaw), payload: claimRaw })).statusCode, 200);
  assert.equal((await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/commands/claim", headers: signedHeaders(env.config.connectorSigningSecret, claimRaw), payload: claimRaw })).statusCode, 409);

  const resultBody = { agentId: "agent-test-1", nonce: "retry-result-nonce-abcdef", nonceExpiresAt: new Date(Date.now() + 60_000).toISOString(), jobId: "job-agent-sync-00000001", status: "failed", detail: "router unavailable" };
  const resultRaw = JSON.stringify(resultBody);
  const result = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/commands/result", headers: signedHeaders(env.config.connectorSigningSecret, resultRaw), payload: resultRaw });
  assert.equal(result.statusCode, 200);
  const job = await env.db.get("SELECT status,last_error,available_at FROM outbox WHERE id='job-agent-sync-00000001'");
  assert.equal(job.status, "failed");
  assert.equal(job.last_error, "router unavailable");
  assert.ok(job.available_at > now);
});

test("platform owner rotates a tenant-only RADIUS secret that replaces the development fallback", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const owner = await devSession(env.app, "owner");
  const rotated = await env.app.inject({
    method: "POST",
    url: "/api/v1/owner/tenants/ten_demo_isp/radius-credential",
    headers: headers(owner.token, null, { "idempotency-key": "rotate-radius-tenant-key-01" }),
    payload: { reason: "تجهيز مفتاح منفصل لوكيل الاختبار" }
  });
  assert.equal(rotated.statusCode, 200);
  const secret = rotated.json().data.connectorSecret;
  assert.ok(secret.length >= 32);
  const replay = await env.app.inject({
    method: "POST",
    url: "/api/v1/owner/tenants/ten_demo_isp/radius-credential",
    headers: headers(owner.token, null, { "idempotency-key": "rotate-radius-tenant-key-01" }),
    payload: { reason: "تجهيز مفتاح منفصل لوكيل الاختبار" }
  });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.headers["idempotency-replayed"], "true");
  assert.equal(replay.json().data.connectorSecret, secret);
  const stored = await env.db.get("SELECT secret_ciphertext FROM integrations WHERE tenant_id='ten_demo_isp' AND type='radius'");
  assert.ok(stored.secret_ciphertext);
  assert.equal(stored.secret_ciphertext.includes(secret), false);

  const body = { agentId: "agent-tenant-key", nonce: "tenant-key-nonce-abcdef", nonceExpiresAt: new Date(Date.now() + 60_000).toISOString() };
  const raw = JSON.stringify(body);
  const oldKey = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/commands/claim", headers: signedHeaders(env.config.connectorSigningSecret, raw), payload: raw });
  assert.equal(oldKey.statusCode, 401);
  const freshBody = { ...body, nonce: "tenant-key-nonce-second" };
  const freshRaw = JSON.stringify(freshBody);
  const newKey = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/commands/claim", headers: signedHeaders(secret, freshRaw), payload: freshRaw });
  assert.equal(newKey.statusCode, 200);
});
