import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../src/db.mjs";

test("proof-first wallet migration applies in memory mode while PostgreSQL RLS stays skipped", async () => {
  const db = await createDatabase({ databaseMode: "memory" });
  try {
    await db.query("SELECT customer_visible FROM payment_methods LIMIT 0");
    await db.query(
      `SELECT id, tenant_id, store_id, customer_id, payment_method_id, currency,
              reference_text, proof_data, status, credited_amount_minor
       FROM wallet_topup_proofs LIMIT 0`
    );
    await db.query(
      `SELECT connection_id, tenant_id, store_id, chat_id, state_key, state_data, expires_at
       FROM admin_bot_sessions LIMIT 0`
    );

    const versions = (await db.query(
      "SELECT version FROM schema_migrations WHERE version IN ($1,$2) ORDER BY version",
      ["034_wallet_proof_admin_bot", "035_wallet_proof_admin_bot_rls"]
    )).rows.map((row) => row.version);

    assert.deepEqual(versions, ["034_wallet_proof_admin_bot"]);
  } finally {
    await db.close();
  }
});
