const DAY_MS = 86_400_000;

export const DEFAULT_MAINTENANCE_RETENTION = Object.freeze({
  authSessionsDays: 7,
  webhooksDays: 180,
  sentOutboxDays: 30,
  radiusEventsDays: 180
});

function retentionDays(env, name, fallback) {
  const value = Number.parseInt(env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < 1 || value > 3_650) {
    throw new Error(`${name} must be between 1 and 3650`);
  }
  return value;
}

export function maintenanceOptionsFromEnv(env = process.env) {
  return {
    authSessionsDays: retentionDays(env, "MAINTENANCE_AUTH_SESSION_DAYS", DEFAULT_MAINTENANCE_RETENTION.authSessionsDays),
    webhooksDays: retentionDays(env, "MAINTENANCE_WEBHOOK_DAYS", DEFAULT_MAINTENANCE_RETENTION.webhooksDays),
    sentOutboxDays: retentionDays(env, "MAINTENANCE_SENT_OUTBOX_DAYS", DEFAULT_MAINTENANCE_RETENTION.sentOutboxDays),
    radiusEventsDays: retentionDays(env, "MAINTENANCE_RADIUS_EVENT_DAYS", DEFAULT_MAINTENANCE_RETENTION.radiusEventsDays)
  };
}

function cutoff(nowMs, days) {
  return new Date(nowMs - days * DAY_MS).toISOString();
}

export async function runMaintenance(db, options = {}) {
  const nowMs = new Date(options.now ?? Date.now()).getTime();
  if (!Number.isFinite(nowMs)) throw new Error("Maintenance now value must be a valid date-time");
  const { now: _now, ...retentionOverrides } = options;
  const retention = { ...DEFAULT_MAINTENANCE_RETENTION, ...retentionOverrides };
  for (const [name, value] of Object.entries(retention)) {
    if (!Number.isInteger(value) || value < 1 || value > 3_650) throw new Error(`${name} must be between 1 and 3650`);
  }

  const now = new Date(nowMs).toISOString();
  const removed = {};
  async function remove(name, sql, params) {
    const result = await db.run(sql, params);
    removed[name] = Number(result.changes ?? 0);
  }

  await remove("authSessions", `DELETE FROM auth_sessions
    WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`,
  [cutoff(nowMs, retention.authSessionsDays), cutoff(nowMs, retention.authSessionsDays)]);
  await remove("connectorNonces", "DELETE FROM connector_nonces WHERE expires_at < ?", [now]);
  await remove("idempotencyRecords", "DELETE FROM idempotency_records WHERE expires_at < ?", [now]);
  await remove("webhookEvents", "DELETE FROM webhook_events WHERE processed_at < ?", [cutoff(nowMs, retention.webhooksDays)]);
  await remove("sentOutbox", "DELETE FROM outbox WHERE status = 'sent' AND updated_at < ?", [cutoff(nowMs, retention.sentOutboxDays)]);
  await remove("radiusAuthEvents", "DELETE FROM radius_auth_events WHERE received_at < ?", [cutoff(nowMs, retention.radiusEventsDays)]);
  await remove("radiusAccountingEvents", "DELETE FROM radius_accounting_events WHERE received_at < ?", [cutoff(nowMs, retention.radiusEventsDays)]);

  return { completedAt: now, retention, removed };
}
