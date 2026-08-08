import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI storefront is purchase-only and hands setup to Telegram", async () => {
  const [html, client, integration, handoff] = await Promise.all([
    readFile(new URL("../public/ai-bot-purchase.html", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-bot-purchase.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ai-bot-product-integration.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/ai-bot-purchase-handoff.mjs", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="purchaseForm"/);
  assert.match(html, /إعداد البوت في Telegram/);
  assert.doesNotMatch(html, /id="tokenForm"/);
  assert.doesNotMatch(html, /id="modelsGrid"/);
  assert.doesNotMatch(html, /تجديد رصيد OpenAI/);
  assert.match(client, /\/api\/platform\/ai-bots\/purchase/);
  assert.match(client, /\/setup-link/);
  assert.doesNotMatch(client, /\/models\//);
  assert.doesNotMatch(client, /\/users\/.*\/pro/);
  assert.match(integration, /sendFile\("ai-bot-purchase\.html"\)/);
  assert.match(integration, /reply\.redirect\("\/product\/ai-chatbot"\)/);
  assert.match(handoff, /setup_code_hash/);
  assert.match(handoff, /telegramUrl/);
});

test("Telegram admin owns OpenAI and operational configuration", async () => {
  const [admin, migration, provider, setupBot, start, env] = await Promise.all([
    readFile(new URL("../src/ai-telegram-admin.mjs", import.meta.url), "utf8"),
    readFile(new URL("../migrations/028_ai_bot_telegram_admin.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/ai-provider-context.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/ai-setup-bot.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/start.mjs", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8")
  ]);

  for (const contract of [
    "admin:openai",
    "admin:models",
    "admin:pro",
    "admin:users",
    "admin:stats",
    "admin:limits",
    "admin:settings"
  ]) assert.match(admin, new RegExp(contract.replace(":", "\\:")));

  assert.match(admin, /encryptSecret\(key, config\.encryptionKey\)/);
  assert.match(admin, /validateOpenAiKey/);
  assert.match(migration, /openai_api_key_ciphertext TEXT/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_bot_admin_sessions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_bot_setup_sessions/);
  assert.match(provider, /context\.openAiApiKey = decryptSecret/);
  assert.match(setupBot, /awaiting_bot_token/);
  assert.match(setupBot, /owner_telegram_id=\$7/);
  assert.match(setupBot, /افتح البوت واكتب \/admin/);
  assert.match(start, /installAiTelegramAdmin/);
  assert.match(start, /installAiSetupBot/);
  assert.match(start, /installAiBotPurchaseHandoff/);
  assert.match(env, /UCHIHA_AI_SETUP_BOT_TOKEN=/);
  assert.match(env, /Each purchased bot owner links their own OpenAI API key from \/admin/);
});

test("database registry includes Telegram admin migration", async () => {
  const source = await readFile(new URL("../src/db.mjs", import.meta.url), "utf8");
  assert.match(source, /version: "028_ai_bot_telegram_admin"/);
  assert.match(source, /\.\.\/migrations\/028_ai_bot_telegram_admin\.sql/);
});
