import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI purchase discloses separate OpenAI cost, sends consent and enforces it server-side", async () => {
  const [html, client, server] = await Promise.all([
    readFile(new URL("../public/ai-bot-purchase.html", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-bot-purchase.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ai-purchase-consent.mjs", import.meta.url), "utf8")
  ]);

  assert.match(html, /name="openAiCostAccepted"/);
  assert.match(html, /type="checkbox"[^>]*required|required[^>]*type="checkbox"/);
  assert.match(html, /لا يشمل تكلفة استخدام OpenAI/);
  assert.match(html, /OpenAI API Key/);

  assert.match(client, /openAiCostAccepted: values\.openAiCostAccepted === "on"/);

  assert.match(server, /request\.body\?\.openAiCostAccepted !== true/);
  assert.match(server, /openai_cost_consent_required/);
  assert.match(server, /'openAiCostAccepted', TRUE/);
  assert.match(server, /'openAiCostAcceptedAt', NOW\(\)/);
});
