import assert from "node:assert/strict";
import test from "node:test";
import { installAiBotModelAdminRoutes } from "../src/ai-bot-model-admin.mjs";
import { installAiBotProductIntegration } from "../src/ai-bot-product-integration.mjs";
import { installAiBotProductRoutes } from "../src/ai-bot-product.mjs";
import { decryptSecret } from "../src/security.mjs";
import { createOwner, createPostgresHarness, postgresAvailable } from "./postgres-helpers.mjs";

const options = postgresAvailable() ? {} : { skip: "TEST_DATABASE_URL is not configured" };

function aiConfig(config) {
  return {
    ...config,
    openAiApiKey: "test-openai-key-not-real",
    openAiBaseUrl: "https://api.openai.com/v1",
    openAiBillingUrl: "http://builder.test/products/ai-chatbot",
    openAiFreeModel: "gpt-5.6-luna",
    openAiProModel: "gpt-5.6-sol",
    openAiImageModel: "gpt-image-2"
  };
}

test("PostgreSQL AI bot purchase is atomic, idempotent, encrypts Telegram tokens, and supports merchant model profiles", options, async (context) => {
  let runtimeAiConfig;
  const harness = await createPostgresHarness(context, {
    configureApp(app, { db, config }) {
      runtimeAiConfig = aiConfig(config);
      installAiBotProductRoutes(app, { db, config: runtimeAiConfig });
      installAiBotModelAdminRoutes(app, { db, config: runtimeAiConfig });
      installAiBotProductIntegration(app, { db, config: runtimeAiConfig });
    }
  });
  const { app, db } = harness;
  const owner = await createOwner(app);

  await db.query(
    `UPDATE platform_services
     SET starting_price_minor=2500, currency='USD', status='active', is_catalog_product=TRUE
     WHERE service_key='ai-chatbot'`
  );
  await db.query(
    `INSERT INTO platform_account_wallets (user_id, currency, balance_minor, held_minor)
     VALUES ($1,'USD',5000,0)
     ON CONFLICT (user_id) DO UPDATE SET balance_minor=5000, held_minor=0, currency='USD', updated_at=NOW()`,
    [owner.id]
  );

  const idempotencyKey = "ai-bot-purchase-postgres-1";
  const purchase = await app.inject({
    method: "POST",
    url: "/api/platform/ai-bots/purchase",
    headers: {
      cookie: owner.cookie,
      "x-csrf-token": owner.csrf,
      "idempotency-key": idempotencyKey
    },
    payload: { displayName: "Yamin AI" }
  });
  assert.equal(purchase.statusCode, 201, purchase.body);
  const first = purchase.json();
  assert.ok(first.orderId);
  assert.ok(first.instanceId);
  assert.equal(first.status, "awaiting_token");

  const walletAfterPurchase = (
    await db.query("SELECT balance_minor, held_minor FROM platform_account_wallets WHERE user_id=$1", [owner.id])
  ).rows[0];
  assert.equal(Number(walletAfterPurchase.balance_minor), 2500);
  assert.equal(Number(walletAfterPurchase.held_minor), 0);

  const duplicate = await app.inject({
    method: "POST",
    url: "/api/platform/ai-bots/purchase",
    headers: {
      cookie: owner.cookie,
      "x-csrf-token": owner.csrf,
      "idempotency-key": idempotencyKey
    },
    payload: { displayName: "Yamin AI" }
  });
  assert.equal(duplicate.statusCode, 200, duplicate.body);
  assert.equal(duplicate.json().duplicate, true);
  assert.equal(duplicate.json().instanceId, first.instanceId);

  const walletAfterDuplicate = (
    await db.query("SELECT balance_minor FROM platform_account_wallets WHERE user_id=$1", [owner.id])
  ).rows[0];
  assert.equal(Number(walletAfterDuplicate.balance_minor), 2500);
  assert.equal(
    Number((await db.query("SELECT COUNT(*)::int AS count FROM platform_catalog_orders WHERE user_id=$1", [owner.id])).rows[0].count),
    1
  );
  assert.equal(
    Number((await db.query("SELECT COUNT(*)::int AS count FROM ai_bot_instances WHERE user_id=$1", [owner.id])).rows[0].count),
    1
  );

  const models = await db.query(
    `SELECT display_name, access_level, provider_model
     FROM ai_bot_model_profiles WHERE instance_id=$1 ORDER BY sort_order`,
    [first.instanceId]
  );
  assert.deepEqual(
    models.rows.map((row) => [row.display_name, row.access_level, row.provider_model]),
    [
      ["UCHIHA AI V1", "free", "gpt-5.6-luna"],
      ["UCHIHA AI V2", "pro", "gpt-5.6-sol"]
    ]
  );

  const customModel = await app.inject({
    method: "POST",
    url: `/api/platform/ai-bots/${first.instanceId}/models`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: {
      displayName: "UCHIHA AI Coding",
      accessLevel: "pro",
      baseSlug: "uchiha-v2"
    }
  });
  assert.equal(customModel.statusCode, 201, customModel.body);
  const createdModel = customModel.json().model;
  assert.equal(createdModel.displayName, "UCHIHA AI Coding");
  assert.equal(createdModel.accessLevel, "pro");
  assert.equal(Object.hasOwn(createdModel, "providerModel"), false);
  assert.match(createdModel.slug, /^custom-/);
  const storedCustom = (
    await db.query(
      "SELECT provider_model, reasoning_effort FROM ai_bot_model_profiles WHERE instance_id=$1 AND slug=$2",
      [first.instanceId, createdModel.slug]
    )
  ).rows[0];
  assert.equal(storedCustom.provider_model, "gpt-5.6-sol");
  assert.equal(storedCustom.reasoning_effort, "high");

  const fakeTelegramToken = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd";
  const activation = await app.inject({
    method: "POST",
    url: `/api/platform/ai-bots/${first.instanceId}/token`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: {
      telegramBotToken: fakeTelegramToken,
      displayName: "Yamin AI",
      ownerTelegramId: "123456789",
      welcomeText: "اختر النموذج الذي يناسبك."
    }
  });
  assert.equal(activation.statusCode, 200, activation.body);
  const activated = activation.json().instance;
  assert.equal(activated.status, "active");
  assert.equal(activated.telegramBotId, "123456789");
  assert.match(activated.telegramUsername, /^uchiha_store_123456789_bot$/);
  assert.notEqual(activated.tokenMasked, fakeTelegramToken);

  const stored = (
    await db.query(
      `SELECT token_ciphertext, token_fingerprint, token_masked,
              webhook_secret_ciphertext, status
       FROM ai_bot_instances WHERE id=$1`,
      [first.instanceId]
    )
  ).rows[0];
  assert.equal(stored.status, "active");
  assert.notEqual(stored.token_ciphertext, fakeTelegramToken);
  assert.ok(stored.token_fingerprint);
  assert.equal(decryptSecret(stored.token_ciphertext, runtimeAiConfig.encryptionKey), fakeTelegramToken);

  const webhookSecret = decryptSecret(stored.webhook_secret_ciphertext, runtimeAiConfig.encryptionKey);
  const update = {
    update_id: 9001,
    message: {
      message_id: 44,
      from: { id: 778899001, is_bot: false, first_name: "AI User", username: "ai_user" },
      chat: { id: 778899001, type: "private" },
      text: "/start"
    }
  };
  const webhookHeaders = { "x-telegram-bot-api-secret-token": webhookSecret };
  const firstWebhook = await app.inject({
    method: "POST",
    url: `/webhooks/ai-bots/${first.instanceId}`,
    headers: webhookHeaders,
    payload: update
  });
  assert.equal(firstWebhook.statusCode, 200, firstWebhook.body);
  assert.equal(firstWebhook.json().duplicate, undefined);

  const duplicateWebhook = await app.inject({
    method: "POST",
    url: `/webhooks/ai-bots/${first.instanceId}`,
    headers: webhookHeaders,
    payload: update
  });
  assert.equal(duplicateWebhook.statusCode, 200, duplicateWebhook.body);
  assert.equal(duplicateWebhook.json().duplicate, true);

  const updateLedger = (
    await db.query(
      `SELECT status, attempt_count FROM ai_bot_telegram_updates
       WHERE instance_id=$1 AND update_id=9001`,
      [first.instanceId]
    )
  ).rows[0];
  assert.equal(updateLedger.status, "completed");
  assert.equal(Number(updateLedger.attempt_count), 1);
  assert.equal(
    Number((await db.query("SELECT COUNT(*)::int AS count FROM ai_bot_end_users WHERE instance_id=$1", [first.instanceId])).rows[0].count),
    1
  );

  const deleteCustom = await app.inject({
    method: "DELETE",
    url: `/api/platform/ai-bots/${first.instanceId}/models/${createdModel.slug}`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf }
  });
  assert.equal(deleteCustom.statusCode, 200, deleteCustom.body);
  assert.equal(deleteCustom.json().deleted, true);
  assert.equal(
    Number((await db.query("SELECT COUNT(*)::int AS count FROM ai_bot_model_profiles WHERE instance_id=$1", [first.instanceId])).rows[0].count),
    2
  );

  const ledger = await db.query(
    `SELECT entry_type, amount_minor, balance_after_minor
     FROM platform_account_ledger
     WHERE user_id=$1 AND reference_type='platform_catalog_order'`,
    [owner.id]
  );
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.rows[0].entry_type, "purchase");
  assert.equal(Number(ledger.rows[0].amount_minor), -2500);
  assert.equal(Number(ledger.rows[0].balance_after_minor), 2500);
});