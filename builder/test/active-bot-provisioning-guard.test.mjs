import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = new URL("../migrations/046_active_bot_provisioning_guard.sql", import.meta.url);

test("active bots are allowed during connecting_bots only with live subscription and leased job", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /parent_status\s*=\s*'active'/i);
  assert.match(sql, /parent_status\s*=\s*'connecting_bots'/i);
  assert.match(sql, /s\.status\s+IN\s*\('trial',\s*'active'\)/i);
  assert.match(sql, /s\.ends_at\s*>\s*NOW\(\)/i);
  assert.match(sql, /j\.job_type\s+IN\s*\('connect_bots',\s*'publish_store'\)/i);
  assert.match(sql, /j\.status\s*=\s*'running'/i);
  assert.match(sql, /j\.claim_token\s+IS NOT NULL/i);
  assert.match(sql, /j\.lease_expires_at\s*>\s*NOW\(\)/i);
  assert.match(sql, /ERRCODE\s*=\s*'23514'/i);
});

test("expired or unleased provisioning cannot reactivate Telegram connection", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /IF NOT provisioning_allowed THEN/i);
  assert.doesNotMatch(sql, /parent_status\s*=\s*'connecting_bots'\s+THEN\s+RETURN NEW/i);
});
