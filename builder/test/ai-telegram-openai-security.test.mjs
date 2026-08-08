import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("OpenAI administration deletes key messages and offers live self-service checks", async () => {
  const [secretInput, health, start] = await Promise.all([
    readFile(new URL("../src/ai-telegram-secret-input.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/ai-telegram-openai-health.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/start.mjs", import.meta.url), "utf8")
  ]);

  assert.match(secretInput, /session\?\.state !== "openai_key"/);
  assert.match(secretInput, /encryptSecret\(key, config\.encryptionKey\)/);
  assert.match(secretInput, /deleteMessage/);
  assert.match(secretInput, /تم حذف رسالة المفتاح من المحادثة/);
  assert.doesNotMatch(secretInput, /console\.log\([^\n]*key/);

  assert.match(health, /admin:openai:test/);
  assert.match(health, /\/responses/);
  assert.match(health, /Reply only with OK/);
  assert.match(health, /https:\/\/platform\.openai\.com\/api-keys/);
  assert.match(health, /billing\/overview/);

  assert.match(start, /installAiTelegramSecretInput/);
  assert.match(start, /installAiTelegramOpenAiHealth/);
  assert.ok(
    start.indexOf("installAiTelegramSecretInput") < start.lastIndexOf("installAiTelegramAdmin"),
    "secret input handler must be installed before the general Telegram admin handler"
  );
});
