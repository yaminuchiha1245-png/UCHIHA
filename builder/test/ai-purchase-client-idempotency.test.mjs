import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI purchase client persists one idempotency key until a confirmed successful purchase", async () => {
  const client = await readFile(new URL("../public/ai-bot-purchase.js", import.meta.url), "utf8");
  assert.match(client, /PURCHASE_INTENT_KEY/);
  assert.match(client, /sessionStorage\.getItem\(PURCHASE_INTENT_KEY\)/);
  assert.match(client, /sessionStorage\.setItem\(PURCHASE_INTENT_KEY/);
  assert.match(client, /headers: \{ "idempotency-key": idempotencyKey \}/);
  assert.match(client, /clearPurchaseIntent\(\)/);
  assert.match(client, /result\.duplicate/);
  assert.doesNotMatch(client, /headers: \{ "idempotency-key": crypto\.randomUUID\(\) \}/);
});

test("active purchased bots expose token rotation without exposing the stored secret", async () => {
  const client = await readFile(new URL("../public/ai-bot-purchase.js", import.meta.url), "utf8");
  assert.match(client, /تغيير Bot Token/);
  assert.match(client, /instance\.tokenMasked/);
  assert.doesNotMatch(client, /instance\.tokenCiphertext/);
});
