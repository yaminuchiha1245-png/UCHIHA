import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.mjs";
import { createDatabase } from "../src/db.mjs";
import { buildApp } from "../src/app.mjs";
import { installPaymentRoutes } from "../src/payments.mjs";
import { seedEnvironment } from "../src/seed.mjs";

function cookieHeader(response) {
  const raw = response.headers["set-cookie"];
  assert.ok(raw);
  return raw.split(";")[0];
}

const proof = "data:image/png;base64," + Buffer.alloc(64, 7).toString("base64");

test("wallet deposit review and wallet purchase are atomic", async (context) => {
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
  installPaymentRoutes(app, { db, config });
  await app.ready();
  context.after(async () => {
    await app.close();
    await db.close();
  });

  const ownerRegister = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { displayName: "مالك المتجر", email: "owner-wallet@example.com", password: "owner-wallet-password" }
  });
  assert.equal(ownerRegister.statusCode, 201, ownerRegister.body);
  const ownerCookie = cookieHeader(ownerRegister);
  const owner = ownerRegister.json();
  const ownerId = owner.user.id;
  const ownerCsrf = owner.csrfToken;

  const tenantId = randomUUID();
  const storeId = randomUUID();
  await db.query("INSERT INTO tenants (id,slug,name,status) VALUES ($1,$2,$3,'active')", [tenantId, "wallet-tenant", "Wallet Tenant"]);
  await db.query(
    `INSERT INTO stores (id,tenant_id,name,slug,activity_type,country,language,currency,template_key,status)
     VALUES ($1,$2,$3,$4,'digital','Türkiye','ar','USD','modern-dark','active')`,
    [storeId, tenantId, "متجر المحفظة", "wallet-store"]
  );
  await db.query("INSERT INTO tenant_memberships (tenant_id,user_id,role_key,status) VALUES ($1,$2,'owner','active')", [tenantId, ownerId]);

  const customerRegister = await app.inject({
    method: "POST",
    url: "/api/public/stores/wallet-store/customers/register",
    payload: { displayName: "عميل تجريبي", email: "buyer@example.com", password: "buyer-wallet-password", phone: "+905550000000" }
  });
  assert.equal(customerRegister.statusCode, 201, customerRegister.body);
  const customerCookie = cookieHeader(customerRegister);
  const customerCsrf = customerRegister.json().csrfToken;

  const methodsResponse = await app.inject({ method: "GET", url: "/api/public/stores/wallet-store/payment-methods" });
  assert.equal(methodsResponse.statusCode, 200, methodsResponse.body);
  assert.equal(methodsResponse.json().methods.length, 3);
  const method = methodsResponse.json().methods[0];

  const deposit = await app.inject({
    method: "POST",
    url: "/api/public/stores/wallet-store/deposits",
    headers: { cookie: customerCookie, "x-customer-csrf-token": customerCsrf, "idempotency-key": "deposit-1" },
    payload: { paymentMethodId: method.id, amountMinor: 10_000, proofDataUrl: proof, referenceText: "TX-100" }
  });
  assert.equal(deposit.statusCode, 201, deposit.body);
  assert.equal(deposit.json().deposit.status, "pending");
  assert.equal(deposit.json().deposit.netAmountMinor, 9800);
  const depositId = deposit.json().deposit.id;

  const pending = await app.inject({
    method: "GET",
    url: `/api/stores/${storeId}/deposits?status=pending`,
    headers: { cookie: ownerCookie }
  });
  assert.equal(pending.statusCode, 200, pending.body);
  assert.equal(pending.json().deposits.length, 1);
  assert.match(pending.json().deposits[0].proof.data, /^data:image\/png;base64,/);

  const approve = await app.inject({
    method: "POST",
    url: `/api/stores/${storeId}/deposits/${depositId}/review`,
    headers: { cookie: ownerCookie, "x-csrf-token": ownerCsrf },
    payload: { decision: "approve" }
  });
  assert.equal(approve.statusCode, 200, approve.body);
  assert.equal(approve.json().deposit.status, "approved");

  const duplicateApprove = await app.inject({
    method: "POST",
    url: `/api/stores/${storeId}/deposits/${depositId}/review`,
    headers: { cookie: ownerCookie, "x-csrf-token": ownerCsrf },
    payload: { decision: "approve" }
  });
  assert.equal(duplicateApprove.statusCode, 409, duplicateApprove.body);

  const productId = randomUUID();
  await db.query(
    `INSERT INTO products (
       id,tenant_id,store_id,product_type,name,slug,description,price_minor,currency,
       min_quantity,max_quantity,delivery_mode,fields,options,status
     ) VALUES ($1,$2,$3,'game_topup','شحن لعبة','game-topup','',2500,'USD',1,5,'manual',$4,'[]','active')`,
    [productId, tenantId, storeId, JSON.stringify([{ key: "playerId", label: "ID اللاعب", required: true, type: "text" }])]
  );

  const missingField = await app.inject({
    method: "POST",
    url: "/api/public/stores/wallet-store/orders/wallet",
    headers: { cookie: customerCookie, "x-customer-csrf-token": customerCsrf, "idempotency-key": "order-missing" },
    payload: { items: [{ productId, quantity: 1, inputData: {} }] }
  });
  assert.equal(missingField.statusCode, 422, missingField.body);

  const order = await app.inject({
    method: "POST",
    url: "/api/public/stores/wallet-store/orders/wallet",
    headers: { cookie: customerCookie, "x-customer-csrf-token": customerCsrf, "idempotency-key": "order-1" },
    payload: { items: [{ productId, quantity: 2, inputData: { playerId: "123456" } }] }
  });
  assert.equal(order.statusCode, 201, order.body);
  assert.equal(order.json().order.totalMinor, 5000);
  assert.equal(order.json().order.paymentStatus, "paid");

  const wallet = await app.inject({
    method: "GET",
    url: "/api/public/stores/wallet-store/wallet",
    headers: { cookie: customerCookie }
  });
  assert.equal(wallet.statusCode, 200, wallet.body);
  assert.equal(wallet.json().wallet.balanceMinor, 4800);
  assert.equal(wallet.json().ledger.length, 2);
});
