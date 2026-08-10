import { randomUUID } from "node:crypto";
import { safeText, sha256 } from "./security.mjs";

const PLATFORM_SESSION_COOKIE = "uchiha_builder_session";
const OWNER_ROLE = "owner";
const PROOF_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEFAULT_MAX_PROOF_BYTES = 1_500_000;

class WalletProofError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function route(handler) {
  return async (request, reply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      if (error instanceof WalletProofError) throw error;
      if (error?.code === "23505") {
        throw new WalletProofError(409, "conflict", "تم إرسال هذه العملية مسبقًا");
      }
      throw error;
    }
  };
}

function requiredText(value, field, maxLength = 200) {
  const text = safeText(value, maxLength);
  if (!text) throw new WalletProofError(422, "missing_field", `الحقل ${field} مطلوب`);
  return text;
}

function customerCookieName(store) {
  return `uchiha_customer_${sha256(store.id).slice(0, 16)}`;
}

async function storeBySlug(db, slug) {
  const row = (await db.query(
    `SELECT s.*, t.status AS tenant_status
     FROM stores s JOIN tenants t ON t.id=s.tenant_id
     WHERE s.slug=$1 AND s.status IN ('active','ready')`,
    [safeText(slug, 160).toLowerCase()]
  )).rows[0];
  if (!row) throw new WalletProofError(404, "store_not_found", "المتجر غير موجود");
  return row;
}

async function authenticateCustomer(db, request, store) {
  const token = request.cookies[customerCookieName(store)];
  if (!token) throw new WalletProofError(401, "customer_authentication_required", "سجّل الدخول إلى حساب المتجر أولًا");
  const customer = (await db.query(
    `SELECT c.*, cs.csrf_hash, w.balance_minor, w.currency AS wallet_currency
     FROM customer_sessions cs
     JOIN store_customers c ON c.id=cs.customer_id
     JOIN customer_wallets w ON w.customer_id=c.id
     WHERE cs.token_hash=$1 AND cs.revoked_at IS NULL AND cs.expires_at>NOW()
       AND c.tenant_id=$2 AND c.store_id=$3 AND c.status='active'
       AND w.tenant_id=$2 AND w.store_id=$3`,
    [sha256(token), store.tenant_id, store.id]
  )).rows[0];
  if (!customer) throw new WalletProofError(401, "invalid_customer_session", "انتهت جلسة حساب المتجر");
  return customer;
}

function requireCustomerCsrf(request, customer) {
  const token = request.headers["x-customer-csrf-token"];
  if (!token || sha256(token) !== customer.csrf_hash) {
    throw new WalletProofError(403, "csrf_failed", "تعذر التحقق من طلب العميل");
  }
}

async function authenticatePlatform(db, request) {
  const token = request.cookies[PLATFORM_SESSION_COOKIE];
  if (!token) throw new WalletProofError(401, "authentication_required", "يجب تسجيل الدخول إلى لوحة الإدارة");
  const user = (await db.query(
    `SELECT u.*, s.csrf_hash
     FROM sessions s JOIN platform_users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>NOW() AND u.status='active'`,
    [sha256(token)]
  )).rows[0];
  if (!user) throw new WalletProofError(401, "invalid_session", "انتهت جلسة الإدارة");
  return user;
}

function requirePlatformCsrf(request, user) {
  const token = request.headers["x-csrf-token"];
  if (!token || sha256(token) !== user.csrf_hash) {
    throw new WalletProofError(403, "csrf_failed", "تعذر التحقق من طلب الإدارة");
  }
}

async function requireStoreAccess(db, user, storeId) {
  const store = (await db.query(
    `SELECT s.*, tm.role_key
     FROM stores s JOIN tenant_memberships tm ON tm.tenant_id=s.tenant_id
     WHERE s.id=$1 AND tm.user_id=$2 AND tm.status='active'`,
    [storeId, user.id]
  )).rows[0];
  if (!store) throw new WalletProofError(404, "store_not_found", "المتجر غير موجود");
  return store;
}

function parseOptionalProof(value, maximumBytes = DEFAULT_MAX_PROOF_BYTES) {
  const input = String(value || "").trim();
  if (!input) return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(input);
  if (!match) throw new WalletProofError(422, "invalid_proof", "صورة الإثبات غير صالحة");
  const mime = match[1].toLowerCase();
  if (!PROOF_MIME.has(mime)) throw new WalletProofError(422, "invalid_proof_type", "نوع صورة الإثبات غير مدعوم");
  const data = match[2].replace(/\s+/g, "");
  let bytes;
  try {
    bytes = Buffer.from(data, "base64");
  } catch {
    throw new WalletProofError(422, "invalid_proof", "تعذر قراءة صورة الإثبات");
  }
  if (!bytes.length || bytes.length > maximumBytes) {
    throw new WalletProofError(422, "proof_too_large", "حجم صورة الإثبات أكبر من المسموح");
  }
  return { mime, data, hash: sha256(data), bytes: bytes.length };
}

