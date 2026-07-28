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
const CUSTOMER_SESSION_COOKIE = "uchiha_customer_session";
const PAYMENT_TYPES = new Set(["binance_pay", "usdt_trc20", "sham_cash", "bank_transfer", "manual"]);
const DEPOSIT_STATUSES = new Set(["pending", "approved", "rejected", "cancelled"]);
const PROOF_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PROOF_BYTES = 1_500_000;

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

function setCustomerCookie(reply, config, token, expiresAt) {
  reply.setCookie(CUSTOMER_SESSION_COOKIE, token, {
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
  const token = request.cookies[CUSTOMER_SESSION_COOKIE];
  if (!token) throw new PaymentError(401, "customer_authentication_required", "سجّل الدخول إلى حساب المتجر أولًا");
  const result = await db.query(
    `SELECT c.*, cs.csrf_hash, w.balance_minor, w.currency AS wallet_currency
     FROM customer_sessions cs
     JOIN store_customers c ON c.id = cs.customer_id
     JOIN customer_wallets w ON w.customer_id = c.id
     WHERE cs.token_hash = $1 AND cs.revoked_at IS NULL AND cs.expires_at > NOW()
       AND c.store_id = $2 AND c.status = 'active'`,
    [sha256(token), store.id]
  );
  const customer = result.rows[0];
  if (!customer) throw new PaymentError(401, "invalid_customer_session", "انتهت جلسة حساب المتجر");
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

function parseProof(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match || !PROOF_MIME.has(match[1])) {
    throw new PaymentError(422, "invalid_proof", "اختر صورة JPG أو PNG أو WEBP لإثبات التحويل");
  }
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length < 32 || bytes.length > MAX_PROOF_BYTES) {
    throw new PaymentError(422, "invalid_proof_size", "حجم صورة الإثبات يجب ألا يتجاوز 1.5 ميجابايت");
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

function validateOrderInputs(product, inputData) {
  const fields = Array.isArray(product.fields) ? product.fields : jsonValue(product.fields, []);
  const supplied = inputData && typeof inputData === "object" ? inputData : {};
  for (const field of fields) {
    const key = safeText(field.key || field.name, 80);
    if (!key) continue;
    const value = supplied[key];
    if (field.required && (value === undefined || value === null || String(value).trim() === "")) {
      throw new PaymentError(422, "missing_product_field", `الحقل ${field.label || key} مطلوب`, { key });
    }
  }
  return supplied;
}

export function installPaymentRoutes(app, { db, config }) {
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
      setCustomerCookie(reply, config, session.token, session.expiresAt);
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
         WHERE c.store_id = $1 AND c.email = $2 AND c.status = 'active'`,
        [store.id, email]
      );
      const customer = result.rows[0];
      if (!customer || !(await verifyPassword(String(request.body?.password || ""), customer.password_hash))) {
        throw new PaymentError(401, "invalid_credentials", "بيانات الدخول غير صحيحة");
      }
      const session = await issueCustomerSession(db, config, request, customer.id);
      setCustomerCookie(reply, config, session.token, session.expiresAt);
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
        sha256(request.cookies[CUSTOMER_SESSION_COOKIE])
      ]);
      reply.clearCookie(CUSTOMER_SESSION_COOKIE, { path: "/" });
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
        sha256(request.cookies[CUSTOMER_SESSION_COOKIE]),
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
        `SELECT * FROM payment_methods WHERE store_id = $1 AND status = 'active'
         ORDER BY sort_order, created_at`,
        [store.id]
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
        `SELECT * FROM wallet_ledger WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [customer.id]
      );
      const deposits = await db.query(
        `SELECT d.*, pm.name AS method_name, pm.method_type
         FROM deposit_requests d JOIN payment_methods pm ON pm.id = d.payment_method_id
         WHERE d.customer_id = $1 ORDER BY d.created_at DESC LIMIT 50`,
        [customer.id]
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
        deposits: deposits.rows.map((row) => depositDto(row))
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
        "SELECT * FROM payment_methods WHERE id = $1 AND store_id = $2 AND status = 'active'",
        [body.paymentMethodId, store.id]
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
      const idempotencyKey = requiredText(request.headers["idempotency-key"] || body.idempotencyKey, "مفتاح العملية", 160);
      const id = randomUUID();
      await db.query(
        `INSERT INTO deposit_requests (
           id, tenant_id, store_id, customer_id, payment_method_id,
           requested_amount_minor, commission_minor, net_amount_minor, currency,
           proof_data, proof_mime, reference_text, idempotency_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id, store.tenant_id, store.id, customer.id, method.id,
          amountMinor, commissionMinor, netAmountMinor, store.currency,
          proof.data, proof.mime, safeText(body.referenceText, 200) || null, idempotencyKey
        ]
      );
      const created = (await db.query(
        `SELECT d.*, pm.name AS method_name, pm.method_type
         FROM deposit_requests d JOIN payment_methods pm ON pm.id = d.payment_method_id WHERE d.id = $1`,
        [id]
      )).rows[0];
      reply.code(201);
      return { deposit: depositDto(created) };
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
      const idempotencyKey = requiredText(request.headers["idempotency-key"] || request.body?.idempotencyKey, "مفتاح العملية", 160);
      const orderId = randomUUID();
      const orderNumber = `WB-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 5).toUpperCase()}`;
      const created = await db.transaction(async (client) => {
        const existing = await client.query(
          "SELECT * FROM orders WHERE tenant_id = $1 AND idempotency_key = $2",
          [store.tenant_id, idempotencyKey]
        );
        if (existing.rows[0]) return existing.rows[0];

        let totalMinor = 0;
        const prepared = [];
        for (const item of items) {
          const product = (await client.query(
            `SELECT * FROM products WHERE id = $1 AND store_id = $2 AND status = 'active' FOR UPDATE`,
            [item.productId, store.id]
          )).rows[0];
          if (!product) throw new PaymentError(404, "product_not_found", "أحد المنتجات غير متاح");
          const quantity = integer(item.quantity ?? 1, {
            minimum: Number(product.min_quantity),
            maximum: product.max_quantity === null ? 100_000 : Number(product.max_quantity),
            field: "الكمية"
          });
          if (product.stock_quantity !== null && quantity > Number(product.stock_quantity)) {
            throw new PaymentError(409, "insufficient_stock", `الكمية غير متوفرة للمنتج ${product.name}`);
          }
          const inputData = validateOrderInputs(product, item.inputData);
          const lineTotal = Number(product.price_minor) * quantity;
          totalMinor += lineTotal;
          prepared.push({ product, quantity, inputData, lineTotal });
        }

        const wallet = (await client.query(
          "SELECT * FROM customer_wallets WHERE customer_id = $1 FOR UPDATE",
          [customer.id]
        )).rows[0];
        if (!wallet || Number(wallet.balance_minor) < totalMinor) {
          throw new PaymentError(409, "insufficient_balance", "رصيد الحساب غير كافٍ لإتمام الشراء", {
            balanceMinor: Number(wallet?.balance_minor || 0),
            requiredMinor: totalMinor
          });
        }
        const balanceAfter = Number(wallet.balance_minor) - totalMinor;
        await client.query(
          `INSERT INTO orders (
             id, tenant_id, store_id, order_number, customer_name, customer_email,
             channel, status, payment_status, total_minor, currency, idempotency_key
           ) VALUES ($1,$2,$3,$4,$5,$6,'web','processing','paid',$7,$8,$9)`,
          [orderId, store.tenant_id, store.id, orderNumber, customer.display_name, customer.email, totalMinor, store.currency, idempotencyKey]
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
            await client.query(
              "UPDATE products SET stock_quantity = stock_quantity - $2, updated_at = NOW() WHERE id = $1",
              [line.product.id, line.quantity]
            );
          }
        }
        await client.query(
          "UPDATE customer_wallets SET balance_minor = $2, updated_at = NOW() WHERE customer_id = $1",
          [customer.id, balanceAfter]
        );
        await client.query(
          `INSERT INTO wallet_ledger (
             id, tenant_id, store_id, customer_id, entry_type, amount_minor,
             balance_after_minor, currency, reference_type, reference_id, note
           ) VALUES ($1,$2,$3,$4,'purchase',$5,$6,$7,'order',$8,$9)`,
          [randomUUID(), store.tenant_id, store.id, customer.id, -totalMinor, balanceAfter, store.currency, orderId, `شراء الطلب ${orderNumber}`]
        );
        return { id: orderId, order_number: orderNumber, total_minor: totalMinor, currency: store.currency, status: "processing", payment_status: "paid" };
      }, store.tenant_id);
      reply.code(201);
      return {
        order: {
          id: created.id,
          orderNumber: created.order_number,
          totalMinor: Number(created.total_minor),
          currency: created.currency,
          status: created.status,
          paymentStatus: created.payment_status
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
        "SELECT * FROM payment_methods WHERE store_id = $1 ORDER BY sort_order, created_at",
        [store.id]
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
        "SELECT * FROM payment_methods WHERE id = $1 AND store_id = $2",
        [request.params.methodId, store.id]
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
      const values = [store.id];
      let filter = "";
      if (status !== "all") {
        values.push(status);
        filter = "AND d.status = $2";
      }
      const result = await db.query(
        `SELECT d.*, pm.name AS method_name, pm.method_type,
                c.email AS customer_email, c.display_name AS customer_name
         FROM deposit_requests d
         JOIN payment_methods pm ON pm.id = d.payment_method_id
         JOIN store_customers c ON c.id = d.customer_id
         WHERE d.store_id = $1 ${filter}
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
      const reviewed = await db.transaction(async (client) => {
        const deposit = (await client.query(
          `SELECT * FROM deposit_requests WHERE id = $1 AND store_id = $2 FOR UPDATE`,
          [request.params.depositId, store.id]
        )).rows[0];
        if (!deposit) throw new PaymentError(404, "deposit_not_found", "طلب الشحن غير موجود");
        if (deposit.status !== "pending") {
          throw new PaymentError(409, "deposit_already_reviewed", "تمت مراجعة هذا الطلب مسبقًا");
        }
        if (decision === "reject") {
          await client.query(
            `UPDATE deposit_requests SET status='rejected', review_reason=$2, reviewed_by=$3,
             reviewed_at=NOW(), updated_at=NOW() WHERE id=$1`,
            [deposit.id, reason || "تم رفض إثبات التحويل", user.id]
          );
        } else {
          const wallet = (await client.query(
            "SELECT * FROM customer_wallets WHERE customer_id = $1 FOR UPDATE",
            [deposit.customer_id]
          )).rows[0];
          if (!wallet) throw new PaymentError(409, "wallet_not_found", "محفظة العميل غير موجودة");
          const balanceAfter = Number(wallet.balance_minor) + Number(deposit.net_amount_minor);
          await client.query(
            "UPDATE customer_wallets SET balance_minor=$2, updated_at=NOW() WHERE customer_id=$1",
            [deposit.customer_id, balanceAfter]
          );
          await client.query(
            `INSERT INTO wallet_ledger (
               id, tenant_id, store_id, customer_id, entry_type, amount_minor,
               balance_after_minor, currency, reference_type, reference_id, note
             ) VALUES ($1,$2,$3,$4,'deposit',$5,$6,$7,'deposit',$8,$9)`,
            [
              randomUUID(), deposit.tenant_id, deposit.store_id, deposit.customer_id,
              Number(deposit.net_amount_minor), balanceAfter, deposit.currency, deposit.id,
              "شحن رصيد معتمد من الإدارة"
            ]
          );
          await client.query(
            `UPDATE deposit_requests SET status='approved', review_reason=$2, reviewed_by=$3,
             reviewed_at=NOW(), updated_at=NOW() WHERE id=$1`,
            [deposit.id, reason, user.id]
          );
        }
        return (await client.query(
          `SELECT d.*, pm.name AS method_name, pm.method_type,
                  c.email AS customer_email, c.display_name AS customer_name
           FROM deposit_requests d
           JOIN payment_methods pm ON pm.id=d.payment_method_id
           JOIN store_customers c ON c.id=d.customer_id
           WHERE d.id=$1`,
          [deposit.id]
        )).rows[0];
      }, store.tenant_id);
      return { deposit: depositDto(reviewed, { includeProof: true }) };
    })
  );
}

export { calculateNet, parseProof };
