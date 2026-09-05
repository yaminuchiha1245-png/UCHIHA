import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { installAiBotProvisioningGuard } from "../src/ai-bot-provisioning-guard.mjs";
import { installAiBotWebhookAuthentication } from "../src/ai-bot-webhook-auth.mjs";
import { sha256 } from "../src/security.mjs";

function collector() {
  const hooks = [];
  return {
    hooks,
    app: { addHook(name, fn) { hooks.push({ name, fn }); } }
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

test("AI webhook authentication protects a trailing-slash route exactly like the canonical route", async () => {
  const secret = "telegram-webhook-secret";
  const { app, hooks } = collector();
  installAiBotWebhookAuthentication(app, {
    db: {
      async query() {
        return { rows: [{ webhook_secret_hash: sha256(secret) }] };
      }
    }
  });
  const hook = hooks.find((item) => item.name === "preHandler").fn;

  const rejected = reply();
  await hook({
    method: "POST",
    raw: { url: "/webhooks/ai-bots/11111111-1111-4111-8111-111111111111/" },
    headers: { "x-telegram-bot-api-secret-token": "wrong" }
  }, rejected);
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.payload?.error, "invalid_webhook_secret");

  const acceptedRequest = {
    method: "POST",
    raw: { url: "/webhooks/ai-bots/11111111-1111-4111-8111-111111111111/" },
    headers: { "x-telegram-bot-api-secret-token": secret }
  };
  const accepted = reply();
  const result = await hook(acceptedRequest, accepted);
  assert.equal(result, undefined);
  assert.equal(accepted.statusCode, 200);
  assert.equal(acceptedRequest.uchihaAiWebhookAuthenticated, true);
});

test("BotFather provisioning guard requires owner Telegram ID even with a trailing slash", async () => {
  const { app, hooks } = collector();
  installAiBotProvisioningGuard(app, { db: null });
  const hook = hooks.find((item) => item.name === "preHandler").fn;
  const response = reply();
  await hook({
    method: "POST",
    raw: { url: "/api/platform/ai-bots/11111111-1111-4111-8111-111111111111/token/" },
    body: { telegramBotToken: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd" },
    headers: {}
  }, response);
  assert.equal(response.statusCode, 422);
  assert.equal(response.payload?.error, "owner_telegram_id_required");
});

test("per-bot provider context and usage limit modules also normalize webhook paths", async () => {
  const [provider, limits] = await Promise.all([
    readFile(new URL("../src/ai-provider-context.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/ai-bot-usage-limits.mjs", import.meta.url), "utf8")
  ]);
  assert.match(provider, /replace\(\/\\\/\+\$\/, ""\)/);
  assert.match(provider, /context\.openAiApiKey = decryptSecret/);
  assert.match(limits, /replace\(\/\\\/\+\$\/, ""\)/);
  assert.match(limits, /COUNT\(\*\)::int AS requests/);
});
