import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.mjs";
import { createDatabase } from "../src/db.mjs";
import { buildApp } from "../src/app.mjs";
import { installPaymentRoutes } from "../src/payments.mjs";
import { seedEnvironment } from "../src/seed.mjs";

const proof = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0iwAAAAASUVORK5CYII=";

function cookieHeader(response) {
  const raw = response.headers["set-cookie"];
  assert.ok(raw);
  return raw.split(";")[0];
}

async function harness(context) {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_MODE: "memory",
    ALLOW_DEMO_BILLING: "true",
    TELEGRAM_MODE: "fake",
    APP_BASE_URL: "http://builder.test",
    STORE_BASE_DOMAIN: "uchiha.store",
    COOKIE_SECURE: "false"
  });
  config.offerSeed = {
    name: "UCHIHA Full Test",
    priceMinor: 1000,
    renewalPriceMinor: 1000,
    currency: "USD",
    durationUnit: "month",
    durationCount: 1,
    trialDays: 0
  };
  const db = await createDatabase(config);
  await seedEnvironment(db, config);
  const app = await buildApp({ db, config, logger: false, startWorkers: false });
  assert.equal(installPaymentRoutes(app, { db, config }), false, "payment routes must only register once");
  await app.ready();
  context.after(async () => {
    await app.close();
    await db.close();
  });
  return { app, db, config };
}

async function createOwner(app, email = "owner-wallet@example.com") {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { displayName: "مالك المتجر", email, password: "owner-wallet-password" }
  });
  assert.equal(response.statusCode, 201, response.body);
  const body = response.json();
  return { id: body.user.id, csrf: body.csrfToken, cookie: cookieHeader(response) };
}

async function createStore(db, ownerId, { slug = "wallet-store", currency = "USD", name = "متجر المحفظة" } = {}) {
  const tenantId = randomUUID();
  const storeId = randomUUID();
  await db.query("INSERT INTO tenants (id,slug,name,status) VALUES ($1,$2,$3,'active')", [tenantId, `${slug}-tenant`, `${name} Tenant`]);
  await db.query(
    `INSERT INTO stores (id,tenant_id,name,slug,activity_type,country,language,currency,template_key,status)
     VALUES ($1,$2,$3,$4,'digital','Türkiye','ar',$5,'modern-dark','active')`,
    [storeId, tenantId, name, slug, currency]
  );
  await db.query(
    "INSERT INTO tenant_memberships (tenant_id,user_id,role_key,status) VALUES ($1,$2,'owner','active')",
    [tenantId, ownerId]
  );
  return { tenantId, storeId, slug, currency };
}

async function registerCustomer(app, slug, email = "buyer@example.com") {
  const response = await app.inject({
    method: "POST",
    url: `/api/public/stores/${slug}/customers/register`,
    payload: { displayName: "عميل تجريبي", email, password: "buyer-wallet-password", phone: "+905550000000" }
  });
  assert.equal(response.statusCode, 201, response.body);
  return { ...response.json(), cookie: cookieHeader(response) };
}

test("customer accounts and cookies stay isolated between stores", async (context) => {
  const { app, db } = await harness(context);
  const owner = await createOwner(app, "owner-isolation@example.com");
  const storeA = await createStore(db, owner.id, { slug: "wallet-a", name: "Wallet A" });
  const storeB = await createStore(db, owner.id, { slug: "wallet-b", name: "Wallet B" });

  const customerA = await registerCustomer(app, storeA.slug, "same@example.com");
  const customerB = await registerCustomer(app, storeB.slug, "same@example.com");
  assert.notEqual(customerA.customer.id, customerB.customer.id);
  assert.notEqual(customerA.cookie.split("=")[0], customerB.cookie.split("=")[0]);

  const crossStore = await app.inject({
    method: "GET",
    url: `/api/public/stores/${storeB.slug}/wallet`,
    headers: { cookie: customerA.cookie }
  });
  assert.equal(crossStore.statusCode, 401, crossStore.body);
});

