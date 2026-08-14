import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = new URL("../migrations/043_showcase_tenant_activation_exception.sql", import.meta.url);
const seed = new URL("../src/seed.mjs", import.meta.url);

const SHOWCASE_ID = "00000000-0000-4000-8000-000000000101";

test("subscription activation exception is pinned to the immutable showcase tenant", async () => {
  const [sql, seedSource] = await Promise.all([
    readFile(migration, "utf8"),
    readFile(seed, "utf8")
  ]);
  assert.match(sql, new RegExp(SHOWCASE_ID));
  assert.match(sql, /NEW\.slug\s*=\s*'showcase-demo'/i);
  assert.match(sql, /AND NOT\s*\([\s\S]*showcase-demo[\s\S]*\)/i);
  assert.match(seedSource, new RegExp(`tenantId:\s*"${SHOWCASE_ID}"`));
  assert.match(seedSource, /VALUES \(\$1, 'showcase-demo', 'Nova Digital Demo', 'active'\)/);
});

test("real tenants still require a live unexpired subscription", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /s\.tenant_id\s*=\s*NEW\.id/i);
  assert.match(sql, /s\.status\s+IN\s*\('trial',\s*'active'\)/i);
  assert.match(sql, /s\.ends_at\s*>\s*NOW\(\)/i);
  assert.match(sql, /ERRCODE\s*=\s*'23514'/i);
});
