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

function smokeFetch({ mode = "persistent", sensitive = false } = {}) {
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
        database: mode === "persistent" ? "postgresql" : "memory-demo",
        persistent: mode === "persistent",
        preview: mode === "preview"
      });
    }
    if (path === "/ready") {
      if (sensitive) {
        return jsonResponse({ status: "ready", persistent: true, database: "postgresql", databaseUrl: "secret" });
      }
      if (mode === "preview") {
        return jsonResponse({
          status: "demo-ready",
          persistent: false,
          preview: true,
          ephemeral: true,
          database: "memory-demo",
          migrationCount: 10
        });
      }
      if (mode === "degraded") {
        return jsonResponse({
          status: "degraded",
          persistent: false,
          preview: false,
          database: "memory-demo",
          migrationCount: 10
        }, 503);
      }
      return jsonResponse({
        status: "ready",
        persistent: true,
        preview: false,
        database: "postgresql",
        migrationCount: 19
      });
    }
    if (path === "/api/public/config") {
      return jsonResponse({
        demoMode: mode !== "persistent",
        previewMemoryMode: mode === "preview",
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

test("preview memory deployment is a successful non-persistent smoke target", async () => {
  const result = await runSmoke({
    baseUrl: "https://preview.example.com",
    fetchImpl: smokeFetch({ mode: "preview" })
  });

  assert.equal(result.ok, true);
  assert.equal(result.persistent, false);
  const readiness = result.checks.find((item) => item.name === "readiness");
  assert.equal(readiness.status, 200);
  assert.equal(readiness.preview, true);
  assert.equal(readiness.database, "memory-demo");
});

test("production smoke fails closed for an unapproved memory deployment", async () => {
  await assert.rejects(
    () =>
      runSmoke({
        baseUrl: "https://builder.example.com",
        fetchImpl: smokeFetch({ mode: "degraded" })
      }),
    /ready is degraded/
  );
});

test("a degraded deployment may still be inspected only when explicitly allowed", async () => {
  const result = await runSmoke({
    baseUrl: "https://builder.example.com",
    fetchImpl: smokeFetch({ mode: "degraded" }),
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
