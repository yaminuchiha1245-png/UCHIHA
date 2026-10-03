import assert from "node:assert/strict";
import test from "node:test";
import { runMaintenance } from "../src/maintenance-service.js";
import { devSession, setup } from "./helpers.js";

test("maintenance removes only expired operational records and preserves audit history", async (t) => {
  const env = await setup(); t.after(() => env.close());
  await devSession(env.app);
  const now = Date.parse("2026-09-09T12:00:00.000Z");
  const old = new Date(now - 200 * 86_400_000).toISOString();
  const fresh = new Date(now + 86_400_000).toISOString();
  await env.db.run("UPDATE auth_sessions SET expires_at = ?, revoked_at = ?", [old, old]);
  await env.db.run("INSERT INTO connector_nonces (tenant_id,nonce,expires_at,created_at) VALUES ('ten_demo_isp','maintenance-old-nonce',?,?)", [old, old]);
  await env.db.run("INSERT INTO connector_nonces (tenant_id,nonce,expires_at,created_at) VALUES ('ten_demo_isp','maintenance-new-nonce',?,?)", [fresh, old]);
  await env.db.run(`INSERT INTO idempotency_records
    (id,tenant_id,key,route,request_hash,status_code,response_json,expires_at,created_at)
    VALUES ('idem-maint-old','ten_demo_isp','maintenance-old','POST:/test','hash',200,'{}',?,?)`, [old, old]);
  await env.db.run(`INSERT INTO idempotency_records
    (id,tenant_id,key,route,request_hash,status_code,response_json,expires_at,created_at)
    VALUES ('idem-maint-new','ten_demo_isp','maintenance-new','POST:/test','hash',200,'{}',?,?)`, [fresh, old]);
  await env.db.run("INSERT INTO webhook_events (id,provider,external_id,payload_hash,processed_at) VALUES ('evt-maint-old','test','old','hash',?)", [old]);
  await env.db.run("INSERT INTO webhook_events (id,provider,external_id,payload_hash,processed_at) VALUES ('evt-maint-new','test','new','hash',?)", [fresh]);
  await env.db.run(`INSERT INTO outbox
    (id,tenant_id,topic,payload_json,status,attempts,available_at,locked_at,last_error,created_at,updated_at)
    VALUES ('job-maint-old','ten_demo_isp','test','{}','sent',0,?,NULL,NULL,?,?)`, [old, old, old]);
  await env.db.run(`INSERT INTO outbox
    (id,tenant_id,topic,payload_json,status,attempts,available_at,locked_at,last_error,created_at,updated_at)
    VALUES ('job-maint-new','ten_demo_isp','test','{}','sent',0,?,NULL,NULL,?,?)`, [fresh, fresh, fresh]);
  await env.db.run(`INSERT INTO radius_auth_events
    (id,tenant_id,event_id,request_id,username,result,occurred_at,received_at)
    VALUES ('rau-maint-old','ten_demo_isp','event-maint-old','request-old','old-user','reject',?,?)`, [old, old]);
  await env.db.run(`INSERT INTO radius_accounting_events
    (id,tenant_id,event_id,session_id,status_type,username,occurred_at,received_at)
    VALUES ('rac-maint-old','ten_demo_isp','accounting-maint-old','session-old','stop','old-user',?,?)`, [old, old]);
  const auditBefore = Number((await env.db.get("SELECT COUNT(*) AS total FROM audit_logs")).total);

  const result = await runMaintenance(env.db, { now: new Date(now).toISOString() });
  assert.equal(result.removed.authSessions, 1);
  for (const tableAndId of [
    ["connector_nonces", "nonce", "maintenance-old-nonce"], ["idempotency_records", "id", "idem-maint-old"],
    ["webhook_events", "id", "evt-maint-old"], ["outbox", "id", "job-maint-old"],
    ["radius_auth_events", "id", "rau-maint-old"], ["radius_accounting_events", "id", "rac-maint-old"]
  ]) {
    const [table, column, value] = tableAndId;
    assert.equal((await env.db.get(`SELECT COUNT(*) AS total FROM ${table} WHERE ${column} = ?`, [value])).total, 0);
  }
  assert.ok(await env.db.get("SELECT nonce FROM connector_nonces WHERE nonce='maintenance-new-nonce'"));
  assert.ok(await env.db.get("SELECT id FROM idempotency_records WHERE id='idem-maint-new'"));
  assert.ok(await env.db.get("SELECT id FROM webhook_events WHERE id='evt-maint-new'"));
  assert.ok(await env.db.get("SELECT id FROM outbox WHERE id='job-maint-new'"));
  assert.equal(Number((await env.db.get("SELECT COUNT(*) AS total FROM audit_logs")).total), auditBefore);
});

test("health, readiness and protected metrics expose launch signals without caching", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const health = await env.app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().data.status, "ok");
  assert.match(health.headers["cache-control"], /no-store/);
  const ready = await env.app.inject({ method: "GET", url: "/ready" });
  assert.equal(ready.statusCode, 200, ready.body);
  assert.equal(ready.json().data.ready, true);
  assert.match(ready.headers["cache-control"], /no-store/);
  const metrics = await env.app.inject({ method: "GET", url: "/metrics",
    headers: { authorization: `Bearer ${env.config.metricsToken}` } });
  assert.equal(metrics.statusCode, 200, metrics.body);
  for (const name of ["uchiha_radius_outbox_failed", "uchiha_radius_active_sessions",
    "uchiha_radius_open_critical_alerts", "uchiha_radius_unhealthy_nodes"]) assert.match(metrics.body, new RegExp(name));
  assert.match(metrics.headers["cache-control"], /no-store/);
});

test("readiness rejects a database missing the subscriber access migration", async (t) => {
  const env = await setup(); t.after(() => env.close());
  assert.equal((await env.app.inject({ method: "GET", url: "/ready" })).statusCode, 200);
  await env.db.exec("DROP TABLE subscriber_access_profiles");
  const notReady = await env.app.inject({ method: "GET", url: "/ready" });
  assert.equal(notReady.statusCode, 503, notReady.body);
  assert.equal(notReady.json().data.ready, false);
  assert.match(notReady.headers["cache-control"], /no-store/);
  assert.equal(notReady.body.includes("subscriber_access_profiles"), false);
});
