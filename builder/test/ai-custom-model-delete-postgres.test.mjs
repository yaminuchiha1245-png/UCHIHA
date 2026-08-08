import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { deleteCustomModel } from "../src/ai-telegram-model-create.mjs";
import { createOwner, createPostgresHarness, postgresAvailable } from "./postgres-helpers.mjs";

const options = postgresAvailable() ? {} : { skip: "TEST_DATABASE_URL is not configured" };

test("Telegram admin deletes only safe custom models and resets affected users", options, async (context) => {
  const harness = await createPostgresHarness(context);
  const { app, db } = harness;
  const owner = await createOwner(app);

  const service = (
    await db.query("SELECT id FROM platform_services WHERE service_key='ai-chatbot' LIMIT 1")
  ).rows[0];
  assert.ok(service?.id);

  const orderId = randomUUID();
  await db.query(
    `INSERT INTO platform_catalog_orders (
       id, user_id, service_id, status, amount_minor, currency,
       configuration, idempotency_key, request_hash
     ) VALUES ($1,$2,$3,'active',0,'USD','{}'::jsonb,$4,$5)`,
    [orderId, owner.id, service.id, `delete-test-${orderId}`, `hash-${orderId}`]
  );

  const instanceId = randomUUID();
  await db.query(
    `INSERT INTO ai_bot_instances (
       id, order_id, user_id, service_id, display_name, status
     ) VALUES ($1,$2,$3,$4,'Delete Test','active')`,
    [instanceId, orderId, owner.id, service.id]
  );

  const baseColumns = `id, instance_id, slug, display_name, provider_model, access_level,
    enabled, sort_order, intelligence_label, analysis_label, image_quality_label,
    coding_label, education_label, max_output_tokens, reasoning_effort,
    image_enabled, image_model, image_quality, system_prompt`;
  const values = `($1,$2,$3,$4,$5,$6,TRUE,$7,'','','','','',1200,'low',TRUE,'gpt-image-2','low','')`;

  await db.query(
    `INSERT INTO ai_bot_model_profiles (${baseColumns}) VALUES ${values}`,
    [randomUUID(), instanceId, "uchiha-v1", "UCHIHA AI V1", "gpt-5.6-luna", "free", 10]
  );
  await db.query(
    `INSERT INTO ai_bot_model_profiles (${baseColumns}) VALUES ${values}`,
    [randomUUID(), instanceId, "uchiha-v2", "UCHIHA AI V2", "gpt-5.6-sol", "pro", 20]
  );
  await db.query(
    `INSERT INTO ai_bot_model_profiles (${baseColumns}) VALUES ${values}`,
    [randomUUID(), instanceId, "custom-pro", "Custom PRO", "gpt-5.6-sol", "pro", 30]
  );

  const builtIn = await deleteCustomModel(db, { id: instanceId }, "uchiha-v1");
  assert.equal(builtIn.ok, false);
  assert.match(builtIn.message, /لا يمكن حذف/);

  const userId = "777888999";
  await db.query(
    `INSERT INTO ai_bot_end_users (
       instance_id, telegram_user_id, full_name, active_model_slug, active_mode
     ) VALUES ($1,$2,'Delete User','custom-pro','coding')`,
    [instanceId, userId]
  );

  const deleted = await deleteCustomModel(db, { id: instanceId }, "custom-pro");
  assert.equal(deleted.ok, true);
  assert.equal(
    Number((await db.query(
      "SELECT COUNT(*)::int AS count FROM ai_bot_model_profiles WHERE instance_id=$1 AND slug='custom-pro'",
      [instanceId]
    )).rows[0].count),
    0
  );
  const resetUser = (
    await db.query(
      `SELECT active_model_slug, active_mode, previous_response_id
       FROM ai_bot_end_users WHERE instance_id=$1 AND telegram_user_id=$2`,
      [instanceId, userId]
    )
  ).rows[0];
  assert.equal(resetUser.active_model_slug, "uchiha-v1");
  assert.equal(resetUser.active_mode, "general");
  assert.equal(resetUser.previous_response_id, null);

  await db.query(
    "UPDATE ai_bot_model_profiles SET enabled=FALSE WHERE instance_id=$1 AND slug='uchiha-v1'",
    [instanceId]
  );
  await db.query(
    `INSERT INTO ai_bot_model_profiles (${baseColumns}) VALUES ${values}`,
    [randomUUID(), instanceId, "custom-only-free", "Only Free", "gpt-5.6-luna", "free", 40]
  );
  const lastFree = await deleteCustomModel(db, { id: instanceId }, "custom-only-free");
  assert.equal(lastFree.ok, false);
  assert.match(lastFree.message, /آخر نموذج مجاني فعال/);
});