function methodDto(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.method_type,
    instructions: row.instructions || "",
    destination: typeof row.destination_data === "string" ? JSON.parse(row.destination_data || "{}") : (row.destination_data || {}),
    currency: row.currency || null,
    logoUrl: row.logo_url || null,
    qrUrl: row.qr_url || null,
    network: row.network || null,
    status: row.status,
    customerVisible: Boolean(row.customer_visible)
  };
}

function proofDto(row, { includeImage = false } = {}) {
  return {
    id: row.id,
    customerId: row.customer_id,
    paymentMethodId: row.payment_method_id,
    paymentMethod: row.method_name ? { id: row.payment_method_id, name: row.method_name, type: row.method_type } : undefined,
    customer: row.customer_email ? {
      id: row.customer_id,
      name: row.customer_name,
      email: row.customer_email
    } : undefined,
    currency: row.currency,
    referenceText: row.reference_text || null,
    hasImage: Boolean(row.proof_data),
    proofDataUrl: includeImage && row.proof_data ? `data:${row.proof_mime};base64,${row.proof_data}` : undefined,
    status: row.status,
    creditedAmountMinor: row.credited_amount_minor === null || row.credited_amount_minor === undefined
      ? null
      : Number(row.credited_amount_minor),
    reviewReason: row.review_reason || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at
  };
}

async function notifyOwners(client, store, proofId, customer) {
  const owners = await client.query(
    `SELECT user_id FROM tenant_memberships
     WHERE tenant_id=$1 AND status='active' AND role_key='owner'`,
    [store.tenant_id]
  );
  for (const owner of owners.rows) {
    await client.query(
      `INSERT INTO store_admin_notifications (
         id, tenant_id, store_id, user_id, notification_type, title, message,
         reference_type, reference_id
       ) VALUES ($1,$2,$3,$4,'deposit_submitted',$5,$6,'wallet_topup_proof',$7)`,
      [
        randomUUID(), store.tenant_id, store.id, owner.user_id,
        "إثبات تحويل جديد", `${customer.display_name || customer.email} أرسل إثبات تحويل للمراجعة.`, proofId
      ]
    );
  }
}

async function notifyCustomer(client, store, proof, decision, amountMinor) {
  const approved = decision === "approve";
  await client.query(
    `INSERT INTO customer_notifications (
       id, tenant_id, store_id, customer_id, notification_type, title, message,
       reference_type, reference_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'wallet_topup_proof',$8)`,
    [
      randomUUID(), store.tenant_id, store.id, proof.customer_id,
      approved ? "deposit_approved" : "deposit_rejected",
      approved ? "تم قبول إثبات التحويل" : "تم رفض إثبات التحويل",
      approved
        ? `تمت إضافة ${amountMinor} من أصغر وحدة عملة إلى محفظتك بعد مراجعة التحويل.`
        : "تمت مراجعة الإثبات ولم يتم اعتماده. راجع السبب أو تواصل مع الدعم.",
      proof.id
    ]
  );
}

