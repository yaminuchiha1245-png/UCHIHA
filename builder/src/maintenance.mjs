import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
    await execute(
      "customerLoginChallenges",
      `DELETE FROM customer_login_challenges
       WHERE expires_at <= NOW()
          OR (completed_at IS NOT NULL AND completed_at <= NOW() - INTERVAL '1 day')`,
      []
    );
    await execute(
      "telegramLinkCodes",
      `DELETE FROM telegram_link_codes
       WHERE expires_at <= NOW()
          OR (used_at IS NOT NULL AND used_at <= NOW() - INTERVAL '1 day')`,
      []
    );
    await execute(
      "storefrontApiRateWindows",
      `DELETE FROM store_api_rate_windows
       WHERE window_started_at <= NOW() - INTERVAL '2 days'`,
      []
    );
    await execute(
      "aiPromptLeasesExpired",
      `DELETE FROM ai_bot_prompt_leases
       WHERE expires_at <= NOW() - INTERVAL '1 day'`,
      []
    );
    await execute(
      "identityFilesExpired",
      `DELETE FROM identity_verification_files f
       USING identity_verification_requests r, store_experience_settings s
       WHERE f.request_id=r.id
         AND f.tenant_id=r.tenant_id AND f.store_id=r.store_id
         AND s.tenant_id=f.tenant_id AND s.store_id=f.store_id
         AND r.status IN ('verified','rejected')
         AND COALESCE(r.reviewed_at,r.updated_at) <= NOW() - (s.identity_retention_days * INTERVAL '1 day')`,
      []
    );
    await execute(
      "identitySensitivePayloads",
      `UPDATE identity_verification_requests r SET
         document_number_ciphertext=NULL,
         additional_details='',
         updated_at=NOW()
       FROM store_experience_settings s
       WHERE s.tenant_id=r.tenant_id AND s.store_id=r.store_id
         AND r.status IN ('verified','rejected')
         AND COALESCE(r.reviewed_at,r.updated_at) <= NOW() - (s.identity_retention_days * INTERVAL '1 day')
         AND (r.document_number_ciphertext IS NOT NULL OR r.additional_details <> '')`,
      []
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
  const { createRuntime } = await import("./runtime.mjs");
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
