import { randomUUID } from "node:crypto";
import { executeProviderOrder } from "./providers.mjs";
import { configureStoreWebhooks } from "./telegram.mjs";

function leaseExpiry(config) {
  const seconds = Math.max(30, Number(config.workerLeaseSeconds || 600));
  return new Date(Date.now() + seconds * 1000);
}

async function claimProvisioningJob(db, config) {
  const token = randomUUID();
  const expiresAt = leaseExpiry(config);
  return db.transaction(async (client) => {
    const candidate = await client.query(
      `SELECT id
       FROM provisioning_jobs
       WHERE ((status IN ('queued', 'retry') AND run_after <= NOW())
              OR (status='running' AND (lease_expires_at IS NULL OR lease_expires_at <= NOW())))
       ORDER BY created_at
       LIMIT 1`
    );
    const id = candidate.rows[0]?.id;
    if (!id) return null;
    const claimed = await client.query(
      `UPDATE provisioning_jobs
       SET status='running', claim_token=$2, lease_expires_at=$3, updated_at=NOW()
       WHERE id=$1
         AND ((status IN ('queued', 'retry') AND run_after <= NOW())
              OR (status='running' AND (lease_expires_at IS NULL OR lease_expires_at <= NOW())))
       RETURNING *`,
      [id, token, expiresAt]
    );
    return claimed.rows[0] || null;
  });
}

async function heartbeatJob(client, job, config, stage) {
  const result = await client.query(
    `UPDATE provisioning_jobs
     SET stage=$4, lease_expires_at=$5, updated_at=NOW()
     WHERE id=$1 AND tenant_id=$2 AND status='running' AND claim_token=$3
     RETURNING id`,
    [job.id, job.tenant_id, job.claim_token, stage, leaseExpiry(config)]
  );
  return Boolean(result.rows[0]);
}

async function completeJob(client, job, stage, eventType) {
  const result = await client.query(
    `UPDATE provisioning_jobs
     SET status='completed', stage=$4, attempts=attempts + 1,
         last_error=NULL, claim_token=NULL, lease_expires_at=NULL, updated_at=NOW()
     WHERE id=$1 AND tenant_id=$2 AND status='running' AND claim_token=$3
     RETURNING id`,
    [job.id, job.tenant_id, job.claim_token, stage]
  );
  if (!result.rows[0]) return false;
  await client.query(
    `INSERT INTO outbox_events (
       id, tenant_id, aggregate_type, aggregate_id, event_type, payload
     ) VALUES ($1,$2,'store',$3,$4,$5)`,
    [randomUUID(), job.tenant_id, job.store_id, eventType, { storeId: job.store_id }]
  );
  return true;
}

async function failJob(db, job, error) {
  const attempts = Number(job.attempts) + 1;
  const terminal = attempts >= Number(job.max_attempts);
  const delay = Math.min(300, 5 * 2 ** Math.max(0, attempts - 1));
  return db.transaction(async (client) => {
    const result = await client.query(
      `UPDATE provisioning_jobs
       SET status=$4, attempts=$5, last_error=$6,
           run_after=NOW() + ($7 * INTERVAL '1 second'),
           claim_token=NULL, lease_expires_at=NULL, updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND status='running' AND claim_token=$3
       RETURNING id`,
      [job.id, job.tenant_id, job.claim_token, terminal ? "failed" : "retry", attempts,
        String(error.message).slice(0, 1000), delay]
    );
    if (!result.rows[0]) return false;
    if (terminal) {
      await client.query("UPDATE tenants SET status='review_required', updated_at=NOW() WHERE id=$1", [job.tenant_id]);
      await client.query(
        "UPDATE stores SET status='review_required', updated_at=NOW() WHERE id=$1 AND tenant_id=$2",
        [job.store_id, job.tenant_id]
      );
    }
    return true;
  }, job.tenant_id);
}

