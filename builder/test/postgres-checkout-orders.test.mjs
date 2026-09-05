import test from "node:test";
import assert from "node:assert/strict";
import {
  addProduct,
  createOwner,
  createPostgresHarness,
  createStore,
  postgresAvailable,
  registerCustomer
} from "./postgres-helpers.mjs";

const options = postgresAvailable() ? {} : { skip: "TEST_DATABASE_URL is not configured" };

test("PostgreSQL 3/4: cart checkout, order history and single wallet deduction", options, async (context) => {
  const { app, db } = await createPostgresHarness(context);
  const owner = await createOwner(app);
  const store = await createStore(db, owner.id, { slug: "postgres-checkout" });
  const customer = await registerCustomer(app, store.slug);
  const product = await addProduct(db, store, {
    priceMinor: 2500,
    stockQuantity: 5,
    fields: [{ key: "playerId", label: "معرف اللاعب", type: "text", required: true }]
  });

  const adjustment = await app.inject({
    method: "POST",
    url: `/api/stores/${store.storeId}/customers/${customer.customer.id}/wallet-adjustments`,
    headers: {
      cookie: owner.cookie,
      "x-csrf-token": owner.csrf,
      "idempotency-key": "postgres-wallet-funding"
    },
    payload: { amountMinor: 10_000, reason: "تمويل اختبار الدفع من المحفظة" }
  });
  assert.equal(adjustment.statusCode, 201, adjustment.body);

  const orderRequest = {
    method: "POST",
    url: `/api/public/stores/${store.slug}/orders/wallet`,
    headers: {
      cookie: customer.cookie,
      "x-customer-csrf-token": customer.csrfToken,
      "idempotency-key": "postgres-order-once"
    },
    payload: { items: [{ productId: product.id, quantity: 2, inputData: { playerId: "778899" } }] }
  };
  const order = await app.inject(orderRequest);
  assert.equal(order.statusCode, 201, order.body);
  assert.equal(order.json().order.totalMinor, 5000);
  assert.equal(order.json().order.paymentStatus, "paid");
  assert.equal(order.json().order.status, "processing");

  const duplicate = await app.inject(orderRequest);
  assert.equal(duplicate.statusCode, 200, duplicate.body);
  assert.equal(duplicate.json().duplicate, true);
  assert.equal(duplicate.json().order.id, order.json().order.id);

  const changedPayload = await app.inject({
    ...orderRequest,
    payload: { items: [{ productId: product.id, quantity: 1, inputData: { playerId: "778899" } }] }
  });
  assert.equal(changedPayload.statusCode, 409, changedPayload.body);
  assert.equal(changedPayload.json().error, "idempotency_mismatch");

  const orders = await app.inject({
    method: "GET",
    url: `/api/public/stores/${store.slug}/customer/orders?query=${encodeURIComponent(order.json().order.orderNumber)}`,
    headers: { cookie: customer.cookie }
  });
  assert.equal(orders.statusCode, 200, orders.body);
  assert.equal(orders.json().orders.length, 1);
  assert.equal(orders.json().orders[0].id, order.json().order.id);

  const details = await app.inject({
    method: "GET",
    url: `/api/public/stores/${store.slug}/customer/orders/${order.json().order.id}`,
    headers: { cookie: customer.cookie }
  });
  assert.equal(details.statusCode, 200, details.body);
  assert.equal(details.json().order.items.length, 1);
  assert.deepEqual(details.json().order.items[0].inputData, { playerId: "778899" });

  const wallet = await app.inject({
    method: "GET",
    url: `/api/public/stores/${store.slug}/wallet`,
    headers: { cookie: customer.cookie }
  });
  assert.equal(wallet.statusCode, 200, wallet.body);
  assert.equal(wallet.json().wallet.balanceMinor, 5000);
  assert.equal(wallet.json().ledger.length, 2);

  const purchaseEntries = await db.query(
    `SELECT amount_minor,balance_before_minor,balance_after_minor,operation_type
     FROM wallet_ledger WHERE tenant_id=$1 AND store_id=$2 AND customer_id=$3 AND entry_type='purchase'`,
    [store.tenantId, store.storeId, customer.customer.id]
  );
  assert.equal(purchaseEntries.rows.length, 1);
  assert.equal(Number(purchaseEntries.rows[0].amount_minor), -5000);
  assert.equal(Number(purchaseEntries.rows[0].balance_before_minor), 10_000);
  assert.equal(Number(purchaseEntries.rows[0].balance_after_minor), 5000);
  assert.equal(purchaseEntries.rows[0].operation_type, "purchase");

  const stock = await db.query("SELECT stock_quantity FROM products WHERE id=$1", [product.id]);
  assert.equal(Number(stock.rows[0].stock_quantity), 3);
});
