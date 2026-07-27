import { randomUUID } from "node:crypto";
import { executeProviderOrder } from "./providers.mjs";
import { configureStoreWebhooks } from "./telegram.mjs";

async function nextProvisioningJob(db) {
  const result = await db.query(
    `SELECT *
     FROM provisioning_jobs
     WHERE status IN ('queued', 'retry') AND run_after <= NOW()
     ORDER BY created_at
     LIMIT 1`
  );
  return result.rows[0] || null;
}

async function failProvisioningJob(db, job, error) {
  const attempts = Number(job.attempts) + 1;
  const terminal = attempts >= Number(job.max_attempts);
  const delaySeconds = Math.min(300, 5 * 2 ** Math.max(0, attempts - 1));
  await db.transaction(async (client) => {
    await client.query(
      `UPDATE provisioning_jobs
       SET status = $2, attempts = $3, last_error = $4,
           run_after = NOW() + ($5 * INTERVAL '1 second'), updated_at = NOW()
       WHERE id = $1`,
      [job.id, terminal ? "failed" : "retry", attempts, String(error.message).slice(0, 1000), delaySeconds]
    );
    if (terminal) {
      await client.query(
        "UPDATE tenants SET status = 'review_required', updated_at = NOW() WHERE id = $1",
        [job.tenant_id]
      );
      await client.query(
        "UPDATE stores SET status = 'review_required', updated_at = NOW() WHERE id = $1",
        [job.store_id]
      );
    }
  });
}

export async function processProvisioningJob(db, config, job, logger = console) {
  await db.query(
    `UPDATE provisioning_jobs
     SET status = 'running', stage = $2, updated_at = NOW()
     WHERE id = $1`,
    [job.id, job.stage || "starting"]
  );
  try {
    if (job.job_type === "create_store") {
      await db.transaction(async (client) => {
        await client.query(
          "UPDATE tenants SET status = 'provisioning_branding', updated_at = NOW() WHERE id = $1",
          [job.tenant_id]
        );
        await client.query(
          "UPDATE stores SET status = 'provisioning_branding', updated_at = NOW() WHERE id = $1",
          [job.store_id]
        );
        await client.query(
          `UPDATE provisioning_jobs
           SET stage = 'apply_branding', updated_at = NOW()
           WHERE id = $1`,
          [job.id]
        );
      });
      await db.transaction(async (client) => {
        await client.query(
          "UPDATE tenants SET status = 'ready_to_publish', updated_at = NOW() WHERE id = $1",
          [job.tenant_id]
        );
        await client.query(
          "UPDATE stores SET status = 'ready_to_publish', updated_at = NOW() WHERE id = $1",
          [job.store_id]
        );
        await client.query(
          `UPDATE provisioning_jobs
           SET status = 'completed', stage = 'store_ready', attempts = attempts + 1,
               last_error = NULL, updated_at = NOW()
           WHERE id = $1`,
          [job.id]
        );
        await client.query(
          `INSERT INTO outbox_events (
             id, tenant_id, aggregate_type, aggregate_id, event_type, payload
           ) VALUES ($1, $2, 'store', $3, 'store.ready_to_publish', $4)`,
          [randomUUID(), job.tenant_id, job.store_id, { storeId: job.store_id }]
        );
      }, job.tenant_id);
      return { type: job.job_type, status: "completed" };
    }

    if (job.job_type === "connect_bots" || job.job_type === "publish_store") {
      await db.transaction(async (client) => {
        await client.query(
          "UPDATE tenants SET status = 'connecting_bots', updated_at = NOW() WHERE id = $1",
          [job.tenant_id]
        );
        await client.query(
          "UPDATE stores SET status = 'connecting_bots', updated_at = NOW() WHERE id = $1",
          [job.store_id]
        );
        await client.query(
          "UPDATE provisioning_jobs SET stage = 'configure_webhooks', updated_at = NOW() WHERE id = $1",
          [job.id]
        );
      });
      await configureStoreWebhooks(db, job.store_id, config, logger);
      await db.transaction(async (client) => {
        await client.query("UPDATE tenants SET status = 'active', updated_at = NOW() WHERE id = $1", [
          job.tenant_id
        ]);
        await client.query("UPDATE stores SET status = 'active', updated_at = NOW() WHERE id = $1", [
          job.store_id
        ]);
        await client.query(
          `UPDATE provisioning_jobs
           SET status = 'completed', stage = 'active', attempts = attempts + 1,
               last_error = NULL, updated_at = NOW()
           WHERE id = $1`,
          [job.id]
        );
        await client.query(
          `INSERT INTO outbox_events (
             id, tenant_id, aggregate_type, aggregate_id, event_type, payload
           ) VALUES ($1, $2, 'store', $3, 'store.activated', $4)`,
          [randomUUID(), job.tenant_id, job.store_id, { storeId: job.store_id }]
        );
      }, job.tenant_id);
      return { type: job.job_type, status: "completed" };
    }

    throw new Error(`Unsupported provisioning job: ${job.job_type}`);
  } catch (error) {
    logger.error({ error, jobId: job.id }, "Provisioning job failed");
    await failProvisioningJob(db, job, error);
    return { type: job.job_type, status: "retry", error: error.message };
  }
}

export async function runProvisioningOnce(db, config, logger = console) {
  const job = await nextProvisioningJob(db);
  if (!job) return null;
  return processProvisioningJob(db, config, job, logger);
}

export async function runProviderOrderOnce(db, config, logger = console) {
  const result = await db.query(
    `SELECT id
     FROM provider_orders
     WHERE status IN ('pending', 'requires_review')
     ORDER BY created_at
     LIMIT 1`
  );
  const row = result.rows[0];
  if (!row) return null;
  return executeProviderOrder(db, row.id, config, logger);
}

export async function runWorkerCycle(db, config, logger = console) {
  const provisioning = await runProvisioningOnce(db, config, logger);
  const providerOrder = await runProviderOrderOnce(db, config, logger);
  return { provisioning, providerOrder };
}

export function startWorkerLoop(db, config, logger = console, intervalMs = 750) {
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runWorkerCycle(db, config, logger);
    } catch (error) {
      logger.error({ error }, "Worker cycle failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

