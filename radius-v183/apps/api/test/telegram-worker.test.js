import assert from "node:assert/strict";
import test from "node:test";
import { OutboxWorker } from "../src/outbox-worker.js";
import { devSession, headers, setup } from "./helpers.js";
import { nowIso, toJson } from "../src/utils.js";

async function connectTelegram(env, chatId = "-1001234567890", severities = ["warning", "critical"]) {
  const provider = await devSession(env.app);
  const response = await env.app.inject({
    method: "PUT",
    url: "/api/v1/integrations/telegram",
    headers: headers(provider.token, "ten_demo_isp", { "idempotency-key": `telegram-${chatId}` }),
    payload: { chatId, chatLabel: "غرفة التشغيل", enabledSeverities: severities }
  });
  assert.equal(response.statusCode, 200);
}

function telegramUpdate(updateId, chatId, text = "/status") {
  return { update_id: updateId, message: { message_id: updateId + 10, chat: { id: chatId }, text } };
}

test("Telegram webhook authenticates, deduplicates updates and queues one reply", async (t) => {
  const env = await setup({ telegramBotToken: "123456:test-token", telegramWebhookSecret: "webhook-secret-test" });
  t.after(() => env.close());
  await connectTelegram(env);

  const unauthorized = await env.app.inject({ method: "POST", url: "/webhooks/telegram", payload: telegramUpdate(1001, -1001234567890) });
  assert.equal(unauthorized.statusCode, 401);

  const request = {
    method: "POST",
    url: "/webhooks/telegram",
    headers: { "x-telegram-bot-api-secret-token": env.config.telegramWebhookSecret },
    payload: telegramUpdate(1001, -1001234567890)
  };
  const first = await env.app.inject(request);
  const duplicate = await env.app.inject(request);
  assert.equal(first.statusCode, 202);
  assert.equal(first.json().data.ignored, false);
  assert.equal(duplicate.statusCode, 202);
  assert.equal(duplicate.json().data.duplicate, true);
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM outbox WHERE topic='telegram.message'")).total, 1);
});

test("Telegram webhook rejects a reused update id with changed content", async (t) => {
  const env = await setup({ telegramBotToken: "123456:test-token", telegramWebhookSecret: "webhook-secret-test" });
  t.after(() => env.close());
  await connectTelegram(env);
  const requestHeaders = { "x-telegram-bot-api-secret-token": env.config.telegramWebhookSecret };
  const first = await env.app.inject({ method: "POST", url: "/webhooks/telegram", headers: requestHeaders,
    payload: telegramUpdate(1101, -1001234567890, "/status") });
  assert.equal(first.statusCode, 202, first.body);
  const changed = await env.app.inject({ method: "POST", url: "/webhooks/telegram", headers: requestHeaders,
    payload: telegramUpdate(1101, -1001234567890, "/alerts") });
  assert.equal(changed.statusCode, 409, changed.body);
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM outbox WHERE topic='telegram.message'")).total, 1);
});

test("Telegram webhook validates update identifiers before processing", async (t) => {
  const env = await setup({ telegramBotToken: "123456:test-token", telegramWebhookSecret: "webhook-secret-test" });
  t.after(() => env.close());
  const response = await env.app.inject({ method: "POST", url: "/webhooks/telegram",
    headers: { "x-telegram-bot-api-secret-token": env.config.telegramWebhookSecret },
    payload: { update_id: "not-an-integer", message: { chat: { id: 123 }, text: "/status" } } });
  assert.equal(response.statusCode, 400, response.body);
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM webhook_events WHERE provider='telegram'")).total, 0);
});

test("Telegram outbox worker delivers the queued reply and records integration health", async (t) => {
  const calls = [];
  const env = await setup({ telegramBotToken: "123456:test-token", telegramWebhookSecret: "webhook-secret-test" });
  t.after(() => env.close());
  await connectTelegram(env);
  await env.app.inject({
    method: "POST",
    url: "/webhooks/telegram",
    headers: { "x-telegram-bot-api-secret-token": env.config.telegramWebhookSecret },
    payload: telegramUpdate(1002, -1001234567890, "/alerts")
  });

  const worker = new OutboxWorker({
    db: env.db,
    config: env.config,
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200 };
    }
  });
  const result = await worker.runOnce();
  assert.equal(result.status, "sent");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.telegram\.org\/bot123456:test-token\/sendMessage$/);
  assert.equal(calls[0].body.chat_id, -1001234567890);
  assert.equal(calls[0].body.reply_parameters.message_id, 1012);
  assert.match(calls[0].body.text, /دفعة جزئية/);
  assert.equal((await env.db.get("SELECT status FROM outbox WHERE topic='telegram.message'")).status, "sent");
  assert.ok((await env.db.get("SELECT last_seen_at FROM integrations WHERE tenant_id='ten_demo_isp' AND type='telegram'")).last_seen_at);
});

