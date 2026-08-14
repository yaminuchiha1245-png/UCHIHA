import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = new URL("../migrations/041_active_bot_requires_active_tenant.sql", import.meta.url);

test("active Telegram bot connections require an active tenant", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /NEW\.status\s*=\s*'active'/i);
  assert.match(sql, /parent_status\s+IS\s+DISTINCT\s+FROM\s+'active'/i);
  assert.match(sql, /ERRCODE\s*=\s*'23514'/i);
  assert.match(sql, /UPDATE\s+bot_connections[\s\S]*status='validated'/i);
});
