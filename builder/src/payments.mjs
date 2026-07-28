import { randomUUID } from "node:crypto";
import {
  hashPassword,
  normalizeEmail,
  randomToken,
  safeText,
  sha256,
  verifyPassword
} from "./security.mjs";

const PLATFORM_SESSION_COOKIE = "uchiha_builder_session";
const PAYMENT_TYPES = new Set(["binance_pay", "usdt_trc20", "sham_cash", "bank_transfer", "manual"]);
const DEPOSIT_STATUSES = new Set(["pending", "approved", "rejected", "cancelled"]);
const PROOF_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PROOF_BYTES = 1_500_000;
const PAYMENT_ROUTE_APPS = new WeakSet();

class PaymentError extends Error {
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
      if (error instanceof PaymentError) throw error;
      if (error?.code === "23505") {
        throw new PaymentError(409, "conflict", "تم إرسال هذه العملية مسبقًا");
      }
      throw error;
    }
  };
}

function integer(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, field = "القيمة" } = {}) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new PaymentError(422, "invalid_field", `${field} غير صالح`);
  }
  return parsed;
}

function requiredText(value, field, maxLength = 200) {
  const text = safeText(value, maxLength);
  if (!text) throw new PaymentError(422, "missing_field", `الحقل ${field} مطلوب`);
  return text;
}

function jsonValue(value, fallback = {}) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  if (typeof value === "string") return value.trim();
  return value;
}

function requestFingerprint(scope, payload) {
  return sha256(JSON.stringify({ scope, payload: canonicalize(payload) }));
}

async function claimCustomerIdempotency(client, { store, customer, scope, key, requestHash }) {
  await client.query(
    `INSERT INTO customer_idempotency_records (
       id, tenant_id, store_id, customer_id, scope, idempotency_key, request_hash
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (customer_id, scope, idempotency_key) DO NOTHING`,
    [randomUUID(), store.tenant_id, store.id, customer.id, scope, key, requestHash]
  );
  const record = (await client.query(
    `SELECT * FROM customer_idempotency_records
     WHERE tenant_id=$1 AND store_id=$2 AND customer_id=$3 AND scope=$4 AND idempotency_key=$5
     FOR UPDATE`,
    [store.tenant_id, store.id, customer.id, scope, key]
  )).rows[0];
  if (!record) throw new PaymentError(409, "idempotency_unavailable", "تعذر حجز العملية، أعد المحاولة");
  if (record.request_hash !== requestHash) {
    throw new PaymentError(409, "idempotency_mismatch", "تم استخدام مفتاح العملية مع بيانات مختلفة");
  }
  return record;
}

async function completeCustomerIdempotency(client, recordId, resourceId, responseData) {
  await client.query(
    `UPDATE customer_idempotency_records
     SET resource_id=$2, response_data=$3, updated_at=NOW()
     WHERE id=$1`,
    [recordId, resourceId, JSON.stringify(responseData)]
  );
}

async function writeAudit(client, {
  store,
  actorUserId = null,
  actorCustomerId = null,
  action,
  entityType,
  entityId,
  ipAddress = null,
  beforeData = null,
  afterData = null
}) {
  await client.query(
    `INSERT INTO audit_logs (
       id, tenant_id, actor_user_id, actor_customer_id, action, entity_type,
       entity_id, ip_address, before_data, after_data
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      randomUUID(), store.tenant_id, actorUserId, actorCustomerId, action, entityType,
      entityId, safeText(ipAddress, 120) || null,
      beforeData === null ? null : JSON.stringify(beforeData),
      afterData === null ? null : JSON.stringify(afterData)
    ]
  );
}

async function notifyCustomer(client, { store, customerId, type, title, message, referenceType = null, referenceId = null }) {
  await client.query(
    `INSERT INTO customer_notifications (
       id, tenant_id, store_id, customer_id, notification_type, title, message,
       reference_type, reference_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [randomUUID(), store.tenant_id, store.id, customerId, type, title, message, referenceType, referenceId]
  );
}

function customerCookieName(store) {
  return `uchiha_customer_${sha256(store.id).slice(0, 16)}`;
}

function setCustomerCookie(reply, config, store, token, expiresAt) {
  reply.setCookie(customerCookieName(store), token, {
    path: "/",
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    expires: expiresAt
  });
}

async function storeBySlug(db, slug) {
  const result = await db.query(
    `SELECT s.*, t.status AS tenant_status
     FROM stores s JOIN tenants t ON t.id = s.tenant_id
     WHERE s.slug = $1 AND s.status IN ('active', 'ready')`,
    [safeText(slug, 160).toLowerCase()]
  );
  const store = result.rows[0];
  if (!store) throw new PaymentError(404, "store_not_found", "المتجر غير موجود");
  return store;
}

async function authenticatePlatform(db, request) {
  const token = request.cookies[PLATFORM_SESSION_COOKIE];
  if (!token) throw new PaymentError(401, "authentication_required", "يجب تسجيل الدخول إلى لوحة الإدارة");
  const result = await db.query(
    `SELECT u.*, s.csrf_hash
     FROM sessions s JOIN platform_users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW() AND u.status = 'active'`,
    [sha256(token)]
  );
  const user = result.rows[0];
  if (!user) throw new PaymentError(401, "invalid_session", "انتهت جلسة الإدارة");
  return user;
}

function requirePlatformCsrf(request, user) {
  const token = request.headers["x-csrf-token"];
  if (!token || sha256(token) !== user.csrf_hash) {
    throw new PaymentError(403, "csrf_failed", "تعذر التحقق من طلب الإدارة");
  }
}

async function requireStoreAccess(db, user, storeId) {
  const result = await db.query(
    `SELECT s.*, tm.role_key
     FROM stores s JOIN tenant_memberships tm ON tm.tenant_id = s.tenant_id
     WHERE s.id = $1 AND tm.user_id = $2 AND tm.status = 'active'`,
    [storeId, user.id]
  );
  const store = result.rows[0];
  if (!store) throw new PaymentError(404, "store_not_found", "المتجر غير موجود");
  return store;
}

async function issueCustomerSession(db, config, request, customerId) {
  const token = randomToken();
  const csrf = randomToken(24);
  const expiresAt = new Date(Date.now() + config.sessionHours * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      sha256(token),
      customerId,
      sha256(csrf),
      expiresAt,
      safeText(request.headers["user-agent"], 500),
      request.ip
    ]
  );
  return { token, csrf, expiresAt };
}

