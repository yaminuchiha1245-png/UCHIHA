import { id, nowIso, toJson } from "./utils.js";

export async function writeAudit(db, context, entry) {
  await db.run(`INSERT INTO audit_logs
    (id, tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, reason, before_json, after_json, request_id, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    id("aud"),
    entry.tenantId ?? context?.tenantId ?? null,
    entry.actorUserId ?? context?.user?.id ?? null,
    entry.actorType ?? "user",
    entry.action,
    entry.entityType,
    entry.entityId ?? null,
    entry.reason ?? null,
    entry.before === undefined ? null : toJson(entry.before),
    entry.after === undefined ? null : toJson(entry.after),
    entry.requestId ?? context?.requestId ?? null,
    entry.ipAddress ?? context?.ipAddress ?? null,
    nowIso()
  ]);
}
