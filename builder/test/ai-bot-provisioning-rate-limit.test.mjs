import assert from "node:assert/strict";
import test from "node:test";
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

test("AI BotFather token provisioning uses the strict auth-style rate limit", async () => {
  const hook = createRateLimitHook({
    rateLimitEnabled: true,
    rateLimitWindowMs: 60_000,
    authRateLimitMax: 2,
    purchaseRateLimitMax: 30
  });
  const request = {
    method: "POST",
    ip: "203.0.113.25",
    raw: { url: "/api/platform/ai-bots/00000000-0000-4000-8000-000000000001/token" },
    headers: {}
  };

  await hook(request, replyRecorder());
  const second = replyRecorder();
  await hook(request, second);
  assert.equal(second.headers.get("x-ratelimit-limit"), "2");
  assert.equal(second.headers.get("x-ratelimit-remaining"), "0");
  await assert.rejects(() => hook(request, replyRecorder()), (error) => {
    assert.equal(error.statusCode, 429);
    assert.equal(error.code, "rate_limit_exceeded");
    return true;
  });
});
