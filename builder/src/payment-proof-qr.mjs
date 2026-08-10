import QRCode from "qrcode";
import { safeText, sha256 } from "./security.mjs";

class PaymentQrError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function route(handler) {
  return async (request, reply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      if (error instanceof PaymentQrError) throw error;
      throw error;
    }
  };
}

function customerCookieName(store) {
  return `uchiha_customer_${sha256(store.id).slice(0, 16)}`;
}

async function storeBySlug(db, slug) {
  const store = (await db.query(
    `SELECT s.id, s.tenant_id, s.slug, s.status
     FROM stores s JOIN tenants t ON t.id=s.tenant_id
     WHERE s.slug=$1 AND s.status IN ('active','ready') AND t.status='active'`,
    [safeText(slug, 160).toLowerCase()]
  )).rows[0];
  if (!store) throw new PaymentQrError(404, "store_not_found", "المتجر غير موجود");
  return store;
}

async function requireCustomer(db, request, store) {
  const token = request.cookies[customerCookieName(store)];
  if (!token) throw new PaymentQrError(401, "customer_authentication_required", "سجّل الدخول إلى حساب المتجر أولًا");
  const customer = (await db.query(
    `SELECT c.id
     FROM customer_sessions cs JOIN store_customers c ON c.id=cs.customer_id
     WHERE cs.token_hash=$1 AND cs.revoked_at IS NULL AND cs.expires_at>NOW()
       AND c.tenant_id=$2 AND c.store_id=$3 AND c.status='active'`,
    [sha256(token), store.tenant_id, store.id]
  )).rows[0];
  if (!customer) throw new PaymentQrError(401, "invalid_customer_session", "انتهت جلسة حساب المتجر");
  return customer;
}

function destinationObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function destinationText(destination) {
  const preferred = [
    destination.address,
    destination.account,
    destination.payId,
    destination.wallet,
    destination.number,
    destination.value,
    destination.iban
  ];
  const selected = preferred.find((value) => typeof value === "string" && value.trim());
  if (selected) return selected.trim();
  return Object.values(destination).find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

export function installPaymentProofQr(app, { db }) {
  app.get(
    "/api/public/stores/:slug/payment-proof-methods/:methodId/qr",
    route(async (request, reply) => {
      const store = await storeBySlug(db, request.params.slug);
      await requireCustomer(db, request, store);
      const method = (await db.query(
        `SELECT id, method_type, destination_data, network
         FROM payment_methods
         WHERE id=$1 AND tenant_id=$2 AND store_id=$3
           AND status='active' AND customer_visible=TRUE`,
        [request.params.methodId, store.tenant_id, store.id]
      )).rows[0];
      if (!method) throw new PaymentQrError(404, "payment_method_not_found", "طريقة الدفع غير متاحة");

      const destination = destinationText(destinationObject(method.destination_data));
      if (!destination) throw new PaymentQrError(404, "payment_destination_missing", "لم يتم إعداد بيانات التحويل بعد");

      const svg = await QRCode.toString(destination, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 1,
        width: 320
      });
      reply
        .type("image/svg+xml; charset=utf-8")
        .header("cache-control", "private, max-age=300")
        .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'");
      return svg;
    })
  );
}
