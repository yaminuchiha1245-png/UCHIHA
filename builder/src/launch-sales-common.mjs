import { randomUUID } from "node:crypto";
import { safeText, sha256 } from "./security.mjs";

const SESSION_COOKIE = "uchiha_builder_session";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const TERMINAL_REQUEST_STATUSES = new Set(["completed", "rejected", "cancelled"]);

export class LaunchSalesError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function requiredText(value, field, maxLength = 200) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new LaunchSalesError(422, "required_field", `${field} مطلوب`);
  if (normalized.length > maxLength) {
    throw new LaunchSalesError(422, "field_too_long", `${field} طويل جدًا`);
  }
  return normalized;
}

export function optionalText(value, maxLength = 1000) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new LaunchSalesError(422, "field_too_long", "القيمة طويلة جدًا");
  }
  return normalized;
}

export function jsonValue(value, fallback = {}) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function authenticateLaunchUser(db, request) {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) throw new LaunchSalesError(401, "authentication_required", "يجب تسجيل الدخول");
  const result = await db.query(
    `SELECT u.*, s.csrf_hash, s.expires_at
     FROM sessions s
     JOIN platform_users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>NOW() AND u.status='active'`,
    [sha256(token)]
  );
  const user = result.rows[0];
  if (!user) throw new LaunchSalesError(401, "invalid_session", "انتهت الجلسة أو ألغيت");
  return user;
}

export function requireLaunchCsrf(request, user) {
  const token = request.headers["x-csrf-token"];
  if (!token || sha256(token) !== user.csrf_hash) {
    throw new LaunchSalesError(403, "csrf_failed", "تعذر التحقق من الطلب");
  }
}

export function requireLaunchAdmin(user) {
  if (!user.is_platform_admin) {
    throw new LaunchSalesError(
      403,
      "platform_permission_required",
      "هذه العملية خاصة بإدارة منصة UCHIHA"
    );
  }
}

export function durationEnd(start, unit, count) {
  const end = new Date(start);
  if (unit === "year") end.setUTCFullYear(end.getUTCFullYear() + count);
  else if (unit === "month") end.setUTCMonth(end.getUTCMonth() + count);
  else end.setUTCDate(end.getUTCDate() + count);
  return end;
}

export function offerDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    priceMinor: Number(row.price_minor || 0),
    renewalPriceMinor: Number(row.renewal_price_minor || 0),
    currency: row.currency,
    durationUnit: row.duration_unit,
    durationCount: Number(row.duration_count || 0),
    saleEnabled: Boolean(row.sale_enabled)
  };
}

export function subscriptionDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    offerId: row.offer_id,
    offerName: row.offer_name || null,
    currency: row.currency || null,
    priceMinor: Number(row.price_minor || 0),
    startsAt: row.starts_at,
    endsAt: row.ends_at
  };
}

export function requestDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id || null,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    status: row.status,
    details: row.details,
    metadata: jsonValue(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function writeLaunchAudit(
  db,
  request,
  user,
  action,
  entityId,
  beforeData,
  afterData,
  entityType = "service_request"
) {
  try {
    await db.query(
      `INSERT INTO platform_audit_logs (
         id, actor_user_id, action, entity_type, entity_id,
         before_data, after_data, ip_address, user_agent
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        user.id,
        action,
        entityType,
        String(entityId),
        beforeData || null,
        afterData || null,
        request.ip,
        safeText(request.headers["user-agent"], 500) || null
      ]
    );
  } catch (error) {
    request.log?.warn?.({ error, action, entityId }, "Launch sales audit write failed");
  }
}
