import { hasPermission } from "@uchiha-radius/contracts";
import { forbidden, subscriptionRequired, validationError } from "./errors.js";

export function requireTenant(context) {
  if (!context?.tenantId) throw forbidden("اختر شبكة مرتبطة بالحساب أولًا");
}

export function requirePermission(context, permission) {
  requireTenant(context);
  if (!hasPermission(context.role, permission)) throw forbidden();
}

export function requireWrite(context, permission) {
  requirePermission(context, permission);
  if (!context.canWrite) throw subscriptionRequired();
}

export function requirePlatformOwner(context) {
  if (context?.user?.platformRole !== "platform_owner") throw forbidden("هذا القسم مخصص لمالك المنصة");
}

export async function requireCapacity(db, context, resource, additional = 1) {
  const configured = Number(context?.subscription?.limits?.[resource]);
  if (!Number.isFinite(configured) || configured < 0) return;
  const queries = {
    subscribers: [`SELECT
      (SELECT COUNT(*) FROM subscribers WHERE tenant_id=?) +
      (SELECT COUNT(*) FROM vouchers WHERE tenant_id=? AND subscriber_id IS NULL AND status IN ('available','assigned','active')) AS total`,
    [context.tenantId, context.tenantId]],
    devices: ["SELECT COUNT(*) AS total FROM network_devices WHERE tenant_id=?", [context.tenantId]],
    team: ["SELECT COUNT(*) AS total FROM memberships WHERE tenant_id=? AND status IN ('active','invited')", [context.tenantId]]
  };
  const query = queries[resource];
  if (!query) throw new Error(`Unknown subscription capacity resource: ${resource}`);
  const usage = await db.get(query[0], query[1]);
  if (Number(usage?.total ?? 0) + additional > configured) {
    const labels = { subscribers: "المشتركين والبطاقات المحجوزة", devices: "أجهزة الشبكة", team: "أعضاء الفريق" };
    throw validationError(`تم بلوغ حد ${labels[resource]} في باقة المنصة الحالية`);
  }
}
