import { safeText, sha256 } from "./security.mjs";

class WalletProofGuardError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function jsonObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function destinationText(value) {
  const destination = jsonObject(value);
  const candidates = [
    destination.address,
    destination.walletAddress,
    destination.wallet_address,
    destination.account,
    destination.accountNumber,
    destination.account_number,
    destination.payId,
    destination.pay_id,
    destination.wallet,
    destination.number,
    destination.phone,
    destination.value,
    destination.iban
  ];
  return candidates.find((entry) => typeof entry === "string" && entry.trim())?.trim() || "";
}

function proofHash(value) {
  const input = String(value || "").trim();
  if (!input) return null;
  const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(input);
  if (!match) return null;
  const data = match[1].replace(/\s+/g, "");
  return data ? sha256(data) : null;
}

function customerCookieName(storeId) {
  return `uchiha_customer_${sha256(storeId).slice(0, 16)}`;
}

async function activeCustomerId(db, request, store) {
  const token = request.cookies?.[customerCookieName(store.id)];
  if (!token) return null;
  const row = (await db.query(
    `SELECT c.id
     FROM customer_sessions cs
     JOIN store_customers c ON c.id=cs.customer_id
     WHERE cs.token_hash=$1 AND cs.revoked_at IS NULL AND cs.expires_at>NOW()
       AND c.tenant_id=$2 AND c.store_id=$3 AND c.status='active'`,
    [sha256(token), store.tenant_id, store.id]
  )).rows[0];
  return row?.id || null;
}

export function installWalletProofSubmissionGuard(app, { db }) {
  app.addHook("preHandler", async (request) => {
    if (request.method !== "POST") return;
    const routeUrl = String(request.routeOptions?.url || "");
    if (routeUrl !== "/api/public/stores/:slug/wallet-proofs") return;

    const slug = safeText(request.params?.slug, 160).toLowerCase();
    const methodId = safeText(request.body?.paymentMethodId, 80);
    if (!slug || !methodId) return;

    const method = (await db.query(
      `SELECT pm.id, pm.destination_data, s.id AS store_id, s.tenant_id
       FROM payment_methods pm
       JOIN stores s ON s.id=pm.store_id AND s.tenant_id=pm.tenant_id
       JOIN tenants t ON t.id=s.tenant_id
       WHERE s.slug=$1 AND s.status IN ('active','ready') AND t.status='active'
         AND pm.id=$2 AND pm.status='active' AND pm.customer_visible=TRUE`,
      [slug, methodId]
    )).rows[0];

    // Let the canonical wallet-proof route return its normal 404 for unknown methods.
    if (!method) return;
    if (!destinationText(method.destination_data)) {
      throw new WalletProofGuardError(
        409,
        "payment_destination_not_configured",
        "طريقة الدفع لم يكتمل إعداد بيانات التحويل الخاصة بها بعد"
      );
    }

    const customerId = await activeCustomerId(db, request, {
      id: method.store_id,
      tenant_id: method.tenant_id
    });
    if (!customerId) return;

    const referenceText = safeText(request.body?.referenceText, 180) || null;
    const imageHash = proofHash(request.body?.proofDataUrl);
    if (!referenceText && !imageHash) return;

    const duplicate = (await db.query(
      `SELECT id FROM wallet_topup_proofs
       WHERE tenant_id=$1 AND store_id=$2 AND customer_id=$3 AND payment_method_id=$4
         AND (($5 IS NOT NULL AND reference_text=$5) OR ($6 IS NOT NULL AND proof_sha256=$6))
       LIMIT 1`,
      [method.tenant_id, method.store_id, customerId, method.id, referenceText, imageHash]
    )).rows[0];

    if (duplicate) {
      throw new WalletProofGuardError(409, "proof_already_submitted", "تم إرسال هذا الإثبات مسبقًا");
    }
  });
}