test("deposit review and wallet purchase are atomic, validated and idempotent", async (context) => {
  const { app, db } = await harness(context);
  const owner = await createOwner(app);
  const store = await createStore(db, owner.id);
  const customer = await registerCustomer(app, store.slug);

  const methodsResponse = await app.inject({ method: "GET", url: `/api/public/stores/${store.slug}/payment-methods` });
  assert.equal(methodsResponse.statusCode, 200, methodsResponse.body);
  assert.equal(methodsResponse.json().methods.length, 3);
  const method = methodsResponse.json().methods[0];

  const depositRequest = {
    method: "POST",
    url: `/api/public/stores/${store.slug}/deposits`,
    headers: { cookie: customer.cookie, "x-customer-csrf-token": customer.csrfToken, "idempotency-key": "deposit-1" },
    payload: { paymentMethodId: method.id, amountMinor: 10_000, proofDataUrl: proof, referenceText: "TX-100" }
  };
  const deposit = await app.inject(depositRequest);
  assert.equal(deposit.statusCode, 201, deposit.body);
  assert.equal(deposit.json().duplicate, false);
  assert.equal(deposit.json().deposit.status, "pending");
  assert.equal(deposit.json().deposit.netAmountMinor, 9800);
  const depositId = deposit.json().deposit.id;

  const repeatedDeposit = await app.inject(depositRequest);
  assert.equal(repeatedDeposit.statusCode, 200, repeatedDeposit.body);
  assert.equal(repeatedDeposit.json().duplicate, true);
  assert.equal(repeatedDeposit.json().deposit.id, depositId);

  const changedDeposit = await app.inject({
    ...depositRequest,
    payload: { ...depositRequest.payload, amountMinor: 20_000 }
  });
  assert.equal(changedDeposit.statusCode, 409, changedDeposit.body);
  assert.equal(changedDeposit.json().error, "idempotency_mismatch");

  const pending = await app.inject({
    method: "GET",
    url: `/api/stores/${store.storeId}/deposits?status=pending`,
    headers: { cookie: owner.cookie }
  });
  assert.equal(pending.statusCode, 200, pending.body);
  assert.equal(pending.json().deposits.length, 1);
  assert.match(pending.json().deposits[0].proof.data, /^data:image\/png;base64,/);

  const rejectWithoutReason = await app.inject({
    method: "POST",
    url: `/api/stores/${store.storeId}/deposits/${depositId}/review`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: { decision: "reject" }
  });
  assert.equal(rejectWithoutReason.statusCode, 422, rejectWithoutReason.body);

  const approve = await app.inject({
    method: "POST",
    url: `/api/stores/${store.storeId}/deposits/${depositId}/review`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: { decision: "approve" }
  });
  assert.equal(approve.statusCode, 200, approve.body);
  assert.equal(approve.json().deposit.status, "approved");

  const duplicateApprove = await app.inject({
    method: "POST",
    url: `/api/stores/${store.storeId}/deposits/${depositId}/review`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: { decision: "approve" }
  });
  assert.equal(duplicateApprove.statusCode, 409, duplicateApprove.body);

  const productId = randomUUID();
  await db.query(
    `INSERT INTO products (
       id,tenant_id,store_id,product_type,name,slug,description,price_minor,currency,stock_quantity,
       min_quantity,max_quantity,delivery_mode,fields,options,status
     ) VALUES ($1,$2,$3,'game_topup','شحن لعبة','game-topup','',2500,'USD',3,1,3,'manual',$4,'[]','active')`,
    [
      productId,
      store.tenantId,
      store.storeId,
      JSON.stringify([
        { key: "playerId", label: "ID اللاعب", required: true, type: "text", maxLength: 32 },
        { key: "server", label: "السيرفر", required: true, type: "select", options: ["EU", "ME"] }
      ])
    ]
  );

  const missingField = await app.inject({
    method: "POST",
    url: `/api/public/stores/${store.slug}/orders/wallet`,
    headers: { cookie: customer.cookie, "x-customer-csrf-token": customer.csrfToken, "idempotency-key": "order-missing" },
    payload: { items: [{ productId, quantity: 1, inputData: {} }] }
  });
  assert.equal(missingField.statusCode, 422, missingField.body);

  const invalidOption = await app.inject({
    method: "POST",
    url: `/api/public/stores/${store.slug}/orders/wallet`,
    headers: { cookie: customer.cookie, "x-customer-csrf-token": customer.csrfToken, "idempotency-key": "order-option" },
    payload: { items: [{ productId, quantity: 1, inputData: { playerId: "123", server: "INVALID" } }] }
  });
  assert.equal(invalidOption.statusCode, 422, invalidOption.body);

  const invalidQuantity = await app.inject({
    method: "POST",
    url: `/api/public/stores/${store.slug}/orders/wallet`,
    headers: { cookie: customer.cookie, "x-customer-csrf-token": customer.csrfToken, "idempotency-key": "order-quantity" },
    payload: { items: [{ productId, quantity: 4, inputData: { playerId: "123", server: "EU" } }] }
  });
  assert.equal(invalidQuantity.statusCode, 422, invalidQuantity.body);

  const wrongCurrencyId = randomUUID();
  await db.query(
    `INSERT INTO products (
       id,tenant_id,store_id,product_type,name,slug,description,price_minor,currency,
       min_quantity,max_quantity,delivery_mode,fields,options,status
     ) VALUES ($1,$2,$3,'digital','عملة خاطئة','wrong-currency','',100,'EUR',1,1,'manual','[]','[]','active')`,
    [wrongCurrencyId, store.tenantId, store.storeId]
  );
  const wrongCurrency = await app.inject({
    method: "POST",
    url: `/api/public/stores/${store.slug}/orders/wallet`,
    headers: { cookie: customer.cookie, "x-customer-csrf-token": customer.csrfToken, "idempotency-key": "order-currency" },
    payload: { items: [{ productId: wrongCurrencyId, quantity: 1, inputData: {} }] }
  });
  assert.equal(wrongCurrency.statusCode, 409, wrongCurrency.body);
  assert.equal(wrongCurrency.json().error, "product_currency_mismatch");

  const orderRequest = {
    method: "POST",
    url: `/api/public/stores/${store.slug}/orders/wallet`,
    headers: { cookie: customer.cookie, "x-customer-csrf-token": customer.csrfToken, "idempotency-key": "order-1" },
    payload: { items: [{ productId, quantity: 2, inputData: { playerId: "123456", server: "ME", ignored: "drop-me" } }] }
  };
  const order = await app.inject(orderRequest);
  assert.equal(order.statusCode, 201, order.body);
  assert.equal(order.json().duplicate, false);
  assert.equal(order.json().order.totalMinor, 5000);
  assert.equal(order.json().order.paymentStatus, "paid");

  const repeatedOrder = await app.inject(orderRequest);
  assert.equal(repeatedOrder.statusCode, 200, repeatedOrder.body);
  assert.equal(repeatedOrder.json().duplicate, true);
  assert.equal(repeatedOrder.json().order.id, order.json().order.id);

  const changedOrder = await app.inject({
    ...orderRequest,
    payload: { items: [{ productId, quantity: 1, inputData: { playerId: "123456", server: "ME" } }] }
  });
  assert.equal(changedOrder.statusCode, 409, changedOrder.body);
  assert.equal(changedOrder.json().error, "idempotency_mismatch");

  const wallet = await app.inject({
    method: "GET",
    url: `/api/public/stores/${store.slug}/wallet`,
    headers: { cookie: customer.cookie }
  });
  assert.equal(wallet.statusCode, 200, wallet.body);
  assert.equal(wallet.json().wallet.balanceMinor, 4800);
  assert.equal(wallet.json().ledger.length, 2);
  assert.ok(wallet.json().notifications.some((entry) => entry.type === "deposit_approved"));
  assert.ok(wallet.json().notifications.some((entry) => entry.type === "order_paid"));

  const stock = await db.query("SELECT stock_quantity FROM products WHERE id=$1", [productId]);
  assert.equal(Number(stock.rows[0].stock_quantity), 1);
  const orderItems = await db.query("SELECT input_data FROM order_items WHERE order_id=$1", [order.json().order.id]);
  const storedInput = typeof orderItems.rows[0].input_data === "string" ? JSON.parse(orderItems.rows[0].input_data) : orderItems.rows[0].input_data;
  assert.deepEqual(storedInput, { playerId: "123456", server: "ME" });

  const financialAudit = await db.query(
    "SELECT action FROM audit_logs WHERE tenant_id=$1 AND action IN ('deposit.submitted','deposit.approved','wallet.purchase') ORDER BY created_at",
    [store.tenantId]
  );
  assert.deepEqual(new Set(financialAudit.rows.map((row) => row.action)), new Set(["deposit.submitted", "deposit.approved", "wallet.purchase"]));
});

