import assert from "node:assert/strict";
import test from "node:test";
import { installAiBotProductRoutes } from "../src/ai-bot-product.mjs";
import { createPerBotAiConfig } from "../src/ai-provider-context.mjs";
import { sha256 } from "../src/security.mjs";
import { createOwner, createPostgresHarness, postgresAvailable } from "./postgres-helpers.mjs";

const options = postgresAvailable() ? {} : { skip: "TEST_DATABASE_URL is not configured" };

test("the same OpenAI credential fingerprint may be reused by multiple purchased bots", options, async (context) => {
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
      installAiBotProductRoutes(app, { db, config: perBot.config });
    }
  });
  const { app, db } = harness;
  const owner = await createOwner(app);

  await db.query(
    `UPDATE platform_services
     SET starting_price_minor=1000, currency='USD', status='active', is_catalog_product=TRUE
     WHERE service_key='ai-chatbot'`
  );
  await db.query(
    `INSERT INTO platform_account_wallets (user_id, currency, balance_minor, held_minor)
     VALUES ($1,'USD',3000,0)
     ON CONFLICT (user_id) DO UPDATE SET balance_minor=3000, held_minor=0, currency='USD', updated_at=NOW()`,
    [owner.id]
  );

  const ids = [];
  for (const [index, name] of ["First AI", "Second AI"].entries()) {
    const purchase = await app.inject({
      method: "POST",
      url: "/api/platform/ai-bots/purchase",
      headers: {
        cookie: owner.cookie,
        "x-csrf-token": owner.csrf,
        "idempotency-key": `reuse-key-${index + 1}`
      },
      payload: { displayName: name }
    });
    assert.equal(purchase.statusCode, 201, purchase.body);
    ids.push(purchase.json().instanceId);
  }

  const fingerprint = sha256("sk-project-shared-across-two-bots-for-test-only");
  await db.query(
    "UPDATE ai_bot_instances SET openai_key_fingerprint=$2 WHERE id=$1",
    [ids[0], fingerprint]
  );
  await db.query(
    "UPDATE ai_bot_instances SET openai_key_fingerprint=$2 WHERE id=$1",
    [ids[1], fingerprint]
  );

  const rows = await db.query(
    `SELECT id, openai_key_fingerprint FROM ai_bot_instances
     WHERE id = ANY($1::uuid[]) ORDER BY id`,
    [ids]
  );
  assert.equal(rows.rows.length, 2);
  assert.ok(rows.rows.every((row) => row.openai_key_fingerprint === fingerprint));
});
