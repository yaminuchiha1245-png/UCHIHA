import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { signPayload } from "../src/security.js";
import { setup } from "./helpers.js";

async function sendAccounting(env, input) {
  const body = JSON.stringify({
    eventId: input.eventId,
    nonce: "session-nonce-" + randomUUID().replaceAll("-", ""),
    nonceExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    statusType: input.statusType ?? "interim",
    sessionId: "rad-demo-active",
    username: input.username ?? "ahmad-101",
    nasIp: input.nasIp ?? "192.0.2.10",
    occurredAt: new Date().toISOString(),
    inputBytes: input.inputBytes ?? 100_000_000,
    outputBytes: input.outputBytes ?? 300_000_000
  });
  const timestamp = String(Math.floor(Date.now() / 1_000));
  return env.app.inject({
    method: "POST",
    url: "/connectors/radius/elite-demo/accounting",
    headers: {
      "content-type": "application/json",
      "x-uchiha-timestamp": timestamp,
      "x-uchiha-signature": signPayload(env.config.connectorSigningSecret, timestamp, body)
    },
    payload: body
  });
}

test("an overlapping session ID cannot be reassigned to another subscriber or NAS", async t => {
  const env = await setup(); t.after(() => env.close());
  const initial = await env.db.get(
    "SELECT subscriber_id, username, nas_ip, status, input_bytes, output_bytes FROM radius_sessions WHERE external_session_id=?",
    ["rad-demo-active"]);
  assert.equal(initial.username, "ahmad-101");

  const wrongUser = await sendAccounting(env, {
    eventId: "session-collision-wrong-user-001",
    username: "different-subscriber",
    statusType: "stop",
    inputBytes: 999_000_000
  });
  assert.equal(wrongUser.statusCode, 409, wrongUser.body);
  assert.equal(wrongUser.body.includes("different-subscriber"), false);

  const wrongNas = await sendAccounting(env, {
    eventId: "session-collision-wrong-nas-002",
    nasIp: "198.51.100.90",
    statusType: "stop",
    outputBytes: 999_000_000
  });
  assert.equal(wrongNas.statusCode, 409, wrongNas.body);

  const unchanged = await env.db.get(
    "SELECT subscriber_id, username, nas_ip, status, input_bytes, output_bytes FROM radius_sessions WHERE external_session_id=?",
    ["rad-demo-active"]);
  assert.deepEqual({ ...unchanged }, { ...initial },
    "rejected events must not move a subscriber's session, stop it or change its counters");
  assert.equal((await env.db.get("SELECT COUNT(*) AS n FROM radius_accounting_events WHERE event_id LIKE 'session-collision-%'")).n, 0);
  assert.equal((await env.db.get("SELECT COUNT(*) AS n FROM webhook_events WHERE external_id LIKE 'session-collision-%'")).n, 0);
  assert.equal((await env.db.get("SELECT COUNT(*) AS n FROM alerts WHERE category='radius'")).n, 0);

  // Normal counter updates for the same subscriber and NAS are still valid.
  const valid = await sendAccounting(env, {
    eventId: "session-same-identity-interim-003"
  });
  assert.equal(valid.statusCode, 202, valid.body);
  assert.equal(valid.json().data.subscriberMatched, true);
  const after = await env.db.get(
    "SELECT subscriber_id, username, nas_ip, status, input_bytes, output_bytes FROM radius_sessions WHERE external_session_id=?",
    ["rad-demo-active"]);
  assert.equal(after.subscriber_id, initial.subscriber_id);
  assert.equal(after.username, initial.username);
  assert.equal(after.nas_ip, initial.nas_ip);
  assert.equal(after.status, "active");
  assert.equal(after.input_bytes, 100_000_000);
  assert.equal(after.output_bytes, 300_000_000);
});
