import assert from "node:assert/strict";
import test from "node:test";

import { installHttpHardening } from "../src/http-hardening.mjs";

function installedHook(config) {
  let hook;
  installHttpHardening(
    {
      addHook(name, handler) {
        assert.equal(name, "onSend");
        hook = handler;
      }
    },
    config
  );
  return hook;
}

function replyRecorder() {
  const headers = new Map();
  return {
    headers,
    reply: {
      header(name, value) {
        headers.set(String(name).toLowerCase(), String(value));
        return this;
      }
    }
  };
}

test("production HTTP hardening installs browser isolation and HSTS", async () => {
  const hook = installedHook({ nodeEnv: "production", cookieSecure: true, demoSeed: false });
  const { headers, reply } = replyRecorder();
  const payload = "ok";

  const result = await hook({ raw: { url: "/assets/app.js" } }, reply, payload);

  assert.equal(result, payload);
  assert.equal(headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.equal(headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  assert.equal(headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(headers.get("x-permitted-cross-domain-policies"), "none");
  assert.equal(headers.has("cache-control"), false);
});

test("sensitive API and administration responses are never cached", async () => {
  const hook = installedHook({ nodeEnv: "production", cookieSecure: true, demoSeed: false });
  for (const url of ["/api/auth/login", "/admin/store-id", "/ready", "/store/demo/wallet?tab=balance"]) {
    const { headers, reply } = replyRecorder();
    await hook({ raw: { url } }, reply, {});
    assert.equal(headers.get("cache-control"), "no-store, max-age=0", url);
    assert.equal(headers.get("pragma"), "no-cache", url);
  }
});

test("demo previews are excluded from search indexing", async () => {
  const hook = installedHook({ nodeEnv: "production", cookieSecure: true, demoSeed: true });
  const { headers, reply } = replyRecorder();

  await hook({ raw: { url: "/" } }, reply, "preview");

  assert.equal(headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
});

test("development does not advertise HSTS", async () => {
  const hook = installedHook({ nodeEnv: "development", cookieSecure: false, demoSeed: false });
  const { headers, reply } = replyRecorder();

  await hook({ raw: { url: "/" } }, reply, "local");

  assert.equal(headers.has("strict-transport-security"), false);
});