test("Telegram severity filters skip muted alerts without calling the external API", async (t) => {
  const env = await setup({ telegramBotToken: "123456:test-token" });
  t.after(() => env.close());
  await connectTelegram(env, "-1001234567890", ["critical"]);
  const now = nowIso();
  await env.db.run(`INSERT INTO outbox
    (id, tenant_id, topic, payload_json, status, attempts, available_at, locked_at, last_error, created_at, updated_at)
    VALUES ('job-muted-alert', 'ten_demo_isp', 'telegram.alert', ?, 'pending', 0, ?, NULL, NULL, ?, ?)`,
  [toJson({ severity: "warning", title: "تنبيه تجريبي", body: "لا يجب إرساله" }), now, now, now]);
  const worker = new OutboxWorker({ db: env.db, config: env.config, fetchImpl: async () => { throw new Error("must not be called"); } });
  assert.equal((await worker.runOnce()).status, "sent");
  assert.equal((await env.db.get("SELECT status FROM outbox WHERE id='job-muted-alert'")).status, "sent");
});

test("Telegram connection can be tested and disabled without retaining its chat credential", async (t) => {
  const calls = [];
  const env = await setup({ telegramBotToken: "123456:test-token", telegramWebhookSecret: "webhook-secret-test" });
  t.after(() => env.close());
  await connectTelegram(env, "-1005555555555");
  const provider = await devSession(env.app);
  const testResponse = await env.app.inject({
    method: "POST", url: "/api/v1/integrations/telegram/test",
    headers: headers(provider.token, "ten_demo_isp", { "idempotency-key": "telegram-connection-test" }),
    payload: { reason: "اختبار وصول رسالة التشغيل" }
  });
  assert.equal(testResponse.statusCode, 202, testResponse.body);
  const worker = new OutboxWorker({ db: env.db, config: env.config, fetchImpl: async (_url, options) => {
    calls.push(JSON.parse(options.body)); return { ok: true, status: 200 };
  } });
  assert.equal((await worker.runOnce()).status, "sent");
  assert.equal(calls[0].chat_id, "-1005555555555");
  assert.match(calls[0].text, /UCHIHA RADIUS/);

  const disabled = await env.app.inject({
    method: "POST", url: "/api/v1/integrations/telegram/disable",
    headers: headers(provider.token, "ten_demo_isp", { "idempotency-key": "telegram-disable-test" }),
    payload: { reason: "إيقاف الربط وإزالة بيانات المحادثة" }
  });
  assert.equal(disabled.statusCode, 200, disabled.body);
  const stored = await env.db.get("SELECT status,secret_ciphertext FROM integrations WHERE tenant_id='ten_demo_isp' AND type='telegram'");
  assert.deepEqual({ ...stored }, { status: "disabled", secret_ciphertext: null });
});

test("Outbox worker retries failures and recovers an abandoned processing lease", async (t) => {
  const env = await setup({ telegramBotToken: "123456:test-token" });
  t.after(() => env.close());
  const now = nowIso();
  await env.db.run(`INSERT INTO outbox
    (id, tenant_id, topic, payload_json, status, attempts, available_at, locked_at, last_error, created_at, updated_at)
    VALUES ('job-stale-message', 'ten_demo_isp', 'telegram.message', ?, 'processing', 1, ?, ?, NULL, ?, ?)`,
  [toJson({ chatId: "12345", text: "اختبار" }), now, new Date(Date.now() - 180_000).toISOString(), now, now]);
  const worker = new OutboxWorker({ db: env.db, config: env.config, fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.equal((await worker.runOnce()).status, "failed");
  const job = await env.db.get("SELECT status,attempts,last_error,available_at FROM outbox WHERE id='job-stale-message'");
  assert.equal(job.status, "failed");
  assert.equal(job.attempts, 2);
  assert.match(job.last_error, /503/);
  assert.ok(job.available_at > now);
});

test("Outbox worker fails unknown topics instead of silently dropping them", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const now = nowIso();
  await env.db.run(`INSERT INTO outbox
    (id,tenant_id,topic,payload_json,status,attempts,available_at,locked_at,last_error,created_at,updated_at)
    VALUES ('job-unknown-topic','ten_demo_isp','unknown.topic','{}','pending',0,?,NULL,NULL,?,?)`, [now, now, now]);
  const worker = new OutboxWorker({ db: env.db, config: env.config });
  assert.equal((await worker.runOnce()).status, "failed");
  const job = await env.db.get("SELECT status,last_error FROM outbox WHERE id='job-unknown-topic'");
  assert.equal(job.status, "failed");
  assert.match(job.last_error, /Unsupported outbox topic/);
});
