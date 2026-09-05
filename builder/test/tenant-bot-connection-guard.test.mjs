import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = new URL("../migrations/040_tenant_bot_connection_guard.sql", import.meta.url);

test("tenant lifecycle disables and restores only validated Telegram connections", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /OLD\.status\s*=\s*'active'\s+AND\s+NEW\.status\s*<>\s*'active'/i);
  assert.match(sql, /SET\s+status='validated'/i);
  assert.match(sql, /OLD\.status\s*<>\s*'active'\s+AND\s+NEW\.status\s*=\s*'active'/i);
  assert.match(sql, /SET\s+status='active'/i);
  assert.match(sql, /WHERE\s+tenant_id=NEW\.id\s+AND\s+status='validated'/i);
  assert.doesNotMatch(sql, /status='revoked'/i);
});

test("legacy active bot connections are disabled for inactive tenants", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /UPDATE\s+bot_connections\s+AS\s+bc/i);
  assert.match(sql, /bc\.status='active'/i);
  assert.match(sql, /t\.status\s*<>\s*'active'/i);
});
