import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI purchase page discloses separate OpenAI cost and client sends explicit consent", async () => {
  const [html, client] = await Promise.all([
    readFile(new URL("../public/ai-bot-purchase.html", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-bot-purchase.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /name="openAiCostAccepted"/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /لا يشمل تكلفة استخدام OpenAI/);
  assert.match(html, /OpenAI API Key/);
  assert.match(client, /values\.openAiCostAccepted === "on"/);
  assert.match(client, /openAiCostAccepted: true/);
  assert.match(client, /يجب تأكيد أن تكلفة OpenAI منفصلة عن سعر البوت/);
});
