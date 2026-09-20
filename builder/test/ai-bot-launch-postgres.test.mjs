import assert from "node:assert/strict";
import test from "node:test";
import { installAiBotOldWebhookCleanup } from "../src/ai-bot-old-webhook-cleanup.mjs";
import { installAiBotProductIntegration } from "../src/ai-bot-product-integration.mjs";
import { installAiBotProductRoutes } from "../src/ai-bot-product.mjs";
import { installAiBotProvisioningGuard } from "../src/ai-bot-provisioning-guard.mjs";
import { installAiBotTokenOwnershipGuard } from "../src/ai-bot-token-ownership-guard.mjs";
import { installAiBotWebhookAuthentication } from "../src/ai-bot-webhook-auth.mjs";
import { createPerBotAiConfig } from "../src/ai-provider-context.mjs";
import { installAiPurchaseConsent } from "../src/ai-purchase-consent.mjs";
import { installAiPurchaseIdempotencyLock } from "../src/ai-purchase-idempotency-lock.mjs";
import { installAiTelegramAdmin } from "../src/ai-telegram-admin.mjs";
import { installAiTelegramModelCreate } from "../src/ai-telegram-model-create.mjs";
import { installAiTelegramUserAdmin } from "../src/ai-telegram-user-admin.mjs";
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
        openAiImageModel: "gpt-image-2"
      };
      const perBot = createPerBotAiConfig(base, { db, encryptionKey: config.encryptionKey });
      runtimeConfig = perBot.config;
      perBot.install(app);
      installAiBotProductIntegration(app, { db });
      installAiBotProvisioningGuard(app, { db });
      installAiBotOldWebhookCleanup(app, { db, config: runtimeConfig });
      installAiBotTokenOwnershipGuard(app, { db, config: runtimeConfig });
      installAiBotWebhookAuthentication(app, { db });
      installAiPurchaseIdempotencyLock(app, { db, config });
      installAiPurchaseConsent(app, { db });
      installAiTelegramModelCreate(app, { db, config: runtimeConfig });
      installAiTelegramUserAdmin(app, { db, config: runtimeConfig });
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
    payload: { displayName: "Launch AI", openAiCostAccepted: true }
  });
  assert.equal(purchase.statusCode, 201, purchase.body);
  const instanceId = purchase.json().instanceId;
  assert.ok(instanceId);
  const consent = (
    await db.query("SELECT configuration FROM platform_catalog_orders WHERE id=$1", [purchase.json().orderId])
  ).rows[0]?.configuration || {};
  assert.equal(consent.openAiCostAccepted, true);
  assert.ok(consent.openAiCostAcceptedAt);

  const legacyHandoff = await app.inject({
    method: "GET",
    url: `/products/ai-chatbot?instance=${instanceId}`
  });
  assert.equal(legacyHandoff.statusCode, 302, legacyHandoff.body);
  assert.equal(legacyHandoff.headers.location, `/product/ai-chatbot?instance=${instanceId}`);

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
  const webhookHeaders = { "x-telegram-bot-api-secret-token": webhookSecret };
  const ownerMessage = (updateId, text) => ({
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: Number(ownerTelegramId), is_bot: false, first_name: "Owner" },
      chat: { id: Number(ownerTelegramId), type: "private" },
      text
    }
  });
  const ownerCallback = (updateId, data) => ({
    update_id: updateId,
    callback_query: {
      id: `cb-${updateId}`,
      from: { id: Number(ownerTelegramId), is_bot: false, first_name: "Owner" },
      message: { message_id: updateId, chat: { id: Number(ownerTelegramId), type: "private" } },
      data
    }
  });

  const badWebhook = await app.inject({
    method: "POST",
    url: `/webhooks/ai-bots/${instanceId}`,
    headers: { "x-telegram-bot-api-secret-token": "wrong" },
    payload: ownerMessage(88000, "/admin")
  });
  assert.equal(badWebhook.statusCode, 403, badWebhook.body);

  const admin = await app.inject({
    method: "POST",
    url: `/webhooks/ai-bots/${instanceId}`,
    headers: webhookHeaders,
    payload: ownerMessage(88001, "/admin")
  });
  assert.equal(admin.statusCode, 200, admin.body);
  assert.equal(admin.json().admin, true);

  const endUserId = "778899001";
  const startUser = await app.inject({
    method: "POST",
    url: `/webhooks/ai-bots/${instanceId}`,
    headers: webhookHeaders,
    payload: {
      update_id: 88002,
      message: {
        message_id: 2,
        from: { id: Number(endUserId), is_bot: false, first_name: "Customer", username: "customer" },
        chat: { id: Number(endUserId), type: "private" },
        text: "/start"
      }
    }
  });
  assert.equal(startUser.statusCode, 200, startUser.body);

  const missingProPrompt = await app.inject({
    method: "POST",
    url: `/webhooks/ai-bots/${instanceId}`,
    headers: webhookHeaders,
    payload: ownerCallback(88003, "admin:pro:set")
  });
  assert.equal(missingProPrompt.statusCode, 200, missingProPrompt.body);
  const missingProSave = await app.inject({
    method: "POST",
    url: `/webhooks/ai-bots/${instanceId}`,
    headers: webhookHeaders,
    payload: ownerMessage(88004, "999999999 30")
  });
  assert.equal(missingProSave.statusCode, 200, missingProSave.body);
  assert.equal(missingProSave.json().found, false);

  const proSave = await app.inject({
    method: "POST",
    url: `/webhooks/ai-bots/${instanceId}`,
    headers: webhookHeaders,
    payload: ownerMessage(88005, `${endUserId} 30`)
  });
  assert.equal(proSave.statusCode, 200, proSave.body);
  assert.equal(proSave.json().found, true);
  const afterPro = (
    await db.query(
      "SELECT pro_until, is_banned, updated_at FROM ai_bot_end_users WHERE instance_id=$1 AND telegram_user_id=$2",
      [instanceId, endUserId]
    )
  ).rows[0];
  assert.ok(new Date(afterPro.pro_until).getTime() > Date.now());
  assert.equal(afterPro.is_banned, false);
  assert.ok(afterPro.updated_at);

  const banPrompt = await app.inject({
    method: "POST",
    url: `/webhooks/ai-bots/${instanceId}`,
    headers: webhookHeaders,
    payload: ownerCallback(88006, "admin:ban:set")
  });
  assert.equal(banPrompt.statusCode, 200, banPrompt.body);
  const missingBan = await app.inject({
    method: "POST",
    url: `/webhooks/ai-bots/${instanceId}`,
    headers: webhookHeaders,
    payload: ownerMessage(88007, "999999999 on")
  });
  assert.equal(missingBan.statusCode, 200, missingBan.body);
  assert.equal(missingBan.json().found, false);
  const banSave = await app.inject({
    method: "POST",
    url: `/webhooks/ai-bots/${instanceId}`,
    headers: webhookHeaders,
    payload: ownerMessage(88008, `${endUserId} on`)
  });
  assert.equal(banSave.statusCode, 200, banSave.body);
  assert.equal(banSave.json().found, true);
  const afterBan = (
    await db.query(
      "SELECT is_banned FROM ai_bot_end_users WHERE instance_id=$1 AND telegram_user_id=$2",
      [instanceId, endUserId]
    )
  ).rows[0];
  assert.equal(afterBan.is_banned, true);

  const wallet = (
    await db.query("SELECT balance_minor FROM platform_account_wallets WHERE user_id=$1", [owner.id])
  ).rows[0];
  assert.equal(Number(wallet.balance_minor), 1500);
});