export async function processProvisioningJob(db, config, job, logger = console) {
  try {
    if (job.job_type === "create_store") {
      const started = await db.transaction(async (client) => {
        if (!(await heartbeatJob(client, job, config, "apply_branding"))) return false;
        await client.query("UPDATE tenants SET status='provisioning_branding', updated_at=NOW() WHERE id=$1", [job.tenant_id]);
        await client.query(
          "UPDATE stores SET status='provisioning_branding', updated_at=NOW() WHERE id=$1 AND tenant_id=$2",
          [job.store_id, job.tenant_id]
        );
        return true;
      }, job.tenant_id);
      if (!started) return { type: job.job_type, status: "lease_lost" };
      const completed = await db.transaction(async (client) => {
        if (!(await completeJob(client, job, "store_ready", "store.ready_to_publish"))) return false;
        await client.query("UPDATE tenants SET status='ready_to_publish', updated_at=NOW() WHERE id=$1", [job.tenant_id]);
        await client.query(
          "UPDATE stores SET status='ready_to_publish', updated_at=NOW() WHERE id=$1 AND tenant_id=$2",
          [job.store_id, job.tenant_id]
        );
        return true;
      }, job.tenant_id);
      return { type: job.job_type, status: completed ? "completed" : "lease_lost" };
    }

    if (job.job_type === "connect_bots" || job.job_type === "publish_store") {
      const started = await db.transaction(async (client) => {
        if (!(await heartbeatJob(client, job, config, "configure_webhooks"))) return false;
        await client.query("UPDATE tenants SET status='connecting_bots', updated_at=NOW() WHERE id=$1", [job.tenant_id]);
        await client.query(
          "UPDATE stores SET status='connecting_bots', updated_at=NOW() WHERE id=$1 AND tenant_id=$2",
          [job.store_id, job.tenant_id]
        );
        return true;
      }, job.tenant_id);
      if (!started) return { type: job.job_type, status: "lease_lost" };
      await configureStoreWebhooks(db, job.store_id, config, logger);
      const completed = await db.transaction(async (client) => {
        if (!(await completeJob(client, job, "active", "store.activated"))) return false;
        await client.query("UPDATE tenants SET status='active', updated_at=NOW() WHERE id=$1", [job.tenant_id]);
        await client.query("UPDATE stores SET status='active', updated_at=NOW() WHERE id=$1 AND tenant_id=$2", [job.store_id, job.tenant_id]);
        return true;
      }, job.tenant_id);
      return { type: job.job_type, status: completed ? "completed" : "lease_lost" };
    }
    throw new Error(`Unsupported provisioning job: ${job.job_type}`);
  } catch (error) {
    logger.error({ error, jobId: job.id }, "Provisioning job failed");
    const retained = await failJob(db, job, error);
    return { type: job.job_type, status: retained ? "retry" : "lease_lost", error: error.message };
  }
}

async function claimProviderOrder(db, config) {
  const token = randomUUID();
  const expiresAt = leaseExpiry(config);
  return db.transaction(async (client) => {
    const candidate = await client.query(
      `SELECT id, tenant_id
       FROM provider_orders
       WHERE status IN ('pending', 'requires_review')
         AND (claim_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= NOW())
       ORDER BY created_at
       LIMIT 1`
    );
    const row = candidate.rows[0];
    if (!row) return null;
    const claimed = await client.query(
      `UPDATE provider_orders
       SET claim_token=$3, lease_expires_at=$4, updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND status IN ('pending', 'requires_review')
         AND (claim_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= NOW())
       RETURNING id, tenant_id, claim_token`,
      [row.id, row.tenant_id, token, expiresAt]
    );
    return claimed.rows[0] || null;
  });
}

export async function runProvisioningOnce(db, config, logger = console) {
  const job = await claimProvisioningJob(db, config);
  if (!job) return null;
  return processProvisioningJob(db, config, job, logger);
}

export async function runProviderOrderOnce(db, config, logger = console) {
  const claimed = await claimProviderOrder(db, config);
  if (!claimed) return null;
  try {
    return await executeProviderOrder(db, claimed.id, config, logger);
  } finally {
    await db.query(
      `UPDATE provider_orders SET claim_token=NULL, lease_expires_at=NULL, updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND claim_token=$3`,
      [claimed.id, claimed.tenant_id, claimed.claim_token]
    );
  }
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