export async function reviewWalletTopupProof(db, {
  storeId,
  tenantId,
  proofId,
  decision,
  creditAmountMinor = null,
  reason = "",
  actorUserId = null,
  actorLabel = "admin_bot",
  ipAddress = null
}) {
  if (!tenantId || !storeId || !proofId) throw new WalletProofError(422, "invalid_review", "بيانات المراجعة ناقصة");
  if (!["approve", "reject"].includes(decision)) throw new WalletProofError(422, "invalid_decision", "قرار المراجعة غير صالح");
  const amount = decision === "approve" ? Number.parseInt(String(creditAmountMinor), 10) : null;
  if (decision === "approve" && (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000_000)) {
    throw new WalletProofError(422, "invalid_credit_amount", "مبلغ الإضافة غير صالح");
  }
  return db.transaction(async (client) => {
    const store = (await client.query(
      "SELECT * FROM stores WHERE id=$1 AND tenant_id=$2",
      [storeId, tenantId]
    )).rows[0];
    if (!store) throw new WalletProofError(404, "store_not_found", "المتجر غير موجود");
    const proof = (await client.query(
      `SELECT p.*, pm.name AS method_name, pm.method_type
       FROM wallet_topup_proofs p JOIN payment_methods pm ON pm.id=p.payment_method_id
       WHERE p.id=$1 AND p.tenant_id=$2 AND p.store_id=$3
       FOR UPDATE OF p`,
      [proofId, tenantId, storeId]
    )).rows[0];
    if (!proof) throw new WalletProofError(404, "proof_not_found", "إثبات التحويل غير موجود");
    if (proof.status !== "pending") return proofDto(proof);

    if (decision === "approve") {
      const wallet = (await client.query(
        `SELECT * FROM customer_wallets
         WHERE customer_id=$1 AND tenant_id=$2 AND store_id=$3 FOR UPDATE`,
        [proof.customer_id, tenantId, storeId]
      )).rows[0];
      if (!wallet) throw new WalletProofError(409, "wallet_not_found", "محفظة العميل غير موجودة");
      if (wallet.currency !== proof.currency) {
        throw new WalletProofError(409, "wallet_currency_mismatch", "عملة المحفظة لا تطابق عملة الإثبات");
      }
      const before = Number(wallet.balance_minor);
      const after = before + amount;
      await client.query(
        `UPDATE customer_wallets SET balance_minor=$1, updated_at=NOW()
         WHERE customer_id=$2 AND tenant_id=$3 AND store_id=$4`,
        [after, proof.customer_id, tenantId, storeId]
      );
      await client.query(
        `INSERT INTO wallet_ledger (
           id, tenant_id, store_id, customer_id, entry_type, operation_type,
           amount_minor, balance_before_minor, balance_after_minor, fee_minor,
           currency, reference_type, reference_id, note
         ) VALUES ($1,$2,$3,$4,'deposit','deposit',$5,$6,$7,0,$8,'wallet_topup_proof',$9,$10)`,
        [
          randomUUID(), tenantId, storeId, proof.customer_id, amount, before, after,
          proof.currency, proof.id, `اعتماد إثبات تحويل بواسطة ${actorLabel}`
        ]
      );
    }

    await client.query(
      `UPDATE wallet_topup_proofs
       SET status=$1, credited_amount_minor=$2, review_reason=$3,
           reviewed_by=$4, reviewed_at=NOW(), updated_at=NOW()
       WHERE id=$5 AND tenant_id=$6 AND store_id=$7`,
      [decision === "approve" ? "approved" : "rejected", amount, safeText(reason, 1000) || null, actorUserId, proof.id, tenantId, storeId]
    );
    await notifyCustomer(client, store, proof, decision, amount);
    await client.query(
      `INSERT INTO audit_logs (
         id, tenant_id, actor_user_id, action, entity_type, entity_id,
         ip_address, after_data
       ) VALUES ($1,$2,$3,$4,'wallet_topup_proof',$5,$6,$7)`,
      [
        randomUUID(), tenantId, actorUserId,
        decision === "approve" ? "wallet_proof.approved" : "wallet_proof.rejected",
        proof.id, safeText(ipAddress, 120) || null,
        JSON.stringify({ decision, creditAmountMinor: amount, reason: safeText(reason, 1000) || null, actorLabel })
      ]
    );
    const updated = (await client.query(
      `SELECT p.*, pm.name AS method_name, pm.method_type
       FROM wallet_topup_proofs p JOIN payment_methods pm ON pm.id=p.payment_method_id
       WHERE p.id=$1 AND p.tenant_id=$2 AND p.store_id=$3`,
      [proof.id, tenantId, storeId]
    )).rows[0];
    return proofDto(updated);
  }, tenantId);
}

