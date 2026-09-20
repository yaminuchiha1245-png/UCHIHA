import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI purchase page versions launch-critical CSS and JS assets", async () => {
  const html = await readFile(new URL("../public/ai-bot-purchase.html", import.meta.url), "utf8");
  assert.match(html, /ai-bot-purchase\.css\?v=20260809-1/);
  assert.match(html, /ai-bot-purchase\.js\?v=20260809-1/);
  assert.match(html, /name="openAiCostAccepted"/);
});
