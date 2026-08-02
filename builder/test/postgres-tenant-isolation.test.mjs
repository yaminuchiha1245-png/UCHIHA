import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createOwner,
  createPostgresHarness,
  createStore,
  postgresAvailable,
  registerCustomer
} from "./postgres-helpers.mjs";

const options = postgresAvailable() ? {} : { skip: "TEST_DATABASE_URL is not configured" };

test("PostgreSQL 1/4: migrations, authentication, RLS tenant isolation and neutral showcase identity", options, async (context) => {
  const harness = await createPostgresHarness(context, { demoSeed: true });
  const { app, db } = harness;
  const status = await db.status();
  assert.equal(status.mode, "postgres");
  assert.equal(status.migrationCount, 22);

  const owner = await createOwner(app);
  const storeA = await createStore(db, owner.id, { slug: "postgres-tenant-a", name: "Green Alpha", colors: ["#178f55", "#0b4930"] });
  const storeB = await createStore(db, owner.id, { slug: "postgres-tenant-b", name: "Blue Beta", colors: ["#2563eb", "#1e3a8a"] });
  const customerA = await registerCustomer(app, storeA.slug, "same-postgres@example.com");
  const customerB = await registerCustomer(app, storeB.slug, "same-postgres@example.com");
  assert.notEqual(customerA.customer.id, customerB.customer.id);

  const crossStore = await app.inject({
    method: "GET",
    url: `/api/public/stores/${storeB.slug}/wallet`,
    headers: { cookie: customerA.cookie }
  });
  assert.equal(crossStore.statusCode, 401, crossStore.body);

  const role = `uchiha_rls_${randomUUID().replaceAll("-", "")}`;
  await db.query(`CREATE ROLE ${role} NOLOGIN`);
  await db.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await db.query(`GRANT SELECT ON stores, store_design_tokens, store_customers TO ${role}`);
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query("SELECT set_config('app.tenant_id', $1, TRUE)", [storeA.tenantId]);
    const visibleStores = await client.query("SELECT id, tenant_id FROM stores ORDER BY id");
    assert.deepEqual(visibleStores.rows.map((row) => row.id), [storeA.storeId]);
    const visibleCustomers = await client.query("SELECT id, tenant_id FROM store_customers");
    assert.deepEqual(visibleCustomers.rows.map((row) => row.id), [customerA.customer.id]);
    await client.query("ROLLBACK");
  } finally {
    client.release();
    await db.query(`DROP OWNED BY ${role}`);
    await db.query(`DROP ROLE ${role}`);
  }

  const demo = (await db.query(
    `SELECT s.name, d.primary_color, d.logo_url
     FROM stores s JOIN store_design_tokens d ON d.store_id=s.id
     WHERE s.slug='demo'`
  )).rows[0];
  assert.equal(demo.name, "Nova Digital");
  assert.equal(demo.primary_color, "#2457d6");
  assert.match(demo.logo_url, /neutral-store/);
});
