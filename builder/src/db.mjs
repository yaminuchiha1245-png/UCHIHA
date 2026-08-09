import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool: PgPool } = pg;
const MIGRATION_LOCK_NAME = "uchiha-builder-schema-migrations-v1";
const migrations = [
  { version: "001_core", url: new URL("../migrations/001_core.sql", import.meta.url), postgresOnly: false },
  {
    version: "002_tenant_rls",
    url: new URL("../migrations/002_tenant_rls.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "003_wallet_payments",
    url: new URL("../migrations/003_wallet_payments.sql", import.meta.url),
    postgresOnly: false
  },
  {
    version: "004_wallet_rls",
    url: new URL("../migrations/004_wallet_rls.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "005_wallet_hardening",
    url: new URL("../migrations/005_wallet_hardening.sql", import.meta.url),
    postgresOnly: false
  },
  {
    version: "006_wallet_hardening_rls",
    url: new URL("../migrations/006_wallet_hardening_rls.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "007_store_financial_admin",
    url: new URL("../migrations/007_store_financial_admin.sql", import.meta.url),
    postgresOnly: false
  },
  {
    version: "008_store_financial_admin_rls",
    url: new URL("../migrations/008_store_financial_admin_rls.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "009_product_intelligence",
    url: new URL("../migrations/009_product_intelligence.sql", import.meta.url),
    postgresOnly: false
  },
  {
    version: "010_product_intelligence_rls",
    url: new URL("../migrations/010_product_intelligence_rls.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "011_catalog_scale_indexes",
    url: new URL("../migrations/011_catalog_scale_indexes.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "012_worker_leases",
    url: new URL("../migrations/012_worker_leases.sql", import.meta.url),
    postgresOnly: false
  },
  {
    version: "013_worker_claim_indexes",
    url: new URL("../migrations/013_worker_claim_indexes.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "014_tenant_scope_integrity",
    url: new URL("../migrations/014_tenant_scope_integrity.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "015_unified_platform",
    url: new URL("../migrations/015_unified_platform.sql", import.meta.url),
    postgresOnly: false
  },
  {
    version: "016_unified_platform_rls",
    url: new URL("../migrations/016_unified_platform_rls.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "017_unified_scope_integrity",
    url: new URL("../migrations/017_unified_scope_integrity.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "018_storefront_account",
    url: new URL("../migrations/018_storefront_account.sql", import.meta.url),
    postgresOnly: false
  },
  {
    version: "019_storefront_account_rls",
    url: new URL("../migrations/019_storefront_account_rls.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "020_platform_portal",
    url: new URL("../migrations/020_platform_portal.sql", import.meta.url),
    postgresOnly: false
  },
  {
    version: "021_platform_portal_rls",
    url: new URL("../migrations/021_platform_portal_rls.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "022_demo_store_safety",
    url: new URL("../migrations/022_demo_store_safety.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "023_platform_account_core",
    url: new URL("../migrations/023_platform_account_core.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "024_platform_catalog_deposits",
    url: new URL("../migrations/024_platform_catalog_deposits.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "025_ai_bot_product",
    url: new URL("../migrations/025_ai_bot_product.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "026_ai_bot_webhook_idempotency",
    url: new URL("../migrations/026_ai_bot_webhook_idempotency.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "027_ai_bot_usage_limits",
    url: new URL("../migrations/027_ai_bot_usage_limits.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "028_ai_bot_telegram_admin",
    url: new URL("../migrations/028_ai_bot_telegram_admin.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "029_ai_bot_end_user_audit",
    url: new URL("../migrations/029_ai_bot_end_user_audit.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "030_ai_bot_openai_key_reuse",
    url: new URL("../migrations/030_ai_bot_openai_key_reuse.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "031_ai_bot_catalog_launch_copy",
    url: new URL("../migrations/031_ai_bot_catalog_launch_copy.sql", import.meta.url),
    postgresOnly: true
  },
  {
    version: "032_ai_bot_telegram_identity_unique",
    url: new URL("../migrations/032_ai_bot_telegram_identity_unique.sql", import.meta.url),
    postgresOnly: true
  }
];

async function memoryPool() {
  const { newDb, DataType } = await import("pg-mem");
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: randomUUID,
    impure: true
  });
  const adapter = memory.adapters.createPg();
  return { pool: new adapter.Pool(), memory };
}

async function runMigrations(pool, config) {
  const client = await pool.connect();
  let migrationLockHeld = false;
  try {
    if (config.databaseMode === "postgres") {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK_NAME]);
      migrationLockHeld = true;
    }

    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    );

    for (const migration of migrations) {
      if (migration.postgresOnly && config.databaseMode !== "postgres") continue;
      const applied = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [
        migration.version
      ]);
      if (applied.rows[0]) continue;

      const sql = await readFile(fileURLToPath(migration.url), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migration.version]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    if (migrationLockHeld) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_NAME]);
      } catch {
        // The connection may already be unusable. Releasing it lets pg discard it.
      }
    }
    client.release();
  }
}

export async function createDatabase(config) {
  let pool;
  let memory = null;
  if (config.databaseMode === "memory") {
    ({ pool, memory } = await memoryPool());
  } else {
    pool = new PgPool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
      application_name: "uchiha-builder",
      max: config.databasePoolMax ?? 10,
      idleTimeoutMillis: config.databaseIdleTimeoutMs ?? 30_000,
      connectionTimeoutMillis: config.databaseConnectionTimeoutMs ?? 10_000,
      statement_timeout: config.databaseStatementTimeoutMs ?? 30_000
    });
  }

  try {
    await runMigrations(pool, config);
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }

  return {
    pool,
    memory,
    isMemory: config.databaseMode === "memory",
    mode: config.databaseMode,
    query(text, values = []) {
      return pool.query(text, values);
    },
    async ping() {
      const startedAt = Date.now();
      await pool.query("SELECT 1");
      return { ok: true, latencyMs: Date.now() - startedAt };
    },
    async status() {
      const startedAt = Date.now();
      const result = await pool.query("SELECT COUNT(*) AS migration_count FROM schema_migrations");
      return {
        ok: true,
        mode: config.databaseMode,
        migrationCount: Number(result.rows[0]?.migration_count || 0),
        latencyMs: Date.now() - startedAt
      };
    },
    async transaction(callback, tenantId = null) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (tenantId && config.databaseMode === "postgres") {
          await client.query("SELECT set_config('app.tenant_id', $1, TRUE)", [tenantId]);
        }
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  };
}