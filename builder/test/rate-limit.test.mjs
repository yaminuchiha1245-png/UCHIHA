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
