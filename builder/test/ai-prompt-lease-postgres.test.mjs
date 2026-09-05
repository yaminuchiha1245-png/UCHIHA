import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresHarness, postgresAvailable } from "./postgres-helpers.mjs";

const options = postgresAvailable() ? {} : { skip: "TEST_DATABASE_URL is not configured" };

test("PostgreSQL applies AI prompt lease migration 033 with the expected key and expiry index", options, async (context) => {
  const { db } = await createPostgresHarness(context, { demoSeed: false });
  const status = await db.status();
  assert.ok(status.migrationCount >= 33, `expected migration 033 or later, got ${status.migrationCount}`);

  const migration = (
    await db.query(
      "SELECT 1 AS present FROM schema_migrations WHERE version='033_ai_bot_prompt_leases' LIMIT 1"
    )
  ).rows[0];
  assert.equal(migration?.present, 1);

  const table = (
    await db.query("SELECT to_regclass('public.ai_bot_prompt_leases')::text AS name")
  ).rows[0];
  assert.equal(table?.name, "ai_bot_prompt_leases");

  const primaryKey = (
    await db.query(
      `SELECT pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON t.oid=c.conrelid
       JOIN pg_namespace n ON n.oid=t.relnamespace
       WHERE n.nspname='public' AND t.relname='ai_bot_prompt_leases' AND c.contype='p'`
    )
  ).rows[0]?.definition || "";
  assert.match(primaryKey, /PRIMARY KEY \(instance_id, telegram_user_id\)/);

  const expiryIndex = (
    await db.query("SELECT to_regclass('public.idx_ai_bot_prompt_leases_expiry')::text AS name")
  ).rows[0];
  assert.equal(expiryIndex?.name, "idx_ai_bot_prompt_leases_expiry");
});
