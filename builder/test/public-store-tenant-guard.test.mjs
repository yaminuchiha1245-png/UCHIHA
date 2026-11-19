import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = new URL("../migrations/039_public_store_requires_active_tenant.sql", import.meta.url);

test("public stores require an active parent tenant", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /NEW\.status\s+IN\s*\('active',\s*'ready'\)/i);
  assert.match(sql, /parent_status\s+IS\s+DISTINCT\s+FROM\s+'active'/i);
  assert.match(sql, /ERRCODE\s*=\s*'23514'/i);
  assert.match(sql, /UPDATE\s+stores[\s\S]*s\.status\s+IN\s*\('active',\s*'ready'\)[\s\S]*t\.status\s*<>\s*'active'/i);
  assert.doesNotMatch(sql, /ready_to_publish[^;]*RAISE EXCEPTION/i);
});
