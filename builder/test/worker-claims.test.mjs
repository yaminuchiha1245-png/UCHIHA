import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.mjs";
import { createDatabase } from "../src/db.mjs";
import { runProvisioningOnce } from "../src/worker.mjs";

const logger = { error() {}, info() {}, warn() {} };

function testConfig() {
  return loadConfig({
    NODE_ENV: "test",
    DATABASE_MODE: "memory",
    APP_BASE_URL: "http://localhost:4100",
    WORKER_LEASE_SECONDS: "60"
  });
}

test("provisioning jobs are claimed once across concurrent workers", async () => {
  const config = testConfig();
  const db = await createDatabase(config);
  const tenantId = randomUUID();
  const storeId = randomUUID();
  const userId = randomUUID();
  const subscriptionId = randomUUID();
  const offerId = randomUUID();
  const jobId = randomUUID();
  try {
    await db.query(
      `INSERT INTO platform_users (id,email,password_hash,display_name,status)
       VALUES ($1,$2,'hash','Owner','active')`,
      [userId, `owner-${userId}@example.test`]
    );
    await db.query(
      `INSERT INTO subscription_offers (
         id,name,price_minor,renewal_price_minor,currency,duration_unit,duration_count,trial_days
       ) VALUES ($1,'Test',100,100,'USD','month',1,0)`,
      [offerId]
    );
    await db.query(
      `INSERT INTO subscriptions (
         id,user_id,offer_id,status,starts_at,ends_at,renews_at
       ) VALUES ($1,$2,$3,'active',NOW(),NOW(),NOW())`,
      [subscriptionId, userId, offerId]
    );
    await db.query(
      `INSERT INTO tenants (id,owner_user_id,subscription_id,name,slug,status)
       VALUES ($1,$2,$3,'Tenant',$4,'provisioning')`,
      [tenantId, userId, subscriptionId, `tenant-${tenantId.slice(0,8)}`]
    );
    await db.query(
      `INSERT INTO stores (
         id,tenant_id,name,slug,activity_type,country,language,currency,template_key,status
       ) VALUES ($1,$2,'Store',$3,'digital','TR','ar','USD','professional-dark','provisioning')`,
      [storeId, tenantId, `store-${storeId.slice(0,8)}`]
    );
    await db.query(
      `INSERT INTO provisioning_jobs (
         id,tenant_id,store_id,job_type,status,stage,idempotency_key
       ) VALUES ($1,$2,$3,'create_store','queued','starting',$4)`,
      [jobId, tenantId, storeId, `job-${jobId}`]
    );

    const results = await Promise.all([
      runProvisioningOnce(db, config, logger),
      runProvisioningOnce(db, config, logger)
    ]);
    assert.equal(results.filter((value) => value?.status === "completed").length, 1);
    assert.equal(results.filter((value) => value === null).length, 1);
    const job = (await db.query(
      "SELECT status,attempts,claim_token,lease_expires_at FROM provisioning_jobs WHERE id=$1",
      [jobId]
    )).rows[0];
    assert.equal(job.status, "completed");
    assert.equal(Number(job.attempts), 1);
    assert.equal(job.claim_token, null);
    assert.equal(job.lease_expires_at, null);
    const outboxCount = (await db.query(
      "SELECT COUNT(*)::int AS count FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2",
      [tenantId, storeId]
    )).rows[0].count;
    assert.equal(Number(outboxCount), 1);
  } finally {
    await db.close();
  }
});
