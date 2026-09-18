import { AppError } from "./errors.js";
import { API_ERROR_CODES } from "@uchiha-radius/contracts";
import { addHours, id, nowIso, parseJson, toJson } from "./utils.js";
import { sha256 } from "./security.js";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export class IdempotencyService {
  constructor(db) {
    this.db = db;
  }

  async execute({ tenantId, key, route, body, statusCode = 200 }, callback) {
    if (!key || String(key).length < 8 || String(key).length > 128) {
      throw new AppError(400, API_ERROR_CODES.VALIDATION_ERROR, "يلزم Idempotency-Key بطول 8 إلى 128 حرفًا");
    }
    const requestHash = sha256(JSON.stringify(stable(body ?? null)));
    return this.db.transaction(async (tx) => {
      if (tx.driver === "postgres") {
        await tx.get("SELECT pg_advisory_xact_lock(hashtextextended(?, 0)) AS locked", [`${tenantId}:${route}:${key}`]);
      }
      const now = nowIso();
      const existing = await tx.get(`SELECT request_hash, status_code, response_json, expires_at
        FROM idempotency_records WHERE tenant_id = ? AND key = ? AND route = ?`, [tenantId, key, route]);
      if (existing && new Date(existing.expires_at).getTime() > new Date(now).getTime()) {
        if (existing.request_hash !== requestHash) {
          throw new AppError(409, API_ERROR_CODES.CONFLICT, "استُخدم مفتاح العملية نفسه مع بيانات مختلفة");
        }
        return { statusCode: existing.status_code, data: parseJson(existing.response_json), replayed: true };
      }
      if (existing) {
        await tx.run("DELETE FROM idempotency_records WHERE tenant_id = ? AND key = ? AND route = ?", [tenantId, key, route]);
      }
      const data = await callback(tx);
      await tx.run(`INSERT INTO idempotency_records
        (id, tenant_id, key, route, request_hash, status_code, response_json, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id("idem"), tenantId, key, route, requestHash, statusCode, toJson(data), addHours(now, 24), now]);
      return { statusCode, data, replayed: false };
    });
  }
}
