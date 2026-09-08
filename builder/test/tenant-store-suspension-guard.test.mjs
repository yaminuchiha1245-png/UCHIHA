import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../migrations/036_tenant_store_suspension_guard.sql", import.meta.url);

async function migrationSql() {
  return readFile(migrationUrl, "utf8");
}

test("tenant suspension migration fails closed only after an active tenant leaves service", async () => {
  const sql = await migrationSql();
  assert.match(sql, /OLD\.status\s*=\s*'active'\s+AND\s+NEW\.status\s*<>\s*'active'/i);
  assert.match(sql, /UPDATE\s+stores[\s\S]*status\s*=\s*'suspended'/i);
  assert.match(sql, /status\s+IN\s*\('active',\s*'ready'\)/i);
  assert.doesNotMatch(sql, /SET\s+status\s*=\s*'active'/i, "migration must never auto-reactivate stores");
});

test("tenant suspension migration repairs only unambiguously blocked legacy tenants", async () => {
  const sql = await migrationSql();
  assert.match(sql, /t\.status\s+IN\s*\('suspended',\s*'subscription_expired',\s*'review_required'\)/i);
  assert.doesNotMatch(sql, /t\.status\s+IN\s*\([^)]*ready_to_publish/i);
  assert.doesNotMatch(sql, /t\.status\s+IN\s*\([^)]*provisioning_store/i);
});
