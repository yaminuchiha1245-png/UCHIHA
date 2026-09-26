import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { signPayload } from "../src/security.js";
import { setup } from "./helpers.js";

const route = "/connectors/radius/elite-demo";
const envelope = (agentId = "lease-agent-one") => ({
  agentId, nonce: `nonce-${randomUUID()}`,
  nonceExpiresAt: new Date(Date.now() + 60_000).toISOString()
});

async function signed(env, path, payload) {
  const raw = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return env.app.inject({
    method: "POST", url: route + path,
    headers: { "content-type": "application/json",
      "x-uchiha-timestamp": timestamp,
      "x-uchiha-signature": signPayload(env.config.connectorSigningSecret, timestamp, raw) },
    payload: raw
  });
}

test("an old command result cannot acknowledge a newer lease after a stalled worker", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const jobId = "job_lease_fencing_test";
  const now = new Date().toISOString();
  await env.db.run(`INSERT INTO outbox
    (id,tenant_id,topic,payload_json,status,attempts,available_at,locked_at,last_error,created_at,updated_at)
    VALUES (?,'ten_demo_isp','radius.session.disconnect',?,'pending',0,?,NULL,NULL,?,?)`,
    [jobId, JSON.stringify({ sessionId: "ses_demo_active", username: "ahmad-101",
      deviceId: "dev_demo_core", externalSessionId: "rad-demo-active" }), now, now, now]);

  const first = await signed(env, "/commands/claim", envelope("lease-agent-one"));
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().data.command.id, jobId);
  assert.equal(first.json().data.command.attempt, 1);

  // Only a disposable in-memory database: simulate a >2-minute stalled agent.
  await env.db.run("UPDATE outbox SET locked_at=? WHERE id=?",
    [new Date(Date.now() - 5 * 60_000).toISOString(), jobId]);
  const second = await signed(env, "/commands/claim", envelope("lease-agent-two"));
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(second.json().data.command.id, jobId);
  assert.equal(second.json().data.command.attempt, 2);

  const stale = await signed(env, "/commands/result", {
    ...envelope("lease-agent-one"), jobId, attempt: 1, status: "succeeded" });
  assert.equal(stale.statusCode, 409, stale.body);
  const legacy = await signed(env, "/commands/result", {
    ...envelope("lease-agent-one"), jobId, status: "succeeded" });
  assert.equal(legacy.statusCode, 409, legacy.body);
  let job = await env.db.get("SELECT status,attempts FROM outbox WHERE id=?", [jobId]);
  assert.equal(job.status, "processing");
  assert.equal(job.attempts, 2);
  assert.equal((await env.db.get("SELECT status FROM radius_sessions WHERE id='ses_demo_active'")).status,
    "active");
  assert.equal((await env.db.get("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id=?", [jobId])).n, 0);

  const latest = await signed(env, "/commands/result", {
    ...envelope("lease-agent-two"), jobId, attempt: 2, status: "succeeded" });
  assert.equal(latest.statusCode, 200, latest.body);
  assert.equal(latest.json().data.status, "sent");
  job = await env.db.get("SELECT status,attempts FROM outbox WHERE id=?", [jobId]);
  assert.equal(job.status, "sent");
  assert.equal(job.attempts, 2);
  assert.equal((await env.db.get("SELECT status FROM radius_sessions WHERE id='ses_demo_active'")).status,
    "stopped");
  assert.equal((await env.db.get("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id=?", [jobId])).n, 1);

  const retryAck = await signed(env, "/commands/result", {
    ...envelope("lease-agent-two"), jobId, attempt: 2, status: "succeeded" });
  assert.equal(retryAck.statusCode, 200, retryAck.body);
  assert.equal(retryAck.json().data.duplicate, true);
  const staleAfterComplete = await signed(env, "/commands/result", {
    ...envelope("lease-agent-one"), jobId, attempt: 1, status: "succeeded" });
  assert.equal(staleAfterComplete.statusCode, 409, staleAfterComplete.body);
  assert.equal((await env.db.get("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id=?", [jobId])).n, 1);
});
