import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.mjs";
import { createDatabase } from "../src/db.mjs";
import { runProvisioningOnce, sanitizeWorkerError } from "../src/worker.mjs";

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
  const jobId = randomUUID();
  try {
    await db.query(
      `INSERT INTO tenants (id,name,slug,status)
       VALUES ($1,'Tenant',$2,'provisioning_store')`,
      [tenantId, `tenant-${tenantId.slice(0,8)}`]
    );
    await db.query(
      `INSERT INTO stores (
         id,tenant_id,name,slug,activity_type,country,language,currency,template_key,status
       ) VALUES ($1,$2,'Store',$3,'digital','TR','ar','USD','professional-dark','provisioning_store')`,
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

test("worker errors redact Telegram tokens, database credentials and query secrets", () => {
  const message = sanitizeWorkerError(
    new Error(
      "request bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 failed at postgresql://admin:password@db.internal/app?api-token=secret-value&key=other"
    )
  );

  assert.equal(message.includes("ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"), false);
  assert.equal(message.includes("admin:password"), false);
  assert.equal(message.includes("secret-value"), false);
  assert.equal(message.includes("key=other"), false);
  assert.match(message, /bot<redacted>/);
  assert.match(message, /postgresql:\/\/<redacted>@/);
});