async function authenticateCustomer(db, request, store) {
  const cookieName = customerCookieName(store);
  const token = request.cookies[cookieName];
  if (!token) throw new PaymentError(401, "customer_authentication_required", "سجّل الدخول إلى حساب المتجر أولًا");
  const result = await db.query(
    `SELECT c.*, cs.csrf_hash, w.balance_minor, w.currency AS wallet_currency
     FROM customer_sessions cs
     JOIN store_customers c ON c.id = cs.customer_id
     JOIN customer_wallets w ON w.customer_id = c.id
     WHERE cs.token_hash = $1 AND cs.revoked_at IS NULL AND cs.expires_at > NOW()
       AND c.tenant_id = $2 AND c.store_id = $3 AND w.tenant_id = $2 AND w.store_id = $3
       AND c.status = 'active'`,
    [sha256(token), store.tenant_id, store.id]
  );
  const customer = result.rows[0];
  if (!customer) throw new PaymentError(401, "invalid_customer_session", "انتهت جلسة حساب المتجر");
  customer.session_token = token;
  customer.session_cookie = cookieName;
  return customer;
}

function requireCustomerCsrf(request, customer) {
  const token = request.headers["x-customer-csrf-token"];
  if (!token || sha256(token) !== customer.csrf_hash) {
    throw new PaymentError(403, "csrf_failed", "تعذر التحقق من طلب العميل");
  }
}

function customerDto(customer) {
  return {
    id: customer.id,
    displayName: customer.display_name,
    email: customer.email,
    phone: customer.phone || null,
    balanceMinor: Number(customer.balance_minor || 0),
    currency: customer.wallet_currency || customer.currency
  };
}

function paymentMethodDto(row, { publicView = false } = {}) {
  const destination = jsonValue(row.destination_data, {});
  return {
    id: row.id,
    name: row.name,
    type: row.method_type,
    instructions: row.instructions,
    destination: publicView ? destination : destination,
    commissionBps: Number(row.commission_bps),
    fixedFeeMinor: Number(row.fixed_fee_minor),
    minimumAmountMinor: Number(row.minimum_amount_minor),
    maximumAmountMinor: row.maximum_amount_minor === null ? null : Number(row.maximum_amount_minor),
    sortOrder: Number(row.sort_order),
    status: row.status
  };
}

