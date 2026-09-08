import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("platform owner has a mobile pricing surface while customer administration stays in Telegram", async () => {
  const [page, client, platformAdmin, start] = await Promise.all([
    readFile(new URL("../public/platform-ai-product.html", import.meta.url), "utf8"),
    readFile(new URL("../public/platform-ai-product.js", import.meta.url), "utf8"),
    readFile(new URL("../public/platform-admin.html", import.meta.url), "utf8"),
    readFile(new URL("../src/start.mjs", import.meta.url), "utf8")
  ]);

  assert.match(page, /مدير UCHIHA فقط/);
  assert.match(page, /سعر البيع/);
  assert.match(page, /حالة المنتج/);
  assert.match(page, /إدارة كل بوت مشتَرى تبقى داخل Telegram عبر \/admin/);
  assert.doesNotMatch(page, /Telegram Bot Token/);
  assert.doesNotMatch(page, /OpenAI API Key/);

  assert.match(client, /\/api\/platform\/admin\/ai-product/);
  assert.match(client, /priceMinor/);
  assert.match(client, /method: "PATCH"/);
  assert.match(platformAdmin, /\/platform-ai-product\.html/);
  assert.match(start, /app\.get\("\/platform-ai-product"/);
  assert.match(start, /app\.get\("\/platform-ai-product\.html"/);
});
