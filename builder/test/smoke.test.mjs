import assert from "node:assert/strict";
import test from "node:test";

import { runSmoke } from "../src/smoke.mjs";

const securityHeaders = {
  "content-type": "text/html; charset=utf-8",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "content-security-policy": "default-src 'self'; img-src 'self' data: https:"
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "strict-origin-when-cross-origin",
      "content-security-policy": "default-src 'self'"
    }
  });
}

function smokeFetch({ degraded = false, sensitive = false } = {}) {
  return async (url) => {
    const path = new URL(url).pathname;
    if (path === "/") {
      return new Response("<!doctype html><html><body>UCHIHA</body></html>", {
        status: 200,
        headers: securityHeaders
      });
    }
    if (path === "/health") {
      return jsonResponse({
        status: "ok",
        service: "uchiha-builder",
        database: degraded ? "memory-demo" : "postgresql"
      });
    }
    if (path === "/ready") {
      return jsonResponse(
        sensitive
          ? { status: "ready", persistent: true, database: "postgresql", databaseUrl: "secret" }
          : {
              status: degraded ? "degraded" : "ready",
              persistent: !degraded,
              database: degraded ? "memory-demo" : "postgresql",
              migrationCount: degraded ? 10 : 14
            },
        degraded ? 503 : 200
      );
    }
    if (path === "/api/public/config") {
      return jsonResponse({
        demoMode: degraded,
        storeBaseDomain: "stores.example.com",
        templates: [{ key: "one" }, { key: "two" }, { key: "three" }]
      });
    }
    return new Response("not found", { status: 404 });
  };
}

test("staging smoke passes for a persistent deployment with security headers", async () => {
  const result = await runSmoke({
    baseUrl: "https://builder.example.com/",
    fetchImpl: smokeFetch()
  });

  assert.equal(result.ok, true);
  assert.equal(result.persistent, true);
  assert.equal(result.baseUrl, "https://builder.example.com");
  assert.deepEqual(
    result.checks.map((item) => item.name),
    ["homepage", "security_headers", "health", "readiness", "public_config"]
  );
});

test("staging smoke fails closed while the deployment uses memory", async () => {
  await assert.rejects(
    () =>
      runSmoke({
        baseUrl: "https://builder.example.com",
        fetchImpl: smokeFetch({ degraded: true })
      }),
    /ready is degraded/
  );
});

test("degraded preview may be inspected explicitly without being treated as persistent", async () => {
  const result = await runSmoke({
    baseUrl: "https://builder.example.com",
    fetchImpl: smokeFetch({ degraded: true }),
    allowDegraded: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.persistent, false);
  assert.equal(result.checks.find((item) => item.name === "readiness").status, 503);
});

test("smoke audit rejects sensitive configuration fields", async () => {
  await assert.rejects(
    () =>
      runSmoke({
        baseUrl: "https://builder.example.com",
        fetchImpl: smokeFetch({ sensitive: true })
      }),
    /forbidden key: databaseUrl/
  );
});