function depositDto(row, { includeProof = false } = {}) {
  return {
    id: row.id,
    requestedAmountMinor: Number(row.requested_amount_minor),
    commissionMinor: Number(row.commission_minor),
    netAmountMinor: Number(row.net_amount_minor),
    currency: row.currency,
    status: row.status,
    referenceText: row.reference_text || null,
    reviewReason: row.review_reason || null,
    paymentMethod: row.method_name
      ? { id: row.payment_method_id, name: row.method_name, type: row.method_type }
      : undefined,
    customer: row.customer_email
      ? { id: row.customer_id, email: row.customer_email, displayName: row.customer_name }
      : undefined,
    proof: includeProof ? { mime: row.proof_mime, data: row.proof_data } : undefined,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function proofSignatureMatches(mime, bytes) {
  if (mime === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mime === "image/jpeg") {
    return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  }
  if (mime === "image/webp") {
    return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function parseProof(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match || !PROOF_MIME.has(match[1])) {
    throw new PaymentError(422, "invalid_proof", "اختر صورة JPG أو PNG أو WEBP لإثبات التحويل");
  }
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length < 32 || bytes.length > MAX_PROOF_BYTES) {
    throw new PaymentError(422, "invalid_proof_size", "حجم صورة الإثبات يجب ألا يتجاوز 1.5 ميجابايت");
  }
  if (!proofSignatureMatches(match[1], bytes)) {
    throw new PaymentError(422, "invalid_proof_content", "محتوى ملف إثبات التحويل لا يطابق نوع الصورة");
  }
  return { mime: match[1], data: `data:${match[1]};base64,${bytes.toString("base64")}` };
}

function calculateNet(amountMinor, method) {
  const percentage = Math.round(amountMinor * (Number(method.commission_bps) / 10_000));
  const commissionMinor = percentage + Number(method.fixed_fee_minor);
  const netAmountMinor = amountMinor - commissionMinor;
  if (netAmountMinor <= 0) {
    throw new PaymentError(422, "amount_below_commission", "المبلغ لا يغطي عمولة طريقة الدفع");
  }
  return { commissionMinor, netAmountMinor };
}

async function ensureDemoMethods(db, config, store) {
  if (!config.allowDemoBilling) return;
  const found = await db.query("SELECT 1 FROM payment_methods WHERE store_id = $1 LIMIT 1", [store.id]);
  if (found.rows[0]) return;
  const defaults = [
    ["Binance Pay", "binance_pay", "حوّل إلى Pay ID الظاهر ثم ارفع لقطة واضحة للعملية.", { payId: "DEMO-PAY-ID" }, 200, 0, 100],
    ["USDT TRC20", "usdt_trc20", "استخدم شبكة TRC20 فقط وارفع إثبات التحويل.", { network: "TRC20", address: "DEMO-TRC20-ADDRESS" }, 100, 0, 100],
    ["Sham Cash", "sham_cash", "حوّل إلى الحساب الموضح ثم ارفع صورة الإيصال.", { account: "DEMO-SHAM-CASH" }, 250, 0, 100]
  ];
  for (let index = 0; index < defaults.length; index += 1) {
    const [name, type, instructions, destination, bps, fixed, minimum] = defaults[index];
    await db.query(
      `INSERT INTO payment_methods (
         id, tenant_id, store_id, name, method_type, instructions, destination_data,
         commission_bps, fixed_fee_minor, minimum_amount_minor, sort_order, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active')`,
      [randomUUID(), store.tenant_id, store.id, name, type, instructions, JSON.stringify(destination), bps, fixed, minimum, index]
    );
  }
}

function fieldChoices(field) {
  const choices = Array.isArray(field.options) ? field.options : Array.isArray(field.choices) ? field.choices : [];
  return choices
    .map((choice) => (typeof choice === "object" ? choice.value ?? choice.id ?? choice.label : choice))
    .filter((choice) => choice !== undefined && choice !== null)
    .map(String);
}

function validateOrderInputs(product, inputData) {
  const fields = Array.isArray(product.fields) ? product.fields : jsonValue(product.fields, []);
  const supplied = inputData && typeof inputData === "object" && !Array.isArray(inputData) ? inputData : {};
  const validated = {};
  for (const field of fields) {
    const key = safeText(field.key || field.name, 80);
    if (!key) continue;
    const label = safeText(field.label, 120) || key;
    const raw = supplied[key];
    const empty = raw === undefined || raw === null || String(raw).trim() === "";
    if (field.required && empty) {
      throw new PaymentError(422, "missing_product_field", `الحقل ${label} مطلوب`, { key });
    }
    if (empty) continue;
    const maxLength = integer(field.maxLength ?? 500, { minimum: 1, maximum: 2000, field: `طول ${label}` });
    const value = safeText(raw, maxLength);
    const type = safeText(field.type, 30).toLowerCase() || "text";
    if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new PaymentError(422, "invalid_product_field", `الحقل ${label} يجب أن يكون بريدًا صالحًا`, { key });
    }
    if (type === "url") {
      try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
      } catch {
        throw new PaymentError(422, "invalid_product_field", `الحقل ${label} يجب أن يكون رابطًا صالحًا`, { key });
      }
    }
    if (type === "number") {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        throw new PaymentError(422, "invalid_product_field", `الحقل ${label} يجب أن يكون رقمًا`, { key });
      }
      if (field.minimum !== undefined && numeric < Number(field.minimum)) {
        throw new PaymentError(422, "invalid_product_field", `قيمة ${label} أقل من المسموح`, { key });
      }
      if (field.maximum !== undefined && numeric > Number(field.maximum)) {
        throw new PaymentError(422, "invalid_product_field", `قيمة ${label} أكبر من المسموح`, { key });
      }
    }
    const choices = fieldChoices(field);
    if (choices.length && !choices.includes(value)) {
      throw new PaymentError(422, "invalid_product_option", `الخيار المحدد في ${label} غير متاح`, { key });
    }
    validated[key] = value;
  }
  return validated;
}

