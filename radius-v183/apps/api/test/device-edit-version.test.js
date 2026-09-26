import assert from "node:assert/strict";
import test from "node:test";
import { devSession, headers, setup } from "./helpers.js";
import { DEMO } from "../src/seed.js";

async function createRouter(env, token, suffix) {
  const response = await env.app.inject({
    method: "POST", url: "/api/v1/devices",
    headers: headers(token, DEMO.tenantId, { "idempotency-key": "router-edit-create-" + suffix }),
    payload: { name: "Router " + suffix, host: "edit-" + suffix + ".example.test",
      connectionMethod: "agent", apiPort: 8729 }
  });
  assert.equal(response.statusCode, 201, response.body);
  return env.db.get("SELECT * FROM network_devices WHERE id=?", [response.json().data.id]);
}

function edit(env, token, deviceId, payload, key) {
  return env.app.inject({
    method: "PATCH", url: "/api/v1/devices/" + deviceId,
    headers: headers(token, DEMO.tenantId, { "idempotency-key": key }),
    payload: { reason: "Confirmed saved router edit from Telegram", ...payload }
  });
}

test("confirmed MikroTik edit advances a distinct revision and blocks stale bot forms", async t => {
  const env = await setup(); t.after(() => env.close());
  const token = (await devSession(env.app)).token;
  const router = await createRouter(env, token, "revisions");
  const confirmed = { expectedHost: router.host, expectedUpdatedAt: router.updated_at };
  const changed = await edit(env, token, router.id, {
    ...confirmed, name: "Updated Router", host: "edited-revisions.example.test"
  }, "edit-router-snapshot-1");
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(changed.json().data.name, "Updated Router");
  assert.equal(changed.json().data.status, "pending");
  const latest = await env.db.get("SELECT * FROM network_devices WHERE id=?", [router.id]);
  assert.ok(new Date(latest.updated_at).getTime() > new Date(router.updated_at).getTime(),
    "revision must change even for two writes in a single millisecond");
  const oldForm = await edit(env, token, router.id, {
    ...confirmed, name: "Stale overwrites latest", host: "stale-revisions.example.test"
  }, "edit-router-snapshot-2");
  assert.equal(oldForm.statusCode, 409, oldForm.body);
  const preserved = await env.db.get("SELECT * FROM network_devices WHERE id=?", [router.id]);
  assert.equal(preserved.name, "Updated Router");
  assert.equal(preserved.host, "edited-revisions.example.test");
  assert.equal((await env.db.get(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE action='device.update' AND entity_id=?",
    [router.id])).n, 1);
});

test("a reused version with a changed host and an incomplete precondition are rejected", async t => {
  const env = await setup(); t.after(() => env.close());
  const token = (await devSession(env.app)).token;
  const router = await createRouter(env, token, "host-guard");
  await env.db.run("UPDATE network_devices SET host=? WHERE id=?",
    ["new-host-guard.example.test", router.id]);
  const outdatedHost = await edit(env, token, router.id, {
    expectedHost: router.host, expectedUpdatedAt: router.updated_at,
    name: "Must not overwrite"
  }, "edit-router-host-guard");
  assert.equal(outdatedHost.statusCode, 409, outdatedHost.body);
  for (const [key, payload] of [
    ["edit-router-missing-revision", {expectedHost:router.host,name:"Bad precondition"}],
    ["edit-router-missing-host", {expectedUpdatedAt:router.updated_at,name:"Bad precondition"}],
    ["edit-router-only-version", {expectedHost:router.host,expectedUpdatedAt:router.updated_at}]
  ]) {
    const reply = await edit(env, token, router.id, payload, key);
    assert.equal(reply.statusCode, 400, reply.body);
  }
  const row = await env.db.get("SELECT host,name FROM network_devices WHERE id=?", [router.id]);
  assert.equal(row.host, "new-host-guard.example.test");
  assert.equal(row.name, router.name);
});
