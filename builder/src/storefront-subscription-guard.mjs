const SHOWCASE_TENANT_ID = "00000000-0000-4000-8000-000000000101";

const INTERACTIVE_SEGMENTS = new Set([
  "customers",
  "customer",
  "wallet",
  "payment-methods",
  "deposit",
  "deposits",
  "order",
  "orders",
  "support",
  "developer-key",
  "notifications",
  "security",
  "identity",
  "telegram",
  "favorites",
  "favorite",
  "coupons",
  "coupon"
]);

export function isProtectedStorefrontPath(pathname) {
  const clean = String(pathname || "").split("?")[0];
  const match = /^\/api\/public\/stores\/([^/]+)(?:\/(.*))?$/.exec(clean);
  if (!match) return false;
  const tail = String(match[2] || "").split("/").filter(Boolean);
  return tail.some((segment) => INTERACTIVE_SEGMENTS.has(segment));
}

function storefrontSlug(pathname) {
  const clean = String(pathname || "").split("?")[0];
  const match = /^\/api\/public\/stores\/([^/]+)/.exec(clean);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    return null;
  }
}

function accessError() {
  const error = new Error("اشتراك هذا المتجر غير نشط حاليًا. التصفح متاح، لكن العمليات والحسابات متوقفة حتى التجديد.");
  error.statusCode = 403;
  error.code = "store_subscription_inactive";
  return error;
}

export function installStorefrontSubscriptionGuard(app, { db }) {
  app.addHook("preHandler", async (request) => {
    const pathname = String(request.raw?.url || request.url || "").split("?")[0];
    if (!isProtectedStorefrontPath(pathname)) return;
    const slug = storefrontSlug(pathname);
    if (!slug) throw accessError();

    const result = await db.query(
      `SELECT 1
       FROM stores s
       JOIN tenants t ON t.id=s.tenant_id
       WHERE LOWER(s.slug)=$1
         AND s.status IN ('active','ready')
         AND t.status='active'
         AND (
           t.id=$2::uuid
           OR EXISTS (
             SELECT 1 FROM subscriptions sub
             WHERE sub.tenant_id=t.id
               AND sub.status IN ('trial','active')
               AND sub.ends_at>NOW()
           )
         )
       LIMIT 1`,
      [slug, SHOWCASE_TENANT_ID]
    );
    if (!result.rows[0]) throw accessError();
  });
}
