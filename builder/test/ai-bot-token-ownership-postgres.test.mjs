import assert from "node:assert/strict";
import test from "node:test";
import { installAiBotProductRoutes } from "../src/ai-bot-product.mjs";
import { installAiBotProvisioningGuard } from "../src/ai-bot-provisioning-guard.mjs";
import { installAiBotTokenOwnershipGuard } from "../src/ai-bot-token-ownership-guard.mjs";
import { createPerBotAiConfig } from "../src/ai-provider-context.mjs";
import { createOwner, createPostgresHarness, postgresAvailable } from "./postgres-helpers.mjs";

const options = postgresAvailable() ? {} : { skip: "TEST_DATABASE_URL is not configured" };

test("regenerated BotFather token for the same Telegram bot cannot be attached to a second product", options, async (context) => {
  const harness = await createPostgresHarness(context, {
    configureApp(app, { db, config }) {
      const perBot = createPerBotAiConfig(
        {
          ...config,
          openAiApiKey: "",
          openAiBaseUrl: "https://api.openai.com/v1",
          openAiBillingUrl: "https://platform.openai.com/settings/organization/billing/overview",
          openAiFreeModel: "gpt-5.6-luna",
          openAiProModel: "gpt-5.6-sol",
          openAiImageModel: "gpt-image-2"
        },
        { db, encryptionKey: config.encryptionKey }
      );
      perBot.install(app);
      installAiBotProvisioningGuard(app, { db });
      installAiBotTokenOwnershipGuard(app, { db, config: perBot.config });
      installAiBotProductRoutes(app, { db, config: perBot.config });
    }
  });
  const { app, db } = harness;
  const owner = await createOwner(app);

  await db.query(
    `UPDATE platform_services SET starting_price_minor=1000, currency='USD',
       status='active', is_catalog_product=TRUE WHERE service_key='ai-chatbot'`
  );
  await db.query(
    `INSERT INTO platform_account_wallets (user_id, currency, balance_minor, held_minor)
     VALUES ($1,'USD',4000,0)
     ON CONFLICT (user_id) DO UPDATE SET balance_minor=4000, held_minor=0, currency='USD'`,
    [owner.id]
  );

  const instanceIds = [];
  for (const [index, name] of ["Bot One", "Bot Two"].entries()) {
    const purchase = await app.inject({
      method: "POST",
      url: "/api/platform/ai-bots/purchase",
      headers: {
        cookie: owner.cookie,
        "x-csrf-token": owner.csrf,
        "idempotency-key": `same-telegram-bot-${index + 1}`
      },
      payload: { displayName: name }
    });
    assert.equal(purchase.statusCode, 201, purchase.body);
    instanceIds.push(purchase.json().instanceId);
  }

  const first = await app.inject({
    method: "POST",
    url: `/api/platform/ai-bots/${instanceIds[0]}/token`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: {
      telegramBotToken: "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ownerTelegramId: "987654321"
    }
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().instance.telegramBotId, "123456789");

  const regenerated = await app.inject({
    method: "POST",
    url: `/api/platform/ai-bots/${instanceIds[1]}/token`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: {
      telegramBotToken: "123456789:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      ownerTelegramId: "987654321"
    }
  });
  assert.equal(regenerated.statusCode, 409, regenerated.body);
  assert.equal(regenerated.json().error, "telegram_bot_in_use");

  const second = (
    await db.query("SELECT telegram_bot_id, token_ciphertext, status FROM ai_bot_instances WHERE id=$1", [instanceIds[1]])
  ).rows[0];
  assert.equal(second.telegram_bot_id, null);
  assert.equal(second.token_ciphertext, null);
  assert.equal(second.status, "awaiting_token");
});