test("store owner can manage payment methods, customers, balances, orders and audit safely", async (context) => {
  const { app, db } = await harness(context);
  const owner = await createOwner(app, "owner-admin@example.com");
  const store = await createStore(db, owner.id, { slug: "financial-admin", name: "Financial Admin" });
  const customer = await registerCustomer(app, store.slug, "managed@example.com");

  const invalidLimits = await app.inject({
    method: "POST",
    url: `/api/stores/${store.storeId}/payment-methods`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: { name: "Invalid", type: "manual", minimumAmountMinor: 1000, maximumAmountMinor: 500 }
  });
  assert.equal(invalidLimits.statusCode, 422, invalidLimits.body);

  const methodResponse = await app.inject({
    method: "POST",
    url: `/api/stores/${store.storeId}/payment-methods`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: {
      name: "Manual Verified",
      type: "manual",
      instructions: "حوّل ثم ارفع الإثبات",
      destination: { account: "DEMO-ONLY" },
      commissionBps: 150,
      fixedFeeMinor: 25,
      minimumAmountMinor: 100,
      maximumAmountMinor: 50_000,
      sortOrder: 7,
      status: "active"
    }
  });
  assert.equal(methodResponse.statusCode, 201, methodResponse.body);
  const methodId = methodResponse.json().method.id;

  const disabledMethod = await app.inject({
    method: "PUT",
    url: `/api/stores/${store.storeId}/payment-methods/${methodId}`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: { status: "disabled", sortOrder: 9 }
  });
  assert.equal(disabledMethod.statusCode, 200, disabledMethod.body);
  assert.equal(disabledMethod.json().method.status, "disabled");

  const customers = await app.inject({
    method: "GET",
    url: `/api/stores/${store.storeId}/customers?query=managed&status=active`,
    headers: { cookie: owner.cookie }
  });
  assert.equal(customers.statusCode, 200, customers.body);
  assert.equal(customers.json().customers.length, 1);
  assert.equal(customers.json().customers[0].id, customer.customer.id);

  const adjustmentRequest = {
    method: "POST",
    url: `/api/stores/${store.storeId}/customers/${customer.customer.id}/wallet-adjustments`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf, "idempotency-key": "admin-adjustment-1" },
    payload: { amountMinor: 12_000, reason: "رصيد تجريبي لاختبار الإدارة" }
  };
  const adjustment = await app.inject(adjustmentRequest);
  assert.equal(adjustment.statusCode, 201, adjustment.body);
  assert.equal(adjustment.json().adjustment.balanceAfterMinor, 12_000);

  const repeatedAdjustment = await app.inject(adjustmentRequest);
  assert.equal(repeatedAdjustment.statusCode, 200, repeatedAdjustment.body);
  assert.equal(repeatedAdjustment.json().duplicate, true);
  assert.equal(repeatedAdjustment.json().adjustment.id, adjustment.json().adjustment.id);

  const changedAdjustment = await app.inject({ ...adjustmentRequest, payload: { amountMinor: 11_000, reason: adjustmentRequest.payload.reason } });
  assert.equal(changedAdjustment.statusCode, 409, changedAdjustment.body);
  assert.equal(changedAdjustment.json().error, "idempotency_mismatch");

  const overdraw = await app.inject({
    method: "POST",
    url: `/api/stores/${store.storeId}/customers/${customer.customer.id}/wallet-adjustments`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf, "idempotency-key": "admin-adjustment-overdraw" },
    payload: { amountMinor: -20_000, reason: "يجب رفض الرصيد السالب" }
  });
  assert.equal(overdraw.statusCode, 409, overdraw.body);

  const wallet = await db.query("SELECT balance_minor FROM customer_wallets WHERE customer_id=$1", [customer.customer.id]);
  assert.equal(Number(wallet.rows[0].balance_minor), 12_000);
  const adjustments = await db.query("SELECT * FROM wallet_ledger WHERE customer_id=$1 AND entry_type='adjustment'", [customer.customer.id]);
  assert.equal(adjustments.rows.length, 1);

  const productId = randomUUID();
  await db.query(
    `INSERT INTO products (
       id,tenant_id,store_id,product_type,name,slug,description,price_minor,currency,stock_quantity,
       min_quantity,max_quantity,delivery_mode,fields,options,status
     ) VALUES ($1,$2,$3,'digital','منتج إداري','admin-product','',3000,'USD',5,1,5,'manual','[]','[]','active')`,
    [productId, store.tenantId, store.storeId]
  );
  const order = await app.inject({
    method: "POST",
    url: `/api/public/stores/${store.slug}/orders/wallet`,
    headers: { cookie: customer.cookie, "x-customer-csrf-token": customer.csrfToken, "idempotency-key": "admin-order-1" },
    payload: { items: [{ productId, quantity: 1, inputData: {} }] }
  });
  assert.equal(order.statusCode, 201, order.body);

  const orders = await app.inject({
    method: "GET",
    url: `/api/stores/${store.storeId}/orders?query=${encodeURIComponent(order.json().order.orderNumber)}`,
    headers: { cookie: owner.cookie }
  });
  assert.equal(orders.statusCode, 200, orders.body);
  assert.equal(orders.json().orders.length, 1);
  assert.equal(orders.json().orders[0].paymentSource, "wallet");

  const completed = await app.inject({
    method: "PUT",
    url: `/api/stores/${store.storeId}/orders/${order.json().order.id}/status`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: { status: "completed" }
  });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal(completed.json().order.status, "completed");

  const unsafeCancellation = await app.inject({
    method: "PUT",
    url: `/api/stores/${store.storeId}/orders/${order.json().order.id}/status`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: { status: "cancelled" }
  });
  assert.equal(unsafeCancellation.statusCode, 422, unsafeCancellation.body);
  assert.equal(unsafeCancellation.json().error, "unsafe_order_status");

  const notifications = await app.inject({
    method: "GET",
    url: `/api/stores/${store.storeId}/admin-notifications`,
    headers: { cookie: owner.cookie }
  });
  assert.equal(notifications.statusCode, 200, notifications.body);
  assert.ok(notifications.json().notifications.some((entry) => entry.type === "customer_registered"));
  assert.ok(notifications.json().notifications.some((entry) => entry.type === "wallet_adjusted"));
  assert.ok(notifications.json().notifications.some((entry) => entry.type === "order_paid"));

  const audit = await app.inject({
    method: "GET",
    url: `/api/stores/${store.storeId}/audit-logs?limit=100`,
    headers: { cookie: owner.cookie }
  });
  assert.equal(audit.statusCode, 200, audit.body);
  const actions = new Set(audit.json().logs.map((entry) => entry.action));
  assert.ok(actions.has("payment_method.created"));
  assert.ok(actions.has("payment_method.updated"));
  assert.ok(actions.has("wallet.adjustment"));
  assert.ok(actions.has("order.status_updated"));

  const blocked = await app.inject({
    method: "PUT",
    url: `/api/stores/${store.storeId}/customers/${customer.customer.id}`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: { status: "blocked" }
  });
  assert.equal(blocked.statusCode, 200, blocked.body);
  assert.equal(blocked.json().customer.status, "blocked");

  const revokedSession = await app.inject({
    method: "GET",
    url: `/api/public/stores/${store.slug}/wallet`,
    headers: { cookie: customer.cookie }
  });
  assert.equal(revokedSession.statusCode, 401, revokedSession.body);
});