export function installPaymentRoutes(app, { db, config }) {
  if (PAYMENT_ROUTE_APPS.has(app)) return false;
  PAYMENT_ROUTE_APPS.add(app);
  app.get("/store/:slug/wallet", async (_request, reply) => reply.sendFile("wallet.html"));
  app.get("/admin/:storeId/payments", async (_request, reply) => reply.sendFile("payments-admin.html"));

  app.post(
    "/api/public/stores/:slug/customers/register",
    route(async (request, reply) => {
      const store = await storeBySlug(db, request.params.slug);
      const body = request.body || {};
      const email = normalizeEmail(body.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new PaymentError(422, "invalid_email", "البريد الإلكتروني غير صالح");
      }
      const displayName = requiredText(body.displayName, "الاسم", 120);
      const passwordHash = await hashPassword(String(body.password || ""));
      const id = randomUUID();
      await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO store_customers (id, tenant_id, store_id, email, display_name, password_hash, phone)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, store.tenant_id, store.id, email, displayName, passwordHash, safeText(body.phone, 40) || null]
        );
        await client.query(
          `INSERT INTO customer_wallets (customer_id, tenant_id, store_id, currency)
           VALUES ($1,$2,$3,$4)`,
          [id, store.tenant_id, store.id, store.currency]
        );
      }, store.tenant_id);
      const session = await issueCustomerSession(db, config, request, id);
      setCustomerCookie(reply, config, store, session.token, session.expiresAt);
      reply.code(201);
      return {
        customer: { id, displayName, email, phone: safeText(body.phone, 40) || null, balanceMinor: 0, currency: store.currency },
        csrfToken: session.csrf
      };
    })
  );

  app.post(
    "/api/public/stores/:slug/customers/login",
    route(async (request, reply) => {
      const store = await storeBySlug(db, request.params.slug);
      const email = normalizeEmail(request.body?.email);
      const result = await db.query(
        `SELECT c.*, w.balance_minor, w.currency AS wallet_currency
         FROM store_customers c JOIN customer_wallets w ON w.customer_id = c.id
         WHERE c.tenant_id = $1 AND c.store_id = $2 AND c.email = $3
           AND w.tenant_id = $1 AND w.store_id = $2 AND c.status = 'active'`,
        [store.tenant_id, store.id, email]
      );
      const customer = result.rows[0];
      if (!customer || !(await verifyPassword(String(request.body?.password || ""), customer.password_hash))) {
        throw new PaymentError(401, "invalid_credentials", "بيانات الدخول غير صحيحة");
      }
      const session = await issueCustomerSession(db, config, request, customer.id);
      setCustomerCookie(reply, config, store, session.token, session.expiresAt);
      return { customer: customerDto(customer), csrfToken: session.csrf };
    })
  );

  app.post(
    "/api/public/stores/:slug/customers/logout",
    route(async (request, reply) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      requireCustomerCsrf(request, customer);
      await db.query("UPDATE customer_sessions SET revoked_at = NOW() WHERE token_hash = $1", [
        sha256(customer.session_token)
      ]);
      reply.clearCookie(customer.session_cookie, { path: "/" });
      return { ok: true };
    })
  );

  app.get(
    "/api/public/stores/:slug/customer/me",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      const csrfToken = randomToken(24);
      await db.query("UPDATE customer_sessions SET csrf_hash = $2 WHERE token_hash = $1", [
        sha256(customer.session_token),
        sha256(csrfToken)
      ]);
      return { customer: customerDto(customer), csrfToken };
    })
  );

  app.get(
    "/api/public/stores/:slug/payment-methods",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      await ensureDemoMethods(db, config, store);
      const result = await db.query(
        `SELECT * FROM payment_methods
         WHERE tenant_id = $1 AND store_id = $2 AND status = 'active'
         ORDER BY sort_order, created_at`,
        [store.tenant_id, store.id]
      );
      return { currency: store.currency, methods: result.rows.map((row) => paymentMethodDto(row, { publicView: true })) };
    })
  );

  app.get(
    "/api/public/stores/:slug/wallet",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      const ledger = await db.query(
        `SELECT * FROM wallet_ledger
         WHERE tenant_id=$1 AND store_id=$2 AND customer_id=$3
         ORDER BY created_at DESC LIMIT 50`,
        [store.tenant_id, store.id, customer.id]
      );
      const deposits = await db.query(
        `SELECT d.*, pm.name AS method_name, pm.method_type
         FROM deposit_requests d JOIN payment_methods pm ON pm.id = d.payment_method_id
         WHERE d.tenant_id=$1 AND d.store_id=$2 AND d.customer_id=$3
         ORDER BY d.created_at DESC LIMIT 50`,
        [store.tenant_id, store.id, customer.id]
      );
      const notifications = await db.query(
        `SELECT * FROM customer_notifications
         WHERE tenant_id=$1 AND store_id=$2 AND customer_id=$3
         ORDER BY created_at DESC LIMIT 30`,
        [store.tenant_id, store.id, customer.id]
      );
      return {
        wallet: { balanceMinor: Number(customer.balance_minor), currency: customer.wallet_currency },
        ledger: ledger.rows.map((row) => ({
          id: row.id,
          type: row.entry_type,
          amountMinor: Number(row.amount_minor),
          balanceAfterMinor: Number(row.balance_after_minor),
          note: row.note || null,
          createdAt: row.created_at
        })),
        deposits: deposits.rows.map((row) => depositDto(row)),
        notifications: notifications.rows.map((row) => ({
          id: row.id,
          type: row.notification_type,
          title: row.title,
          message: row.message,
          referenceType: row.reference_type || null,
          referenceId: row.reference_id || null,
          readAt: row.read_at || null,
          createdAt: row.created_at
        }))
      };
    })
  );

  app.post(
    "/api/public/stores/:slug/deposits",
    route(async (request, reply) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      requireCustomerCsrf(request, customer);
      const body = request.body || {};
      const method = (await db.query(
        `SELECT * FROM payment_methods
         WHERE id = $1 AND tenant_id = $2 AND store_id = $3 AND status = 'active'`,
        [body.paymentMethodId, store.tenant_id, store.id]
      )).rows[0];
      if (!method) throw new PaymentError(404, "payment_method_not_found", "طريقة الدفع غير متاحة");
      const amountMinor = integer(body.amountMinor, { minimum: 1, maximum: 1_000_000_000, field: "المبلغ" });
      if (amountMinor < Number(method.minimum_amount_minor)) {
        throw new PaymentError(422, "below_minimum", "المبلغ أقل من الحد الأدنى لطريقة الدفع");
      }
      if (method.maximum_amount_minor !== null && amountMinor > Number(method.maximum_amount_minor)) {
        throw new PaymentError(422, "above_maximum", "المبلغ أكبر من الحد الأعلى لطريقة الدفع");
      }
      const { commissionMinor, netAmountMinor } = calculateNet(amountMinor, method);
      const proof = parseProof(body.proofDataUrl);
      const referenceText = safeText(body.referenceText, 200) || null;
      const idempotencyKey = requiredText(request.headers["idempotency-key"] || body.idempotencyKey, "مفتاح العملية", 160);
      const requestHash = requestFingerprint("deposit.create", {
        storeId: store.id,
        customerId: customer.id,
        paymentMethodId: method.id,
        amountMinor,
        proofHash: sha256(proof.data),
        referenceText
      });
      const result = await db.transaction(async (client) => {
        const record = await claimCustomerIdempotency(client, {
          store,
          customer,
          scope: "deposit.create",
          key: idempotencyKey,
          requestHash
        });
        if (record.resource_id) {
          const replay = (await client.query(
            `SELECT d.*, pm.name AS method_name, pm.method_type
             FROM deposit_requests d JOIN payment_methods pm ON pm.id = d.payment_method_id
             WHERE d.id = $1 AND d.tenant_id = $2 AND d.store_id = $3 AND d.customer_id = $4`,
            [record.resource_id, store.tenant_id, store.id, customer.id]
          )).rows[0];
          if (!replay) throw new PaymentError(409, "idempotency_resource_missing", "تعذر استعادة العملية السابقة");
          return { row: replay, duplicate: true };
        }

        const id = randomUUID();
        await client.query(
          `INSERT INTO deposit_requests (
             id, tenant_id, store_id, customer_id, payment_method_id,
             requested_amount_minor, commission_minor, net_amount_minor, currency,
             proof_data, proof_mime, reference_text, idempotency_key, request_hash
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            id, store.tenant_id, store.id, customer.id, method.id,
            amountMinor, commissionMinor, netAmountMinor, store.currency,
            proof.data, proof.mime, referenceText, idempotencyKey, requestHash
          ]
        );
        await notifyCustomer(client, {
          store,
          customerId: customer.id,
          type: "deposit_submitted",
          title: "تم استلام طلب شحن الرصيد",
          message: "طلبك قيد المراجعة، ولن يضاف الرصيد قبل اعتماد إثبات التحويل.",
          referenceType: "deposit",
          referenceId: id
        });
        await writeAudit(client, {
          store,
          actorCustomerId: customer.id,
          action: "deposit.submitted",
          entityType: "deposit_request",
          entityId: id,
          ipAddress: request.ip,
          afterData: { amountMinor, commissionMinor, netAmountMinor, currency: store.currency, paymentMethodId: method.id }
        });
        await client.query(
          `INSERT INTO outbox_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1,$2,'deposit_request',$3,'deposit.submitted',$4)`,
          [randomUUID(), store.tenant_id, id, JSON.stringify({ storeId: store.id, customerId: customer.id, depositId: id })]
        );
        const created = (await client.query(
          `SELECT d.*, pm.name AS method_name, pm.method_type
           FROM deposit_requests d JOIN payment_methods pm ON pm.id = d.payment_method_id
           WHERE d.id = $1 AND d.tenant_id = $2 AND d.store_id = $3`,
          [id, store.tenant_id, store.id]
        )).rows[0];
        await completeCustomerIdempotency(client, record.id, id, { depositId: id });
        return { row: created, duplicate: false };
      }, store.tenant_id);
      reply.code(result.duplicate ? 200 : 201);
      return { deposit: depositDto(result.row), duplicate: result.duplicate };
    })
  );

  app.post(
    "/api/public/stores/:slug/orders/wallet",
    route(async (request, reply) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      requireCustomerCsrf(request, customer);
      const items = Array.isArray(request.body?.items) ? request.body.items : [];
      if (!items.length || items.length > 20) {
        throw new PaymentError(422, "invalid_items", "اختر منتجًا واحدًا على الأقل");
      }
      const normalizedItems = items.map((item) => ({
        productId: requiredText(item?.productId, "المنتج", 80),
        quantity: integer(item?.quantity ?? 1, { minimum: 1, maximum: 100_000, field: "الكمية" }),
        inputData: item?.inputData && typeof item.inputData === "object" && !Array.isArray(item.inputData) ? item.inputData : {}
      }));
      if (new Set(normalizedItems.map((item) => item.productId)).size !== normalizedItems.length) {
        throw new PaymentError(422, "duplicate_product", "لا تكرر المنتج نفسه داخل الطلب");
      }
      normalizedItems.sort((left, right) => left.productId.localeCompare(right.productId));
      const idempotencyKey = requiredText(request.headers["idempotency-key"] || request.body?.idempotencyKey, "مفتاح العملية", 160);
      const requestHash = requestFingerprint("wallet.purchase", {
        storeId: store.id,
        customerId: customer.id,
        items: normalizedItems
      });
      const result = await db.transaction(async (client) => {
        const record = await claimCustomerIdempotency(client, {
          store,
          customer,
          scope: "wallet.purchase",
          key: idempotencyKey,
          requestHash
        });
        if (record.resource_id) {
          const replay = (await client.query(
            `SELECT * FROM orders
             WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND customer_id=$4 AND payment_source='wallet'`,
            [record.resource_id, store.tenant_id, store.id, customer.id]
          )).rows[0];
          if (!replay) throw new PaymentError(409, "idempotency_resource_missing", "تعذر استعادة الطلب السابق");
          return { row: replay, duplicate: true };
        }

        const wallet = (await client.query(
          `SELECT * FROM customer_wallets
           WHERE customer_id=$1 AND tenant_id=$2 AND store_id=$3 FOR UPDATE`,
          [customer.id, store.tenant_id, store.id]
        )).rows[0];
        if (!wallet) throw new PaymentError(409, "wallet_not_found", "محفظة العميل غير موجودة");
        if (wallet.currency !== store.currency) {
          throw new PaymentError(409, "wallet_currency_mismatch", "عملة المحفظة لا تطابق عملة المتجر");
        }

        let totalMinor = 0;
        const prepared = [];
        for (const item of normalizedItems) {
          const product = (await client.query(
            `SELECT * FROM products
             WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND status='active' FOR UPDATE`,
            [item.productId, store.tenant_id, store.id]
          )).rows[0];
          if (!product) throw new PaymentError(404, "product_not_found", "أحد المنتجات غير متاح");
          if (product.currency !== store.currency) {
            throw new PaymentError(409, "product_currency_mismatch", `عملة المنتج ${product.name} لا تطابق عملة المتجر`);
          }
          const quantity = integer(item.quantity, {
            minimum: Number(product.min_quantity),
            maximum: product.max_quantity === null ? 100_000 : Number(product.max_quantity),
            field: "الكمية"
          });
          if (product.stock_quantity !== null && quantity > Number(product.stock_quantity)) {
            throw new PaymentError(409, "insufficient_stock", `الكمية غير متوفرة للمنتج ${product.name}`);
          }
          const inputData = validateOrderInputs(product, item.inputData);
          const lineTotal = Number(product.price_minor) * quantity;
          if (!Number.isSafeInteger(lineTotal) || lineTotal < 0 || !Number.isSafeInteger(totalMinor + lineTotal)) {
            throw new PaymentError(422, "invalid_total", "تعذر حساب إجمالي الطلب بأمان");
          }
          totalMinor += lineTotal;
          prepared.push({ product, quantity, inputData, lineTotal });
        }
        if (totalMinor <= 0) throw new PaymentError(422, "invalid_total", "إجمالي الطلب يجب أن يكون أكبر من صفر");
        if (Number(wallet.balance_minor) < totalMinor) {
          throw new PaymentError(409, "insufficient_balance", "رصيد الحساب غير كافٍ لإتمام الشراء", {
            balanceMinor: Number(wallet.balance_minor),
            requiredMinor: totalMinor
          });
        }

        const orderId = randomUUID();
        const orderNumber = `WB-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 5).toUpperCase()}`;
        const balanceAfter = Number(wallet.balance_minor) - totalMinor;
        const storedIdempotencyKey = `wallet:${customer.id}:${idempotencyKey}`;
        await client.query(
          `INSERT INTO orders (
             id, tenant_id, store_id, customer_id, order_number, customer_name, customer_email,
             channel, status, payment_status, total_minor, currency, idempotency_key,
             request_hash, payment_source
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,'web','processing','paid',$8,$9,$10,$11,'wallet')`,
          [
            orderId, store.tenant_id, store.id, customer.id, orderNumber,
            customer.display_name, customer.email, totalMinor, store.currency,
            storedIdempotencyKey, requestHash
          ]
        );
        for (const line of prepared) {
          await client.query(
            `INSERT INTO order_items (
               id, tenant_id, order_id, product_id, product_name_snapshot,
               product_type_snapshot, quantity, unit_price_minor, total_minor, input_data
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              randomUUID(), store.tenant_id, orderId, line.product.id, line.product.name,
              line.product.product_type, line.quantity, Number(line.product.price_minor),
              line.lineTotal, JSON.stringify(line.inputData)
            ]
          );
          if (line.product.stock_quantity !== null) {
            const stockBefore = Number(line.product.stock_quantity);
            const stockAfter = stockBefore - line.quantity;
            if (!Number.isSafeInteger(stockAfter) || stockAfter < 0) {
              throw new PaymentError(409, "insufficient_stock", `الكمية غير متوفرة للمنتج ${line.product.name}`);
            }
            const updatedStock = await client.query(
              `UPDATE products SET stock_quantity=$2, updated_at=NOW()
               WHERE id=$1 AND tenant_id=$3 AND store_id=$4 AND stock_quantity=$5`,
              [line.product.id, stockAfter, store.tenant_id, store.id, stockBefore]
            );
            if (updatedStock.rowCount !== 1) {
              throw new PaymentError(409, "stock_changed", `تغير مخزون المنتج ${line.product.name}، أعد المحاولة`);
            }
          }
        }
        await client.query(
          `UPDATE customer_wallets SET balance_minor=$2, updated_at=NOW()
           WHERE customer_id=$1 AND tenant_id=$3 AND store_id=$4`,
          [customer.id, balanceAfter, store.tenant_id, store.id]
        );
        await client.query(
          `INSERT INTO wallet_ledger (
             id, tenant_id, store_id, customer_id, entry_type, amount_minor,
             balance_after_minor, currency, reference_type, reference_id, note
           ) VALUES ($1,$2,$3,$4,'purchase',$5,$6,$7,'order',$8,$9)`,
          [randomUUID(), store.tenant_id, store.id, customer.id, -totalMinor, balanceAfter, store.currency, orderId, `شراء الطلب ${orderNumber}`]
        );
        await notifyCustomer(client, {
          store,
          customerId: customer.id,
          type: "order_paid",
          title: "تم الدفع من المحفظة",
          message: `تم إنشاء الطلب ${orderNumber} وخصم قيمته من رصيدك.`,
          referenceType: "order",
          referenceId: orderId
        });
        await writeAudit(client, {
          store,
          actorCustomerId: customer.id,
          action: "wallet.purchase",
          entityType: "order",
          entityId: orderId,
          ipAddress: request.ip,
          afterData: { orderNumber, totalMinor, currency: store.currency, balanceAfter }
        });
        await client.query(
          `INSERT INTO outbox_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1,$2,'order',$3,'wallet.order_paid',$4)`,
          [randomUUID(), store.tenant_id, orderId, JSON.stringify({ storeId: store.id, customerId: customer.id, orderId })]
        );
        const created = {
          id: orderId,
          order_number: orderNumber,
          total_minor: totalMinor,
          currency: store.currency,
          status: "processing",
          payment_status: "paid"
        };
        await completeCustomerIdempotency(client, record.id, orderId, { orderId, orderNumber });
        return { row: created, duplicate: false };
      }, store.tenant_id);
      reply.code(result.duplicate ? 200 : 201);
      return {
        duplicate: result.duplicate,
        order: {
          id: result.row.id,
          orderNumber: result.row.order_number,
          totalMinor: Number(result.row.total_minor),
          currency: result.row.currency,
          status: result.row.status,
          paymentStatus: result.row.payment_status
        }
      };
    })
  );

  app.get(
    "/api/stores/:storeId/payment-methods",
    route(async (request) => {
      const user = await authenticatePlatform(db, request);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const result = await db.query(
        "SELECT * FROM payment_methods WHERE tenant_id=$1 AND store_id=$2 ORDER BY sort_order, created_at",
        [store.tenant_id, store.id]
      );
      return { methods: result.rows.map((row) => paymentMethodDto(row)) };
    })
  );

  app.post(
    "/api/stores/:storeId/payment-methods",
    route(async (request, reply) => {
      const user = await authenticatePlatform(db, request);
      requirePlatformCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const body = request.body || {};
      const type = requiredText(body.type, "نوع طريقة الدفع", 40);
      if (!PAYMENT_TYPES.has(type)) throw new PaymentError(422, "invalid_payment_type", "نوع طريقة الدفع غير مدعوم");
      const id = randomUUID();
      await db.query(
        `INSERT INTO payment_methods (
           id, tenant_id, store_id, name, method_type, instructions, destination_data,
           commission_bps, fixed_fee_minor, minimum_amount_minor, maximum_amount_minor,
           sort_order, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id, store.tenant_id, store.id, requiredText(body.name, "الاسم", 120), type,
          safeText(body.instructions, 1500), JSON.stringify(body.destination || {}),
          integer(body.commissionBps ?? 0, { minimum: 0, maximum: 10_000, field: "العمولة" }),
          integer(body.fixedFeeMinor ?? 0, { minimum: 0, field: "العمولة الثابتة" }),
          integer(body.minimumAmountMinor ?? 0, { minimum: 0, field: "الحد الأدنى" }),
          body.maximumAmountMinor === null || body.maximumAmountMinor === undefined || body.maximumAmountMinor === ""
            ? null
            : integer(body.maximumAmountMinor, { minimum: 1, field: "الحد الأعلى" }),
          integer(body.sortOrder ?? 0, { minimum: 0, maximum: 10_000, field: "الترتيب" }),
          ["active", "hidden", "disabled"].includes(body.status) ? body.status : "active"
        ]
      );
      reply.code(201);
      const created = (await db.query("SELECT * FROM payment_methods WHERE id = $1", [id])).rows[0];
      return { method: paymentMethodDto(created) };
    })
  );

  app.put(
    "/api/stores/:storeId/payment-methods/:methodId",
    route(async (request) => {
      const user = await authenticatePlatform(db, request);
      requirePlatformCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const existing = (await db.query(
        "SELECT * FROM payment_methods WHERE id=$1 AND tenant_id=$2 AND store_id=$3",
        [request.params.methodId, store.tenant_id, store.id]
      )).rows[0];
      if (!existing) throw new PaymentError(404, "payment_method_not_found", "طريقة الدفع غير موجودة");
      const body = request.body || {};
      const type = body.type || existing.method_type;
      if (!PAYMENT_TYPES.has(type)) throw new PaymentError(422, "invalid_payment_type", "نوع طريقة الدفع غير مدعوم");
      const status = body.status || existing.status;
      if (!["active", "hidden", "disabled"].includes(status)) {
        throw new PaymentError(422, "invalid_status", "حالة طريقة الدفع غير صالحة");
      }
      await db.query(
        `UPDATE payment_methods SET
           name=$3, method_type=$4, instructions=$5, destination_data=$6,
           commission_bps=$7, fixed_fee_minor=$8, minimum_amount_minor=$9,
           maximum_amount_minor=$10, sort_order=$11, status=$12, updated_at=NOW()
         WHERE id=$1 AND store_id=$2`,
        [
          existing.id, store.id, safeText(body.name, 120) || existing.name, type,
          body.instructions === undefined ? existing.instructions : safeText(body.instructions, 1500),
          JSON.stringify(body.destination === undefined ? jsonValue(existing.destination_data, {}) : body.destination),
          body.commissionBps === undefined ? Number(existing.commission_bps) : integer(body.commissionBps, { minimum: 0, maximum: 10_000, field: "العمولة" }),
          body.fixedFeeMinor === undefined ? Number(existing.fixed_fee_minor) : integer(body.fixedFeeMinor, { minimum: 0, field: "العمولة الثابتة" }),
          body.minimumAmountMinor === undefined ? Number(existing.minimum_amount_minor) : integer(body.minimumAmountMinor, { minimum: 0, field: "الحد الأدنى" }),
          body.maximumAmountMinor === undefined
            ? existing.maximum_amount_minor
            : body.maximumAmountMinor === null || body.maximumAmountMinor === ""
              ? null
              : integer(body.maximumAmountMinor, { minimum: 1, field: "الحد الأعلى" }),
          body.sortOrder === undefined ? Number(existing.sort_order) : integer(body.sortOrder, { minimum: 0, maximum: 10_000, field: "الترتيب" }),
          status
        ]
      );
      const updated = (await db.query("SELECT * FROM payment_methods WHERE id = $1", [existing.id])).rows[0];
      return { method: paymentMethodDto(updated) };
    })
  );

  app.get(
    "/api/stores/:storeId/deposits",
    route(async (request) => {
      const user = await authenticatePlatform(db, request);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const status = safeText(request.query?.status, 20) || "pending";
      if (!DEPOSIT_STATUSES.has(status) && status !== "all") {
        throw new PaymentError(422, "invalid_status", "حالة الطلب غير صالحة");
      }
      const values = [store.tenant_id, store.id];
      let filter = "";
      if (status !== "all") {
        values.push(status);
        filter = "AND d.status = $3";
      }
      const result = await db.query(
        `SELECT d.*, pm.name AS method_name, pm.method_type,
                c.email AS customer_email, c.display_name AS customer_name
         FROM deposit_requests d
         JOIN payment_methods pm ON pm.id = d.payment_method_id
         JOIN store_customers c ON c.id = d.customer_id
         WHERE d.tenant_id = $1 AND d.store_id = $2 ${filter}
         ORDER BY d.created_at DESC LIMIT 200`,
        values
      );
      return { deposits: result.rows.map((row) => depositDto(row, { includeProof: true })) };
    })
  );

  app.post(
    "/api/stores/:storeId/deposits/:depositId/review",
    route(async (request) => {
      const user = await authenticatePlatform(db, request);
      requirePlatformCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const decision = request.body?.decision;
      if (!["approve", "reject"].includes(decision)) {
        throw new PaymentError(422, "invalid_decision", "اختر قبول الطلب أو رفضه");
      }
      const reason = safeText(request.body?.reason, 500) || null;
      if (decision === "reject" && !reason) {
        throw new PaymentError(422, "rejection_reason_required", "سبب الرفض مطلوب ليظهر للعميل");
      }
      const reviewed = await db.transaction(async (client) => {
        const deposit = (await client.query(
          `SELECT * FROM deposit_requests
           WHERE id=$1 AND tenant_id=$2 AND store_id=$3 FOR UPDATE`,
          [request.params.depositId, store.tenant_id, store.id]
        )).rows[0];
        if (!deposit) throw new PaymentError(404, "deposit_not_found", "طلب الشحن غير موجود");
        if (deposit.status !== "pending") {
          throw new PaymentError(409, "deposit_already_reviewed", "تمت مراجعة هذا الطلب مسبقًا");
        }

        const beforeData = {
          status: deposit.status,
          requestedAmountMinor: Number(deposit.requested_amount_minor),
          commissionMinor: Number(deposit.commission_minor),
          netAmountMinor: Number(deposit.net_amount_minor),
          currency: deposit.currency
        };
        if (decision === "reject") {
          await client.query(
            `UPDATE deposit_requests SET status='rejected', review_reason=$2, reviewed_by=$3,
             reviewed_at=NOW(), updated_at=NOW()
             WHERE id=$1 AND tenant_id=$4 AND store_id=$5`,
            [deposit.id, reason, user.id, store.tenant_id, store.id]
          );
          await notifyCustomer(client, {
            store,
            customerId: deposit.customer_id,
            type: "deposit_rejected",
            title: "تم رفض طلب شحن الرصيد",
            message: reason,
            referenceType: "deposit",
            referenceId: deposit.id
          });
        } else {
          const wallet = (await client.query(
            `SELECT * FROM customer_wallets
             WHERE customer_id=$1 AND tenant_id=$2 AND store_id=$3 FOR UPDATE`,
            [deposit.customer_id, store.tenant_id, store.id]
          )).rows[0];
          if (!wallet) throw new PaymentError(409, "wallet_not_found", "محفظة العميل غير موجودة");
          if (wallet.currency !== deposit.currency || deposit.currency !== store.currency) {
            throw new PaymentError(409, "deposit_currency_mismatch", "عملة طلب الشحن لا تطابق عملة المحفظة والمتجر");
          }
          const balanceAfter = Number(wallet.balance_minor) + Number(deposit.net_amount_minor);
          if (!Number.isSafeInteger(balanceAfter)) {
            throw new PaymentError(422, "invalid_balance", "تعذر تحديث الرصيد بأمان");
          }
          await client.query(
            `UPDATE customer_wallets SET balance_minor=$2, updated_at=NOW()
             WHERE customer_id=$1 AND tenant_id=$3 AND store_id=$4`,
            [deposit.customer_id, balanceAfter, store.tenant_id, store.id]
          );
          await client.query(
            `INSERT INTO wallet_ledger (
               id, tenant_id, store_id, customer_id, entry_type, amount_minor,
               balance_after_minor, currency, reference_type, reference_id, note
             ) VALUES ($1,$2,$3,$4,'deposit',$5,$6,$7,'deposit',$8,$9)`,
            [
              randomUUID(), store.tenant_id, store.id, deposit.customer_id,
              Number(deposit.net_amount_minor), balanceAfter, deposit.currency, deposit.id,
              "شحن رصيد معتمد من الإدارة"
            ]
          );
          await client.query(
            `UPDATE deposit_requests SET status='approved', review_reason=$2, reviewed_by=$3,
             reviewed_at=NOW(), updated_at=NOW()
             WHERE id=$1 AND tenant_id=$4 AND store_id=$5`,
            [deposit.id, reason, user.id, store.tenant_id, store.id]
          );
          await notifyCustomer(client, {
            store,
            customerId: deposit.customer_id,
            type: "deposit_approved",
            title: "تم قبول طلب شحن الرصيد",
            message: `تمت إضافة ${deposit.net_amount_minor} من أصغر وحدة عملة إلى محفظتك.`,
            referenceType: "deposit",
            referenceId: deposit.id
          });
        }
        await writeAudit(client, {
          store,
          actorUserId: user.id,
          action: decision === "approve" ? "deposit.approved" : "deposit.rejected",
          entityType: "deposit_request",
          entityId: deposit.id,
          ipAddress: request.ip,
          beforeData,
          afterData: { status: decision === "approve" ? "approved" : "rejected", reason }
        });
        await client.query(
          `INSERT INTO outbox_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1,$2,'deposit_request',$3,$4,$5)`,
          [
            randomUUID(), store.tenant_id, deposit.id,
            decision === "approve" ? "deposit.approved" : "deposit.rejected",
            JSON.stringify({ storeId: store.id, customerId: deposit.customer_id, depositId: deposit.id, reason })
          ]
        );
        return (await client.query(
          `SELECT d.*, pm.name AS method_name, pm.method_type,
                  c.email AS customer_email, c.display_name AS customer_name
           FROM deposit_requests d
           JOIN payment_methods pm ON pm.id=d.payment_method_id
           JOIN store_customers c ON c.id=d.customer_id
           WHERE d.id=$1 AND d.tenant_id=$2 AND d.store_id=$3`,
          [deposit.id, store.tenant_id, store.id]
        )).rows[0];
      }, store.tenant_id);
      return { deposit: depositDto(reviewed, { includeProof: true }) };
    })
  );
  return true;
}

export { calculateNet, parseProof };
