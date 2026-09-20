import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bootstrapProductionCore } from "../src/production-bootstrap.mjs";

const config = {
  nodeEnv: "production",
  previewMemoryMode: false,
  databaseMode: "postgres",
  offerSeed: {},
  platformAdminEmail: "",
  platformAdminPassword: ""
};

test("production bootstrap is skipped outside persistent production", async () => {
  let queried = false;
  const result = await bootstrapProductionCore(
    { async query() { queried = true; return { rows: [] }; } },
    { ...config, nodeEnv: "test" }
  );
  assert.equal(result.skipped, true);
  assert.equal(queried, false);
});

test("production bootstrap does not overwrite existing offer/admin or touch payment destinations", async () => {
  const queries = [];
  const db = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes("SELECT id FROM platform_services WHERE service_key")) return { rows: [{ id: "service" }] };
      if (sql.includes("SELECT * FROM subscription_offers")) {
        return { rows: [{ id: "offer", currency: "USD", price_minor: 1000, renewal_price_minor: 1000 }] };
      }
      if (sql.includes("count(*)::int AS count FROM platform_users")) return { rows: [{ count: 1 }] };
      if (sql.includes("count(*)::int AS count FROM platform_services")) return { rows: [{ count: 14 }] };
      return { rows: [] };
    }
  };
  const result = await bootstrapProductionCore(db, config);
  assert.equal(result.skipped, false);
  assert.equal(result.offerCreated, false);
  assert.equal(result.adminCreatedOrPromoted, false);
  assert.equal(result.offerPresent, true);
  assert.equal(result.activeAdminPresent, true);
  const combined = queries.map((entry) => entry.sql).join("\n").toLowerCase();
  assert.doesNotMatch(combined, /update\s+subscription_offers/);
  assert.doesNotMatch(combined, /update\s+platform_users/);
  assert.doesNotMatch(combined, /platform_payment_methods/);
  assert.doesNotMatch(combined, /payment_method_instructions/);
  assert.doesNotMatch(combined, /api_providers/);
  assert.doesNotMatch(combined, /showcase-demo/);
});

test("missing production sale credentials stay missing instead of receiving invented values", async () => {
  let offerReads = 0;
  const db = {
    async query(sql) {
      if (sql.includes("SELECT id FROM platform_services WHERE service_key")) return { rows: [{ id: "service" }] };
      if (sql.includes("SELECT * FROM subscription_offers")) {
        offerReads += 1;
        return { rows: [] };
      }
      if (sql.includes("count(*)::int AS count FROM platform_users")) return { rows: [{ count: 0 }] };
      if (sql.includes("count(*)::int AS count FROM platform_services")) return { rows: [{ count: 14 }] };
      return { rows: [] };
    }
  };
  const result = await bootstrapProductionCore(db, config);
  assert.ok(offerReads >= 2);
  assert.equal(result.offerPresent, false);
  assert.equal(result.offerCreated, false);
  assert.equal(result.activeAdminPresent, false);
  assert.equal(result.adminCreatedOrPromoted, false);
});

test("runtime executes production bootstrap after database creation and before readiness status", async () => {
  const source = await readFile(new URL("../src/runtime.mjs", import.meta.url), "utf8");
  const createDb = source.indexOf("db = await createDatabase(config)");
  const bootstrap = source.indexOf("bootstrapProductionCore(db, config)");
  const status = source.indexOf("const databaseStatus = await db.status()");
  assert.ok(createDb >= 0 && bootstrap > createDb && status > bootstrap);
});
