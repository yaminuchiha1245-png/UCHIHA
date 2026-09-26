import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { signPayload } from "../src/security.js";
import { setup } from "./helpers.js";

const tenantId = "ten_demo_isp";
const route = "/connectors/radius/elite-demo/auth-events";
const base = () => ({
  eventId: "radius-auth-immutable-test-01",
  requestId: "radius-auth-request-001",
  username: "ahmad-101",
  principalType: "subscriber",
  principalId: "cus_demo_1",
  nasIp: "192.0.2.10",
  clientIp: "10.10.0.21",
  result: "accept",
  latencyMs: 9,
  occurredAt: new Date().toISOString()
});

async function send(env, observation, agentId = "first-auth-agent") {
  const payload = JSON.stringify({
    agentId,
    nonce: "auth-nonce-" + randomUUID().replaceAll("-", ""),
    nonceExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...observation
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  return env.app.inject({
    method: "POST", url: route,
    headers: {
      "content-type": "application/json",
      "x-uchiha-timestamp": timestamp,
      "x-uchiha-signature": signPayload(env.config.connectorSigningSecret, timestamp, payload)
    },
    payload
  });
}

test("authentication event retries can rotate nonce and agent, not change immutable content", async t => {
  const env = await setup(); t.after(() => env.close());
  const original = base();
  const first = await send(env, original);
  assert.equal(first.statusCode, 202, first.body);
  assert.equal(first.json().data.duplicate, false);

  const retry = await send(env, original, "replacement-auth-agent");
  assert.equal(retry.statusCode, 202, retry.body);
  assert.equal(retry.json().data.duplicate, true);

  for (const changed of [
    { result: "reject" }, { username: "another-subscriber" },
    { nasIp: "198.51.100.7" }, { principalId: "cus_unrelated" },
    { clientIp: "10.10.0.99" }
  ]) {
    const conflict = await send(env, { ...original, ...changed }, "replacement-auth-agent");
    assert.equal(conflict.statusCode, 409, conflict.body);
  }
  const stored = await env.db.get(
    "SELECT username,result,nas_ip,subscriber_id FROM radius_auth_events WHERE tenant_id=? AND event_id=?",
    [tenantId,original.eventId]);
  assert.deepEqual({ ...stored }, {
    username: original.username, result: original.result,
    nas_ip: original.nasIp, subscriber_id: original.principalId
  });
  assert.equal((await env.db.get(
    "SELECT COUNT(*) AS n FROM radius_auth_events WHERE tenant_id=? AND event_id=?",
    [tenantId,original.eventId])).n, 1);
  assert.equal((await env.db.get(
    "SELECT COUNT(*) AS n FROM webhook_events WHERE provider=? AND external_id=?",
    [`radius-auth:${tenantId}`,original.eventId])).n, 1);
});

test("legacy authentication rows without a fingerprint still reject conflicting retries", async t => {
  const env = await setup(); t.after(() => env.close());
  const original = { ...base(), eventId: "radius-legacy-auth-test-01" };
  assert.equal((await send(env, original)).statusCode, 202);

  // This isolated test simulates an auth row recorded by the older release
  // before webhook content-hash tracking existed.
  await env.db.run("DELETE FROM webhook_events WHERE provider=? AND external_id=?",
    [`radius-auth:${tenantId}`,original.eventId]);
  const replay = await send(env, original, "newer-auth-agent");
  assert.equal(replay.statusCode, 202, replay.body);
  assert.equal(replay.json().data.duplicate, true);

  const changed = await send(env, { ...original, result: "reject" }, "newer-auth-agent");
  assert.equal(changed.statusCode, 409, changed.body);
  assert.equal((await env.db.get(
    "SELECT COUNT(*) AS n FROM radius_auth_events WHERE event_id=?", [original.eventId])).n, 1);
});
