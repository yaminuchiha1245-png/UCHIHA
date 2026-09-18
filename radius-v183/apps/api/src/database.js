import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

function postgresPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

class SqliteDatabase {
  constructor(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.raw = new DatabaseSync(filePath);
    this.driver = "sqlite";
    this.transactionTail = Promise.resolve();
    this.raw.exec(fs.readFileSync(path.join(moduleDirectory, "schema-sqlite.sql"), "utf8"));
    const ensureColumn = (table, column, definition) => {
      const columns = new Set(this.raw.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name));
      if (!columns.has(column)) this.raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    };
    ensureColumn("tenant_subscriptions", "checkout_url", "TEXT");
    ensureColumn("tenant_subscriptions", "checkout_expires_at", "TEXT");
    ensureColumn("auth_sessions", "installation_hash", "TEXT");
    ensureColumn("network_devices", "site_id", "TEXT REFERENCES network_sites(id) ON DELETE SET NULL");
    ensureColumn("plans", "policy_id", "TEXT REFERENCES radius_policies(id) ON DELETE SET NULL");
    ensureColumn("plans", "ip_pool_id", "TEXT REFERENCES ip_pools(id) ON DELETE SET NULL");
    ensureColumn("plans", "quota_bytes", "INTEGER");
    ensureColumn("plans", "quota_period", "TEXT NOT NULL DEFAULT 'none'");
    ensureColumn("plans", "quota_action", "TEXT NOT NULL DEFAULT 'block'");
    ensureColumn("plans", "throttle_down_mbps", "INTEGER");
    ensureColumn("plans", "throttle_up_mbps", "INTEGER");
    ensureColumn("plans", "duration_days", "INTEGER NOT NULL DEFAULT 30");
    ensureColumn("plans", "simultaneous_use", "INTEGER NOT NULL DEFAULT 1");
    ensureColumn("plans", "scope_type", "TEXT NOT NULL DEFAULT 'all'");
    ensureColumn("plans", "scope_id", "TEXT");
    ensureColumn("subscribers", "policy_id", "TEXT REFERENCES radius_policies(id) ON DELETE SET NULL");
    ensureColumn("subscribers", "ip_pool_id", "TEXT REFERENCES ip_pools(id) ON DELETE SET NULL");
    ensureColumn("subscribers", "radius_secret_ciphertext", "TEXT");
    ensureColumn("subscribers", "credential_version", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn("invoices", "period_start", "TEXT");
    ensureColumn("invoices", "period_end", "TEXT");
    ensureColumn("invoices", "void_reason", "TEXT");
    ensureColumn("alerts", "resolved_by_user_id", "TEXT REFERENCES users(id)");
    ensureColumn("alerts", "resolved_at", "TEXT");
    this.raw.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_subscriber_period ON invoices(tenant_id, subscriber_id, period_start) WHERE period_start IS NOT NULL AND status <> 'void'");
  }

  async all(sql, params = []) {
    return this.raw.prepare(sql).all(...params);
  }

  async get(sql, params = []) {
    return this.raw.prepare(sql).get(...params) ?? null;
  }

  async run(sql, params = []) {
    const result = this.raw.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }

  async exec(sql) {
    this.raw.exec(sql);
  }

  async transaction(callback) {
    const previous = this.transactionTail;
    let release;
    this.transactionTail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      this.raw.exec("BEGIN IMMEDIATE");
      try {
        const result = await callback(this);
        this.raw.exec("COMMIT");
        return result;
      } catch (error) {
        this.raw.exec("ROLLBACK");
        throw error;
      }
    } finally {
      release();
    }
  }

  async withContext(_context, callback) {
    return callback(this);
  }

  async close() {
    this.raw.close();
  }
}

class PostgresConnection {
  constructor(client, release = null) {
    this.client = client;
    this.release = release;
    this.driver = "postgres";
  }

  async all(sql, params = []) {
    const result = await this.getClient().query(postgresPlaceholders(sql), params);
    return result.rows;
  }

  async get(sql, params = []) {
    const result = await this.getClient().query(postgresPlaceholders(sql), params);
    return result.rows[0] ?? null;
  }

  async run(sql, params = []) {
    const result = await this.getClient().query(postgresPlaceholders(sql), params);
    return { changes: result.rowCount, rows: result.rows };
  }

  async exec(sql) {
    await this.getClient().query(sql);
  }

  getClient() {
    return this.client;
  }
}

class PostgresDatabase extends PostgresConnection {
  constructor(databaseUrl) {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 20, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
    pool.on("error", (error) => {
      console.error("PostgreSQL idle connection error", { code: error?.code, message: error?.message });
    });
    super(pool);
    this.pool = pool;
    this.contextStorage = new AsyncLocalStorage();
  }

  getClient() {
    return this.contextStorage.getStore()?.client ?? this.pool;
  }

  async transaction(callback) {
    const active = this.contextStorage.getStore()?.client;
    if (active) return callback(new PostgresConnection(active));
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(new PostgresConnection(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async withContext(context, callback) {
    const existing = this.contextStorage.getStore()?.client;
    if (existing) return callback(this);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [context?.tenantId ?? ""]);
      const result = await this.contextStorage.run({ client }, () => callback(this));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

export function createDatabase(config) {
  return config.databaseDriver === "postgres"
    ? new PostgresDatabase(config.databaseUrl)
    : new SqliteDatabase(config.databasePath);
}

export function createDatabaseForUrl(config, databaseUrl) {
  return config.databaseDriver === "postgres"
    ? new PostgresDatabase(databaseUrl)
    : new SqliteDatabase(config.databasePath);
}

export function createMemoryDatabase() {
  return new SqliteDatabase(":memory:");
}
