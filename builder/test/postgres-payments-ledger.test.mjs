import test from "node:test";
import assert from "node:assert/strict";
import {
  createOwner,
  createPostgresHarness,
  createStore,
  postgresAvailable,
  proofImage,
  registerCustomer
} from "./postgres-helpers.mjs";

const options = postgresAvailable() ? {} : { skip: "TEST_DATABASE_URL is not configured" };

test("PostgreSQL 2/4: deposit fees, approval/rejection and ledger idempotency", options, async (context) => {
  const { app, db } = await createPostgresHarness(context);
  const owner = await createOwner(app);
  const store = await createStore(db, owner.id, { slug: "postgres-payments" });
  const customer = await registerCustomer(app, store.slug);

  const methods = await app.inject({ method: "GET", url: `/api/public/stores/${store.slug}/payment-methods` });
  assert.equal(methods.statusCode, 200, methods.body);
  const method = methods.json().methods[0];

  const request = {
    method: "POST",
    url: `/api/public/stores/${store.slug}/deposits`,
    headers: {
      cookie: customer.cookie,
      "x-customer-csrf-token": customer.csrfToken,
      "idempotency-key": "postgres-deposit-approve"
    },
    payload: { paymentMethodId: method.id, amountMinor: 10_000, proofDataUrl: proofImage }
  };
  const created = await app.inject(request);
  assert.equal(created.statusCode, 201, created.body);
  const deposit = created.json().deposit;
  assert.equal(deposit.requestedAmountMinor, 10_000);
  assert.equal(deposit.commissionMinor, 200);
  assert.equal(deposit.netAmountMinor, 9800);
  assert.equal(deposit.status, "pending");

  const duplicate = await app.inject(request);
  assert.equal(duplicate.statusCode, 200, duplicate.body);
  assert.equal(duplicate.json().duplicate, true);
  assert.equal(duplicate.json().deposit.id, deposit.id);

  const approve = await app.inject({
    method: "POST",
    url: `/api/stores/${store.storeId}/deposits/${deposit.id}/review`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: { decision: "approve" }
  });
  assert.equal(approve.statusCode, 200, approve.body);

  const secondApproval = await app.inject({
    method: "POST",
    url: `/api/stores/${store.storeId}/deposits/${deposit.id}/review`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: { decision: "approve" }
  });
  assert.equal(secondApproval.statusCode, 409, secondApproval.body);

  const rejected = await app.inject({
    ...request,
    headers: { ...request.headers, "idempotency-key": "postgres-deposit-reject" },
    payload: { paymentMethodId: method.id, amountMinor: 5000, proofDataUrl: proofImage }
  });
  assert.equal(rejected.statusCode, 201, rejected.body);
  const rejection = await app.inject({
    method: "POST",
    url: `/api/stores/${store.storeId}/deposits/${rejected.json().deposit.id}/review`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: { decision: "reject", reason: "الإثبات غير واضح" }
  });
  assert.equal(rejection.statusCode, 200, rejection.body);
  assert.equal(rejection.json().deposit.status, "rejected");

  const wallet = await app.inject({
    method: "GET",
    url: `/api/public/stores/${store.slug}/wallet`,
    headers: { cookie: customer.cookie }
  });
  assert.equal(wallet.statusCode, 200, wallet.body);
  assert.equal(wallet.json().wallet.balanceMinor, 9800);
  assert.equal(wallet.json().ledger.length, 1);
  assert.equal(wallet.json().ledger[0].amountMinor, 9800);
  assert.equal(wallet.json().ledger[0].balanceAfterMinor, 9800);

  const persisted = await db.query(
    `SELECT balance_minor FROM customer_wallets WHERE tenant_id=$1 AND store_id=$2 AND customer_id=$3`,
    [store.tenantId, store.storeId, customer.customer.id]
  );
  assert.equal(Number(persisted.rows[0].balance_minor), 9800);
  const ledger = await db.query(
    `SELECT operation_type,balance_before_minor,balance_after_minor FROM wallet_ledger
     WHERE tenant_id=$1 AND store_id=$2 AND customer_id=$3`,
    [store.tenantId, store.storeId, customer.customer.id]
  );
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.rows[0].operation_type, "deposit");
  assert.equal(Number(ledger.rows[0].balance_before_minor), 0);
  assert.equal(Number(ledger.rows[0].balance_after_minor), 9800);
});
