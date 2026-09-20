import assert from "node:assert/strict";
import test from "node:test";
import { installAiPurchaseIdempotencyLock } from "../src/ai-purchase-idempotency-lock.mjs";
import { sha256 } from "../src/security.mjs";

function hooks() {
  const values = {};
  return {
    values,
    app: {
      addHook(name, fn) { values[name] = fn; }
    }
  };
}

test("AI purchase idempotency lock is acquired and released for authenticated PostgreSQL purchase", async () => {
  const { app, values } = hooks();
  const calls = [];
  let released = false;
  const client = {
    async query(sql, params) { calls.push({ sql: String(sql), params }); return { rows: [{}] }; },
    release() { released = true; }
  };
  const db = {
    async query(sql) {
      assert.match(String(sql), /FROM sessions/);
      return { rows: [{ id: "user-1", csrf_hash: sha256("csrf-ok") }] };
    },
    pool: { async connect() { return client; } }
  };
  installAiPurchaseIdempotencyLock(app, { db, config: { databaseMode: "postgres" } });

  const request = {
    method: "POST",
    raw: { url: "/api/platform/ai-bots/purchase" },
    headers: { "idempotency-key": "purchase-123", "x-csrf-token": "csrf-ok" },
    cookies: { uchiha_builder_session: "session" }
  };
  await values.preHandler(request);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /pg_advisory_lock\(hashtextextended/);
  assert.equal(calls[0].params[0], "ai-purchase:user-1:purchase-123");
  assert.ok(request.uchihaAiPurchaseLock);

  await values.onResponse(request);
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /pg_advisory_unlock\(hashtextextended/);
  assert.equal(released, true);
  assert.equal(request.uchihaAiPurchaseLock, null);
});

test("AI purchase idempotency lock never opens a PostgreSQL lock for bad CSRF", async () => {
  const { app, values } = hooks();
  let connected = false;
  const db = {
    async query() {
      return { rows: [{ id: "user-1", csrf_hash: sha256("csrf-ok") }] };
    },
    pool: { async connect() { connected = true; throw new Error("must not connect"); } }
  };
  installAiPurchaseIdempotencyLock(app, { db, config: { databaseMode: "postgres" } });
  const request = {
    method: "POST",
    raw: { url: "/api/platform/ai-bots/purchase/" },
    headers: { "idempotency-key": "purchase-123", "x-csrf-token": "wrong" },
    cookies: { uchiha_builder_session: "session" }
  };
  await values.preHandler(request);
  assert.equal(connected, false);
  assert.equal(request.uchihaAiPurchaseLock, undefined);
});
