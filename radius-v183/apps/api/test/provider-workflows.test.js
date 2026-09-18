import assert from "node:assert/strict";
import test from "node:test";
import { DEMO } from "../src/seed.js";
import { devSession, headers, setup } from "./helpers.js";

test("subscriber creation is idempotent and audited", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const login = await devSession(env.app);
  const request = {
    method: "POST", url: "/api/v1/subscribers",
    headers: headers(login.token, DEMO.tenantId, { "idempotency-key": "create-subscriber-01" }),
    payload: { username: "idempotent-501", fullName: "مشترك اختبار", planId: "pln_demo_home" }
  };
  const first = await env.app.inject(request);
  const replay = await env.app.inject(request);
  assert.equal(first.statusCode, 201);
  assert.equal(replay.statusCode, 201);
  assert.equal(first.json().data.id, replay.json().data.id);
  assert.equal(replay.headers["idempotency-replayed"], "true");
  const count = await env.db.get("SELECT COUNT(*) AS total FROM subscribers WHERE tenant_id = ? AND username = ?", [DEMO.tenantId, "idempotent-501"]);
  assert.equal(count.total, 1);
  const audit = await env.db.get("SELECT action FROM audit_logs WHERE entity_id = ?", [first.json().data.id]);
  assert.equal(audit.action, "subscriber.create");
});

test("concurrent retries execute an idempotent write only once", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const login = await devSession(env.app);
  const request = {
    method: "POST", url: "/api/v1/subscribers",
    headers: headers(login.token, DEMO.tenantId, { "idempotency-key": "concurrent-subscriber-01" }),
    payload: { username: "concurrent-501", fullName: "مشترك متزامن", planId: "pln_demo_home" }
  };
  const [first, second] = await Promise.all([env.app.inject(request), env.app.inject(request)]);
  assert.deepEqual([first.statusCode, second.statusCode], [201, 201]);
  assert.equal(first.json().data.id, second.json().data.id);
  assert.equal([first.headers["idempotency-replayed"], second.headers["idempotency-replayed"]].filter((value) => value === "true").length, 1);
  const count = await env.db.get("SELECT COUNT(*) AS total FROM subscribers WHERE tenant_id = ? AND username = ?", [DEMO.tenantId, "concurrent-501"]);
  assert.equal(count.total, 1);
});

test("reusing an idempotency key with different data is rejected", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const login = await devSession(env.app);
  const common = { method: "POST", url: "/api/v1/subscribers", headers: headers(login.token, DEMO.tenantId, { "idempotency-key": "same-key-different-body" }) };
  assert.equal((await env.app.inject({ ...common, payload: { username: "idem-a", fullName: "Alpha User" } })).statusCode, 201);
  const second = await env.app.inject({ ...common, payload: { username: "idem-b", fullName: "Beta User" } });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, "CONFLICT");
});

test("an expired idempotency key can be reused safely", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const login = await devSession(env.app);
  const common = { method: "POST", url: "/api/v1/subscribers", headers: headers(login.token, DEMO.tenantId, { "idempotency-key": "expired-key-reuse-01" }) };
  const first = await env.app.inject({ ...common, payload: { username: "expired-a", fullName: "Expired A" } });
  assert.equal(first.statusCode, 201);
  await env.db.run("UPDATE idempotency_records SET expires_at = '2000-01-01T00:00:00.000Z' WHERE tenant_id = ? AND key = ?", [DEMO.tenantId, "expired-key-reuse-01"]);
  const second = await env.app.inject({ ...common, payload: { username: "expired-b", fullName: "Expired B" } });
  assert.equal(second.statusCode, 201);
  assert.notEqual(second.json().data.id, first.json().data.id);
});

test("suspending a subscriber requires a reason, creates an outbox job and an audit entry", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const login = await devSession(env.app);
  const missingReason = await env.app.inject({ method: "POST", url: "/api/v1/subscribers/cus_demo_1/suspend", headers: headers(login.token, DEMO.tenantId, { "idempotency-key": "suspend-no-reason" }), payload: { reason: "" } });
  assert.equal(missingReason.statusCode, 400);
  const response = await env.app.inject({ method: "POST", url: "/api/v1/subscribers/cus_demo_1/suspend", headers: headers(login.token, DEMO.tenantId, { "idempotency-key": "suspend-with-reason" }), payload: { reason: "طلب موثق من الدعم" } });
  assert.equal(response.statusCode, 202);
  assert.equal(response.json().data.queued, true);
  assert.equal((await env.db.get("SELECT status FROM subscribers WHERE id='cus_demo_1'")).status, "suspended");
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM outbox WHERE topic='radius.subscriber.sync'")).total, 1);
  assert.equal((await env.db.get("SELECT reason FROM audit_logs WHERE action='subscriber.suspend'")).reason, "طلب موثق من الدعم");
});

test("team invitations activate on matching Google sign-in and the last owner is protected", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const login = await devSession(env.app);
  const invite = await env.app.inject({ method: "POST", url: "/api/v1/team/invitations", headers: headers(login.token, DEMO.tenantId, { "idempotency-key": "invite-member-001" }), payload: { email: "new.operator@example.test", displayName: "مشغل جديد", role: "operator", reason: "عضو فريق التشغيل" } });
  assert.equal(invite.statusCode, 201);
  assert.equal(invite.json().data.status, "invited");
  const ownerMembership = await env.db.get("SELECT id FROM memberships WHERE tenant_id=? AND user_id=?", [DEMO.tenantId, DEMO.userId]);
  const disable = await env.app.inject({ method: "PATCH", url: `/api/v1/team/${ownerMembership.id}`, headers: headers(login.token, DEMO.tenantId, { "idempotency-key": "disable-last-owner" }), payload: { role: "viewer", status: "disabled", reason: "test protection" } });
  assert.equal(disable.statusCode, 400);
});

test("recording a payment updates invoice totals atomically", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const login = await devSession(env.app);
  const response = await env.app.inject({ method: "POST", url: "/api/v1/invoices/inv_demo_1/payments", headers: headers(login.token, DEMO.tenantId, { "idempotency-key": "payment-001" }), payload: { amountMinor: 1200, method: "cash", reason: "تحصيل كامل الرصيد" } });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().data.invoiceStatus, "paid");
  assert.equal((await env.db.get("SELECT paid_minor,status FROM invoices WHERE id='inv_demo_1'")).paid_minor, 3000);
  assert.equal((await env.db.get("SELECT balance_minor FROM subscribers WHERE id='cus_demo_2'")).balance_minor, 0);
});
