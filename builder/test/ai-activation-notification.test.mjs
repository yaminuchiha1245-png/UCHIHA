import assert from "node:assert/strict";
import test from "node:test";
import { alignActivationNotification } from "../src/ai-bot-product-integration.mjs";

const instanceId = "11111111-1111-4111-8111-111111111111";

function request() {
  return {
    method: "POST",
    raw: { url: `/api/platform/ai-bots/${instanceId}/token` },
    log: { error() {} }
  };
}

test("successful token activation rewrites legacy notification to per-bot OpenAI admin copy", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [] };
    }
  };
  await alignActivationNotification(db, request(), {
    instance: {
      id: instanceId,
      telegramUsername: "uchiha_launch_bot"
    }
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params.slice(0, 1), [`/products/ai-chatbot?instance=${instanceId}`]);
  const body = calls[0].params[1];
  assert.match(body, /@uchiha_launch_bot/);
  assert.match(body, /\/admin/);
  assert.match(body, /OpenAI الخاص بهذا البوت/);
  assert.doesNotMatch(body, /المركزية/);
});

test("notification rewrite failure never turns a successful activation into an error", async () => {
  const logged = [];
  const req = request();
  req.log = { error(value, message) { logged.push({ value, message }); } };
  const db = { async query() { throw new Error("notifications unavailable"); } };

  const result = await alignActivationNotification(db, req, {
    instance: { id: instanceId, telegramUsername: "uchiha_launch_bot" }
  });

  assert.equal(result, undefined);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].value.instanceId, instanceId);
});

test("non-token responses do not touch activation notifications", async () => {
  let called = false;
  const db = { async query() { called = true; return { rows: [] }; } };
  await alignActivationNotification(db, {
    method: "GET",
    raw: { url: `/api/platform/ai-bots/${instanceId}` },
    log: { error() {} }
  }, { instance: { id: instanceId } });
  assert.equal(called, false);
});
