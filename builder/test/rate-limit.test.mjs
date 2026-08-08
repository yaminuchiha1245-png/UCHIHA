import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimitHook } from "../src/rate-limit.mjs";

function replyRecorder() {
  const headers = new Map();
  return {
    header(name, value) {
      headers.set(name.toLowerCase(), String(value));
      return this;
    },
    headers
  };
}

test("sensitive authentication routes are rate limited per client", async () => {
  let timestamp = 1_000;
  const hook = createRateLimitHook(
    {
      rateLimitEnabled: true,
      rateLimitWindowMs: 60_000,
      authRateLimitMax: 2,
      purchaseRateLimitMax: 3
    },
    { now: () => timestamp }
  );
  const request = {
    method: "POST",
    ip: "203.0.113.10",
    raw: { url: "/api/auth/login" },
    headers: {}
  };
  await hook(request, replyRecorder());
  const secondReply = replyRecorder();
  await hook(request, secondReply);
  assert.equal(secondReply.headers.get("x-ratelimit-remaining"), "0");
  await assert.rejects(() => hook(request, replyRecorder()), (error) => {
    assert.equal(error.statusCode, 429);
    assert.equal(error.code, "rate_limit_exceeded");
    return true;
  });
  timestamp += 60_001;
  await hook(request, replyRecorder());
});

test("ordinary read routes are not rate limited", async () => {
  const hook = createRateLimitHook({ rateLimitEnabled: true });
  const reply = replyRecorder();
  await hook(
    { method: "GET", ip: "203.0.113.11", raw: { url: "/api/storefront/demo" }, headers: {} },
    reply
  );
  assert.equal(reply.headers.size, 0);
});

test("public service requests are rate limited without throttling portal reads", async () => {
  const hook = createRateLimitHook({
    rateLimitEnabled: true,
    rateLimitWindowMs: 60_000,
    purchaseRateLimitMax: 1
  });
  const write = {
    method: "POST",
    ip: "203.0.113.12",
    raw: { url: "/api/public/service-requests" },
    headers: {}
  };
  await hook(write, replyRecorder());
  await assert.rejects(() => hook(write, replyRecorder()), (error) => {
    assert.equal(error.statusCode, 429);
    assert.equal(error.code, "rate_limit_exceeded");
    return true;
  });

  const readReply = replyRecorder();
  await hook(
    { method: "GET", ip: "203.0.113.12", raw: { url: "/api/public/portal" }, headers: {} },
    readReply
  );
  assert.equal(readReply.headers.size, 0);
});

test("AI bot purchases share the protected financial-write limit", async () => {
  const hook = createRateLimitHook({
    rateLimitEnabled: true,
    rateLimitWindowMs: 60_000,
    purchaseRateLimitMax: 1
  });
  const request = {
    method: "POST",
    ip: "203.0.113.18",
    raw: { url: "/api/platform/ai-bots/purchase" },
    headers: {}
  };
  const first = replyRecorder();
  await hook(request, first);
  assert.equal(first.headers.get("x-ratelimit-limit"), "1");
  await assert.rejects(() => hook(request, replyRecorder()), /طلبات كثيرة/);
});

test("provider webhooks use their own higher limit", async () => {
  const hook = createRateLimitHook({
    rateLimitEnabled: true,
    webhookRateLimitMax: 2,
    purchaseRateLimitMax: 1
  });
  const request = {
    method: "POST",
    ip: "203.0.113.13",
    raw: { url: "/webhooks/providers/00000000-0000-4000-8000-000000000001" },
    headers: {}
  };
  await hook(request, replyRecorder());
  await hook(request, replyRecorder());
  await assert.rejects(() => hook(request, replyRecorder()), /طلبات كثيرة/);
});

test("AI bot webhooks receive a separate high-volume bucket per bot instance", async () => {
  const hook = createRateLimitHook({
    rateLimitEnabled: true,
    rateLimitWindowMs: 60_000,
    webhookRateLimitMax: 1
  });
  const botA = {
    method: "POST",
    ip: "149.154.167.220",
    raw: { url: "/webhooks/ai-bots/00000000-0000-4000-8000-000000000001" },
    headers: {}
  };
  const botB = {
    ...botA,
    raw: { url: "/webhooks/ai-bots/00000000-0000-4000-8000-000000000002" }
  };
  const first = replyRecorder();
  await hook(botA, first);
  assert.equal(first.headers.get("x-ratelimit-limit"), "600");
  const second = replyRecorder();
  await hook(botB, second);
  assert.equal(second.headers.get("x-ratelimit-remaining"), "599");
});