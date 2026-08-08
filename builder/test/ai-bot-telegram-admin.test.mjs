import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI storefront is purchase plus BotFather token provisioning only", async () => {
  const [html, client, integration, product, guard, start] = await Promise.all([
    readFile(new URL("../public/ai-bot-purchase.html", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-bot-purchase.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ai-bot-product-integration.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/ai-bot-product.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/ai-bot-provisioning-guard.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/start.mjs", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="purchaseForm"/);
  assert.match(html, /Telegram Bot Token/);
  assert.match(html, /كل الإدارة تتم من داخل البوت عبر \/admin/);
  assert.doesNotMatch(html, /id="modelsGrid"/);
  assert.doesNotMatch(html, /تجديد رصيد OpenAI/);
  assert.match(client, /\/api\/platform\/ai-bots\/purchase/);
  assert.match(client, /\/api\/platform\/ai-bots\/\$\{encodeURIComponent\(instanceId\)\}\/token/);
  assert.match(client, /telegramBotToken/);
  assert.match(client, /ownerTelegramId/);
  assert.doesNotMatch(client, /\/setup-link/);
  assert.doesNotMatch(client, /\/models\//);
  assert.doesNotMatch(client, /\/users\/.*\/pro/);
  assert.match(product, /setWebhook/);
  assert.match(integration, /sendFile\("ai-bot-purchase\.html"\)/);
  assert.match(integration, /reply\.redirect\("\/product\/ai-chatbot"\)/);
  assert.match(guard, /owner_telegram_id_required/);
  assert.match(start, /installAiBotProvisioningGuard/);
  assert.doesNotMatch(start, /installAiSetupBot/);
  assert.doesNotMatch(start, /installAiBotPurchaseHandoff/);
});

test("Telegram admin owns OpenAI and complete operational configuration", async () => {
  const [admin, modelCreate, migration, auditMigration, keyReuseMigration, catalogMigration, provider, start, env] = await Promise.all([
    readFile(new URL("../src/ai-telegram-admin.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/ai-telegram-model-create.mjs", import.meta.url), "utf8"),
    readFile(new URL("../migrations/028_ai_bot_telegram_admin.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/029_ai_bot_end_user_audit.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/030_ai_bot_openai_key_reuse.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/031_ai_bot_catalog_launch_copy.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/ai-provider-context.mjs", import.meta.url), "utf8"),
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
  assert.match(modelCreate, /admin:model:add/);
  assert.match(modelCreate, /gpt-5\.6-sol/);
  assert.match(modelCreate, /limit 12|LIMIT 12/i);
  assert.match(migration, /openai_api_key_ciphertext TEXT/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_bot_admin_sessions/);
  assert.match(auditMigration, /ADD COLUMN IF NOT EXISTS updated_at/);
  assert.match(keyReuseMigration, /DROP INDEX IF EXISTS idx_ai_bot_instances_openai_key_fingerprint/);
  assert.doesNotMatch(keyReuseMigration, /CREATE UNIQUE INDEX/);
  assert.match(catalogMigration, /ownerTelegramId/);
  assert.match(catalogMigration, /ربط OpenAI وإدارة Free وPRO من داخل \/admin/);
  assert.match(provider, /context\.openAiApiKey = decryptSecret/);
  assert.match(start, /installAiTelegramModelCreate/);
  assert.match(start, /installAiTelegramAdmin/);
  assert.match(start, /aiPerBotOpenAi: true/);
  assert.match(start, /aiBotTokenProvisioning: "purchase_site"/);
  assert.match(env, /Each purchased bot owner links their own OpenAI API key from \/admin/);
  assert.doesNotMatch(env, /UCHIHA_AI_SETUP_BOT_TOKEN=/);
});

test("database registry includes Telegram AI launch migrations", async () => {
  const source = await readFile(new URL("../src/db.mjs", import.meta.url), "utf8");
  for (const version of [
    "028_ai_bot_telegram_admin",
    "029_ai_bot_end_user_audit",
    "030_ai_bot_openai_key_reuse",
    "031_ai_bot_catalog_launch_copy"
  ]) assert.match(source, new RegExp(`version: "${version}"`));
});
