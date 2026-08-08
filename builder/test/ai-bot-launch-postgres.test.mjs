import assert from "node:assert/strict";
import test from "node:test";
import { installAiBotProductIntegration } from "../src/ai-bot-product-integration.mjs";
import { installAiBotProductRoutes } from "../src/ai-bot-product.mjs";
import { installAiBotProvisioningGuard } from "../src/ai-bot-provisioning-guard.mjs";
import { createPerBotAiConfig } from "../src/ai-provider-context.mjs";
import { installAiTelegramAdmin } from "../src/ai-telegram-admin.mjs";
import { installAiTelegramModelCreate } from "../src/ai-telegram-model-create.mjs";
import { decryptSecret } from "../src/security.mjs";
import { createOwner, createPostgresHarness, postgresAvailable } from "./postgres-helpers.mjs";

const options = postgresAvailable() ? {} : { skip: "TEST_DATABASE_URL is not configured" };

test("AI launch flow sells without central OpenAI and provisions an owner-controlled bot", options, async (context) => {
  let runtimeConfig;
  const harness = await createPostgresHarness(context, {
    configureApp(app, { db, config }) {
      const base = {
        ...config,
        openAiApiKey: "",
        openAiBaseUrl: "https://api.openai.com/v1",
        openAiBillingUrl: "https://platform.openai.com/settings/organization/billing/overview",
        openAiFreeModel: "gpt-5.6-luna",
        openAiProModel: "gpt-5.6-sol",
        openAiImageModel: "gpt-image-2",
        aiPlatformDailyRequestLimit: 50000
      };
      const perBot = createPerBotAiConfig(base, { db, encryptionKey: config.encryptionKey });
      runtimeConfig = perBot.config;
      perBot.install(app);
      installAiBotProductIntegration(app, { db, config: base });
      installAiBotProvisioningGuard(app);
      installAiTelegramModelCreate(app, { db, config: runtimeConfig });
      installAiTelegramAdmin(app, { db, config: runtimeConfig });
      installAiBotProductRoutes(app, { db, config: runtimeConfig });
    }
  });
  const { app, db } = harness;
  const owner = await createOwner(app);

  await db.query(
    `UPDATE platform_services
     SET starting_price_minor=1500, currency='USD', status='active', is_catalog_product=TRUE
     WHERE service_key='ai-chatbot'`
  );
  await db.query(
    `INSERT INTO platform_account_wallets (user_id, currency, balance_minor, held_minor)
     VALUES ($1,'USD',3000,0)
     ON CONFLICT (user_id) DO UPDATE SET balance_minor=3000, held_minor=0, currency='USD', updated_at=NOW()`,
    [owner.id]
  );

  const purchase = await app.inject({
    method: "POST",
    url: "/api/platform/ai-bots/purchase",
    headers: {
      cookie: owner.cookie,
      "x-csrf-token": owner.csrf,
      "idempotency-key": "launch-no-central-openai"
    },
    payload: { displayName: "Launch AI" }
  });
  assert.equal(purchase.statusCode, 201, purchase.body);
  const instanceId = purchase.json().instanceId;
  assert.ok(instanceId);

  const missingOwner = await app.inject({
    method: "POST",
    url: `/api/platform/ai-bots/${instanceId}/token`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: { telegramBotToken: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd" }
  });
  assert.equal(missingOwner.statusCode, 422, missingOwner.body);
  assert.equal(missingOwner.json().error, "owner_telegram_id_required");

  const ownerTelegramId = "123456789";
  const activation = await app.inject({
    method: "POST",
    url: `/api/platform/ai-bots/${instanceId}/token`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: {
      telegramBotToken: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
      ownerTelegramId
    }
  });
  assert.equal(activation.statusCode, 200, activation.body);
  assert.equal(activation.json().instance.status, "active");
  assert.equal(activation.json().instance.ownerTelegramId, ownerTelegramId);

  const stored = (
    await db.query(
      `SELECT token_ciphertext, token_masked, webhook_secret_ciphertext,
              owner_telegram_id, openai_api_key_ciphertext
       FROM ai_bot_instances WHERE id=$1`,
      [instanceId]
    )
  ).rows[0];
  assert.equal(stored.owner_telegram_id, ownerTelegramId);
  assert.equal(stored.openai_api_key_ciphertext, null);
  assert.notEqual(stored.token_ciphertext, "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd");
  assert.match(stored.token_masked, /^••••••••/);

  const webhookSecret = decryptSecret(stored.webhook_secret_ciphertext, runtimeConfig.encryptionKey);
  const admin = await app.inject({
    method: "POST",
    url: `/webhooks/ai-bots/${instanceId}`,
    headers: { "x-telegram-bot-api-secret-token": webhookSecret },
    payload: {
      update_id: 88001,
      message: {
        message_id: 1,
        from: { id: Number(ownerTelegramId), is_bot: false, first_name: "Owner" },
        chat: { id: Number(ownerTelegramId), type: "private" },
        text: "/admin"
      }
    }
  });
  assert.equal(admin.statusCode, 200, admin.body);
  assert.equal(admin.json().admin, true);

  const wallet = (
    await db.query("SELECT balance_minor FROM platform_account_wallets WHERE user_id=$1", [owner.id])
  ).rows[0];
  assert.equal(Number(wallet.balance_minor), 1500);
});
