import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const VERSION = "034_wallet_proof_admin_bot";
const URL = new URL("../migrations/034_wallet_proof_admin_bot.sql", import.meta.url);
const RLS_MARKER = "ALTER TABLE wallet_topup_proofs ENABLE ROW LEVEL SECURITY;";
const LOCK_NAME = "uchiha-builder-wallet-proof-schema-v1";

export async function ensureWalletProofSchema(db) {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );
  const already = await db.query("SELECT 1 FROM schema_migrations WHERE version=$1", [VERSION]);
  if (already.rows[0]) return { applied: false, version: VERSION };

  const source = await readFile(fileURLToPath(URL), "utf8");
  const sql = db.mode === "postgres" ? source : source.split(RLS_MARKER)[0];

  await db.transaction(async (client) => {
    if (db.mode === "postgres") {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK_NAME]);
    }
    const current = await client.query("SELECT 1 FROM schema_migrations WHERE version=$1", [VERSION]);
    if (current.rows[0]) return;
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [VERSION]);
  });

  return { applied: true, version: VERSION };
}
