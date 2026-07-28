import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "./runtime.mjs";

function retentionDays(value, fallback, name) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3650) {
    throw new Error(`${name} must be between 1 and 3650 days`);
  }
  return parsed;
}

export async function runMaintenance(
  db,
  {
    revokedSessionDays = 7,
    idempotencyDays = 30,
    completedJobDays = 30,
    providerSyncDays = 90
  } = {}
) {
  const policy = {
    revokedSessionDays: retentionDays(revokedSessionDays, 7, "revokedSessionDays"),
    idempotencyDays: retentionDays(idempotencyDays, 30, "idempotencyDays"),
    completedJobDays: retentionDays(completedJobDays, 30, "completedJobDays"),
    providerSyncDays: retentionDays(providerSyncDays, 90, "providerSyncDays")
  };

  return db.transaction(async (client) => {
    const results = {};
    const execute = async (key, text, values) => {
      const result = await client.query(text, values);
      results[key] = Number(result.rowCount || 0);
    };

    await execute(
      "platformSessions",
      `DELETE FROM sessions
       WHERE expires_at <= NOW()
          OR (revoked_at IS NOT NULL AND revoked_at <= NOW() - ($1 * INTERVAL '1 day'))`,
      [policy.revokedSessionDays]
    );
    await execute(
      "customerSessions",
      `DELETE FROM customer_sessions
       WHERE expires_at <= NOW()
          OR (revoked_at IS NOT NULL AND revoked_at <= NOW() - ($1 * INTERVAL '1 day'))`,
      [policy.revokedSessionDays]
    );
    await execute(
      "platformIdempotency",
      `DELETE FROM idempotency_records
       WHERE created_at <= NOW() - ($1 * INTERVAL '1 day')`,
      [policy.idempotencyDays]
    );
    await execute(
      "customerIdempotency",
      `DELETE FROM customer_idempotency_records
       WHERE created_at <= NOW() - ($1 * INTERVAL '1 day')`,
      [policy.idempotencyDays]
    );
    await execute(
      "adminIdempotency",
      `DELETE FROM admin_idempotency_records
       WHERE created_at <= NOW() - ($1 * INTERVAL '1 day')`,
      [policy.idempotencyDays]
    );
    await execute(
      "completedProvisioningJobs",
      `DELETE FROM provisioning_jobs
       WHERE status = 'completed'
         AND updated_at <= NOW() - ($1 * INTERVAL '1 day')`,
      [policy.completedJobDays]
    );
    await execute(
      "providerSyncLogs",
      `DELETE FROM provider_sync_logs
       WHERE finished_at IS NOT NULL
         AND finished_at <= NOW() - ($1 * INTERVAL '1 day')`,
      [policy.providerSyncDays]
    );

    return {
      completedAt: new Date().toISOString(),
      policy,
      deleted: results,
      totalDeleted: Object.values(results).reduce((sum, count) => sum + count, 0)
    };
  });
}

async function main() {
  const { db } = await createRuntime({ seed: false });
  try {
    const result = await runMaintenance(db, {
      revokedSessionDays: process.env.MAINTENANCE_REVOKED_SESSION_DAYS,
      idempotencyDays: process.env.MAINTENANCE_IDEMPOTENCY_DAYS,
      completedJobDays: process.env.MAINTENANCE_COMPLETED_JOB_DAYS,
      providerSyncDays: process.env.MAINTENANCE_PROVIDER_SYNC_DAYS
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await db.close();
  }
}

const executedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (executedFile === fileURLToPath(import.meta.url)) await main();
