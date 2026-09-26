import assert from "node:assert/strict";
import test from "node:test";
import { createTenant, createUserSession, devSession, headers, setup } from "./helpers.js";
import { DEMO } from "../src/seed.js";

async function register(env, token, suffix) {
  const response = await env.app.inject({
    method: "POST", url: "/api/v1/devices",
    headers: headers(token, DEMO.tenantId, { "idempotency-key": "register-delete-" + suffix }),
    payload: { name: "Removable Router " + suffix, host: "router-" + suffix + ".example.test",
      connectionMethod: "agent", apiPort: 8729 }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (await env.db.get("SELECT * FROM network_devices WHERE id=?", [response.json().data.id]));
}
function deleteRequest(env, token, router, key = "delete-router-test", changes = {}) {
  return env.app.inject({ method: "DELETE", url: "/api/v1/devices/" + router.id,
    headers: headers(token, DEMO.tenantId, { "idempotency-key": key }),
    payload: { expectedHost: router.host, expectedUpdatedAt: router.updated_at,
      reason: "Owner confirmed MikroTik record deletion", ...changes } });
}

test("owner deletes only the confirmed router and historical sessions survive detached", async t => {
  const env = await setup(); t.after(() => env.close());
  const token = (await devSession(env.app)).token;
  const router = await register(env, token, "history");
  await env.db.run("UPDATE radius_sessions SET device_id=?,status='stopped' WHERE id='ses_demo_active'", [router.id]);
  const first = await deleteRequest(env, token, router);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().data.deleted, true);
  assert.equal(first.json().data.id, router.id);
  assert.equal(await env.db.get("SELECT id FROM network_devices WHERE id=?", [router.id]), undefined);
  assert.equal((await env.db.get("SELECT device_id,status FROM radius_sessions WHERE id='ses_demo_active'")).device_id, null);
  assert.ok(await env.db.get("SELECT id FROM network_devices WHERE id='dev_demo_core'"));
  const audit = await env.db.get("SELECT before_json,after_json FROM audit_logs WHERE action='device.delete' AND entity_id=?", [router.id]);
  assert.ok(audit);
  assert.equal(audit.before_json.includes("secret_ciphertext"), false);
  const replay = await deleteRequest(env, token, router);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.headers["idempotency-replayed"], "true");
  const missing = await deleteRequest(env, token, router, "delete-other-key");
  assert.equal(missing.statusCode, 404, missing.body);
});

test("deletion rejects changed versions, active sessions and queued disconnects", async t => {
  const env = await setup(); t.after(() => env.close());
  const token = (await devSession(env.app)).token;
  const router = await register(env, token, "busy");
  await env.db.run("UPDATE network_devices SET updated_at=? WHERE id=?",
    [new Date(Date.now() + 60_000).toISOString(), router.id]);
  const stale = await deleteRequest(env, token, router, "stale-delete");
  assert.equal(stale.statusCode, 409, stale.body);
  const fresh = await env.db.get("SELECT * FROM network_devices WHERE id=?", [router.id]);
  await env.db.run("UPDATE radius_sessions SET device_id=?,status='active' WHERE id='ses_demo_active'", [router.id]);
  const active = await deleteRequest(env, token, fresh, "active-delete");
  assert.equal(active.statusCode, 409, active.body);
  await env.db.run("UPDATE radius_sessions SET status='stopped' WHERE id='ses_demo_active'");
  const now = new Date().toISOString();
  await env.db.run(`INSERT INTO outbox
    (id,tenant_id,topic,payload_json,status,attempts,available_at,locked_at,last_error,created_at,updated_at)
    VALUES ('job_delete_device_pending','ten_demo_isp','radius.session.disconnect',?,'pending',0,?,NULL,NULL,?,?)`,
    [JSON.stringify({deviceId: router.id, externalSessionId: "old-session"}), now, now, now]);
  const busy = await deleteRequest(env, token, fresh, "queued-delete");
  assert.equal(busy.statusCode, 409, busy.body);
  assert.ok(await env.db.get("SELECT id FROM network_devices WHERE id=?", [router.id]));
  await env.db.run("UPDATE outbox SET status='sent' WHERE id='job_delete_device_pending'");
  const deleted = await deleteRequest(env, token, fresh, "clear-delete");
  assert.equal(deleted.statusCode, 200, deleted.body);
});

test("only tenant owner or admin may delete that tenant's MikroTik", async t => {
  const env = await setup(); t.after(() => env.close());
  const owner = (await devSession(env.app)).token;
  const device = await register(env, owner, "isolation");
  const operator = await createUserSession(env.db, env.config, {role:"operator"});
  const denied = await deleteRequest(env, operator.token, device, "operator-delete");
  assert.equal(denied.statusCode, 403, denied.body);
  const anotherTenant = await createTenant(env.db,"router_delete_other");
  const anotherOwner = await createUserSession(env.db, env.config,{tenantId:anotherTenant,role:"owner"});
  const foreign = await env.app.inject({method:"DELETE",url:"/api/v1/devices/"+device.id,
    headers:headers(anotherOwner.token,anotherTenant,{"idempotency-key":"foreign-router-delete"}),
    payload:{expectedHost:device.host,expectedUpdatedAt:device.updated_at,reason:"Attempt cross-tenant delete"}});
  assert.equal(foreign.statusCode, 404, foreign.body);
  assert.ok(await env.db.get("SELECT id FROM network_devices WHERE id=?", [device.id]));
});
