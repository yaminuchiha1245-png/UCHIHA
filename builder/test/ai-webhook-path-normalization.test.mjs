import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI webhook security layers normalize trailing slashes before matching routes", async () => {
  const [auth, provider, provisioning, limits] = await Promise.all([
    readFile(new URL("../src/ai-bot-webhook-auth.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/ai-provider-context.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/ai-bot-provisioning-guard.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/ai-bot-usage-limits.mjs", import.meta.url), "utf8")
  ]);

  for (const source of [auth, provider, provisioning, limits]) {
    assert.match(source, /\.replace\(\/\\\/\+\$\/, ""\)/);
  }
  assert.match(auth, /invalid_webhook_secret/);
  assert.match(provider, /context\.openAiApiKey = decryptSecret/);
  assert.match(provisioning, /owner_telegram_id_required/);
  assert.match(limits, /COUNT\(\*\)::int AS requests/);
});
