import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  installAiBotPromptLease,
  promptIdentity
} from "../src/ai-bot-prompt-lease.mjs";

const instanceId = "11111111-1111-4111-8111-111111111111";

function collector() {
  const hooks = [];
  return {
    hooks,
    app: { addHook(name, fn) { hooks.push({ name, fn }); } }
  };
}

function prompt(text = "hello") {
  return {
    method: "POST",
    raw: { url: `/webhooks/ai-bots/${instanceId}` },
    body: {
      message: {
        text,
        from: { id: 123456789 },
        chat: { id: 123456789 }
      }
    }
  };
}

function reply() {
  return {
    statusCode: 200,
    payload: null,
    code(value) { this.statusCode = value; return this; },
    send(value) { this.payload = value; return this; }
  };
}

test("prompt lease identifies only normal user messages, not commands", () => {
  assert.deepEqual(promptIdentity(prompt("hello")), {
    instanceId,
    telegramUserId: "123456789",
    chatId: 123456789
  });
  assert.equal(promptIdentity(prompt("/admin")), null);
  assert.equal(promptIdentity({ method: "GET", raw: { url: `/webhooks/ai-bots/${instanceId}` } }), null);
});

test("first user prompt acquires a durable row lease and releases it on response", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      const source = String(sql);
      calls.push({ source, params });
      if (source.includes("INSERT INTO ai_bot_prompt_leases")) return { rows: [{ lease_token: params[2] }] };
      if (source.includes("DELETE FROM ai_bot_prompt_leases")) return { rows: [] };
      throw new Error(`unexpected query: ${source}`);
    }
  };
  const { app, hooks } = collector();
  installAiBotPromptLease(app, { db, config: { databaseMode: "postgres" } });
  const pre = hooks.find((item) => item.name === "preHandler").fn;
  const onResponse = hooks.find((item) => item.name === "onResponse").fn;
  const req = prompt();
  await pre(req, reply());
  assert.ok(req.uchihaAiPromptLease?.leaseToken);
  assert.equal(calls.filter((call) => call.source.includes("INSERT INTO ai_bot_prompt_leases")).length, 1);
  await onResponse(req);
  assert.equal(req.uchihaAiPromptLease, null);
  assert.equal(calls.filter((call) => call.source.includes("DELETE FROM ai_bot_prompt_leases")).length, 1);
});

test("concurrent prompt for same user returns busy without acquiring a second lease", async () => {
  let queryCount = 0;
  const db = {
    async query(sql) {
      const source = String(sql);
      queryCount += 1;
      if (source.includes("INSERT INTO ai_bot_prompt_leases")) return { rows: [] };
      if (source.includes("SELECT token_ciphertext FROM ai_bot_instances")) return { rows: [] };
      throw new Error(`unexpected query: ${source}`);
    }
  };
  const { app, hooks } = collector();
  installAiBotPromptLease(app, { db, config: { databaseMode: "postgres" } });
  const pre = hooks.find((item) => item.name === "preHandler").fn;
  const response = reply();
  await pre(prompt(), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, { ok: true, busy: true });
  assert.equal(queryCount, 2);
});

test("prompt lease does not hold a PostgreSQL pool client across OpenAI I/O", async () => {
  const source = await readFile(new URL("../src/ai-bot-prompt-lease.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /db\.pool\.connect/);
  assert.doesNotMatch(source, /pg_advisory_lock/);
  assert.match(source, /ON CONFLICT \(instance_id, telegram_user_id\)/);
  assert.match(source, /expires_at<=NOW\(\)/);
  assert.match(source, /LEASE_INTERVAL = "3 minutes"/);
});
