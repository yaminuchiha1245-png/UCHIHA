import assert from "node:assert/strict";
import test from "node:test";
import { publicHttps, runtimeBlockers } from "../src/ai-product-activation-guard.mjs";

test("AI product activation recognizes only public HTTPS URLs", () => {
  assert.equal(publicHttps("https://uchiha.example"), true);
  assert.equal(publicHttps("http://uchiha.example"), false);
  assert.equal(publicHttps("https://localhost:4100"), false);
  assert.equal(publicHttps("https://127.0.0.1"), false);
  assert.equal(publicHttps("https://10.0.0.5"), false);
  assert.equal(publicHttps("https://172.20.0.5"), false);
  assert.equal(publicHttps("https://192.168.1.5"), false);
});

test("AI product activation blocks incomplete runtime and accepts secure production runtime", () => {
  const secure = {
    nodeEnv: "production",
    databaseMode: "postgres",
    databaseUrl: "postgres://db/uchiha",
    requirePersistentDatabase: true,
    appBaseUrl: "https://uchiha.example",
    cookieSecure: true,
    telegramMode: "live",
    rateLimitEnabled: true,
    previewMemoryMode: false,
    demoSeed: false,
    allowDemoBilling: false
  };
  assert.deepEqual(runtimeBlockers(secure), []);
  const bad = runtimeBlockers({
    ...secure,
    nodeEnv: "development",
    appBaseUrl: "https://localhost:4100",
    cookieSecure: false,
    telegramMode: "fake",
    rateLimitEnabled: false,
    allowDemoBilling: true
  });
  assert.ok(bad.includes("NODE_ENV"));
  assert.ok(bad.includes("HTTPS"));
  assert.ok(bad.includes("Secure Cookie"));
  assert.ok(bad.includes("Telegram live"));
  assert.ok(bad.includes("Rate Limit"));
  assert.ok(bad.includes("Demo mode"));
});