export function installWalletProofAdmin(app, { db }) {
  app.get(
    "/api/public/stores/:slug/payment-proof-methods",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      await authenticateCustomer(db, request, store);
      const result = await db.query(
        `SELECT * FROM payment_methods
         WHERE tenant_id=$1 AND store_id=$2 AND status='active' AND customer_visible=TRUE
         ORDER BY CASE method_type
           WHEN 'sham_cash' THEN 1
           WHEN 'binance_pay' THEN 2
           WHEN 'usdt_trc20' THEN 3
           ELSE 10
         END, sort_order, created_at`,
        [store.tenant_id, store.id]
      );
      return { methods: result.rows.map(methodDto) };
    })
  );

  app.post(
    "/api/public/stores/:slug/wallet-proofs",
    route(async (request, reply) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      requireCustomerCsrf(request, customer);
      const body = request.body || {};
      const method = (await db.query(
        `SELECT * FROM payment_methods
         WHERE id=$1 AND tenant_id=$2 AND store_id=$3
           AND status='active' AND customer_visible=TRUE`,
        [body.paymentMethodId, store.tenant_id, store.id]
      )).rows[0];
      if (!method) throw new WalletProofError(404, "payment_method_not_found", "طريقة الدفع غير متاحة");
      const referenceText = safeText(body.referenceText, 180) || null;
      const proof = parseOptionalProof(body.proofDataUrl, Number(method.proof_max_bytes || DEFAULT_MAX_PROOF_BYTES));
      if (!referenceText && !proof) {
        throw new WalletProofError(422, "proof_required", "أرسل رقم العملية أو صورة الإيصال");
      }
      const idempotencyKey = requiredText(request.headers["idempotency-key"] || body.idempotencyKey, "مفتاح العملية", 160);
      const requestHash = sha256(JSON.stringify({
        storeId: store.id,
        customerId: customer.id,
        paymentMethodId: method.id,
        referenceText,
        proofHash: proof?.hash || null
      }));
      const existing = (await db.query(
        `SELECT * FROM wallet_topup_proofs
         WHERE tenant_id=$1 AND store_id=$2 AND customer_id=$3 AND idempotency_key=$4`,
        [store.tenant_id, store.id, customer.id, idempotencyKey]
      )).rows[0];
      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw new WalletProofError(409, "idempotency_mismatch", "تم استخدام مفتاح العملية مع إثبات مختلف");
        }
        return { proof: proofDto(existing), duplicate: true };
      }
      const id = randomUUID();
      await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO wallet_topup_proofs (
             id, tenant_id, store_id, customer_id, payment_method_id, currency,
             reference_text, proof_data, proof_mime, proof_sha256,
             idempotency_key, request_hash
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            id, store.tenant_id, store.id, customer.id, method.id,
            method.currency || customer.wallet_currency || store.currency,
            referenceText, proof?.data || null, proof?.mime || null, proof?.hash || null,
            idempotencyKey, requestHash
          ]
        );
        await notifyOwners(client, store, id, customer);
        await client.query(
          `INSERT INTO audit_logs (
             id, tenant_id, actor_customer_id, action, entity_type, entity_id,
             ip_address, after_data
           ) VALUES ($1,$2,$3,'wallet_proof.submitted','wallet_topup_proof',$4,$5,$6)`,
          [
            randomUUID(), store.tenant_id, customer.id, id, request.ip,
            JSON.stringify({ paymentMethodId: method.id, referenceProvided: Boolean(referenceText), imageProvided: Boolean(proof) })
          ]
        );
      }, store.tenant_id);
      const created = (await db.query(
        "SELECT * FROM wallet_topup_proofs WHERE id=$1 AND tenant_id=$2 AND store_id=$3",
        [id, store.tenant_id, store.id]
      )).rows[0];
      reply.code(201);
      return { proof: proofDto(created) };
    })
  );

  app.get(
    "/api/public/stores/:slug/wallet-proofs",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      const result = await db.query(
        `SELECT p.*, pm.name AS method_name, pm.method_type
         FROM wallet_topup_proofs p JOIN payment_methods pm ON pm.id=p.payment_method_id
         WHERE p.tenant_id=$1 AND p.store_id=$2 AND p.customer_id=$3
         ORDER BY p.created_at DESC LIMIT 100`,
        [store.tenant_id, store.id, customer.id]
      );
      return { proofs: result.rows.map((row) => proofDto(row)) };
    })
  );

  app.get(
    "/api/stores/:storeId/wallet-proofs",
    route(async (request) => {
      const user = await authenticatePlatform(db, request);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const status = safeText(request.query?.status, 20) || "pending";
      const values = [store.tenant_id, store.id];
      let filter = "";
      if (["pending", "approved", "rejected", "cancelled"].includes(status)) {
        values.push(status);
        filter = ` AND p.status=$${values.length}`;
      } else if (status !== "all") {
        throw new WalletProofError(422, "invalid_status", "حالة الإثبات غير صالحة");
      }
      const result = await db.query(
        `SELECT p.*, pm.name AS method_name, pm.method_type,
                c.display_name AS customer_name, c.email AS customer_email
         FROM wallet_topup_proofs p
         JOIN payment_methods pm ON pm.id=p.payment_method_id
         JOIN store_customers c ON c.id=p.customer_id
         WHERE p.tenant_id=$1 AND p.store_id=$2${filter}
         ORDER BY p.created_at DESC LIMIT 200`,
        values
      );
      return { proofs: result.rows.map((row) => proofDto(row, { includeImage: true })) };
    })
  );

  app.post(
    "/api/stores/:storeId/wallet-proofs/:proofId/review",
    route(async (request) => {
      const user = await authenticatePlatform(db, request);
      requirePlatformCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      if (store.role_key !== OWNER_ROLE) {
        throw new WalletProofError(403, "financial_permission_required", "هذه العملية المالية متاحة لمالك المتجر فقط");
      }
      const decision = safeText(request.body?.decision, 20);
      const proof = await reviewWalletTopupProof(db, {
        storeId: store.id,
        tenantId: store.tenant_id,
        proofId: request.params.proofId,
        decision,
        creditAmountMinor: request.body?.creditAmountMinor,
        reason: request.body?.reason,
        actorUserId: user.id,
        actorLabel: "web_admin",
        ipAddress: request.ip
      });
      return { proof };
    })
  );
}
