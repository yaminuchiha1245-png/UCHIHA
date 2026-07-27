import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool: PgPool } = pg;
const migrations = [
  { version: "001_core", url: new URL("../migrations/001_core.sql", import.meta.url), postgresOnly: false },
  {
    version: "002_tenant_rls",
    url: new URL("../migrations/002_tenant_rls.sql", import.meta.url),
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

export async function createDatabase(config) {
  let pool;
  let memory = null;
  if (config.databaseMode === "memory") {
    ({ pool, memory } = await memoryPool());
  } else {
    pool = new PgPool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    });
  }

  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );
  for (const migration of migrations) {
    if (migration.postgresOnly && config.databaseMode !== "postgres") continue;
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [
      migration.version
    ]);
    if (applied.rows[0]) continue;
    const sql = await readFile(fileURLToPath(migration.url), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migration.version]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    pool,
    memory,
    isMemory: config.databaseMode === "memory",
    query(text, values = []) {
      return pool.query(text, values);
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
