import assert from "node:assert/strict";
import Fastify from "fastify";
import test from "node:test";
import { sha256 } from "../src/security.mjs";
import { installWalletProofSubmissionGuard } from "../src/wallet-proof-submission-guard.mjs";

const STORE_ID = "00000000-0000-4000-8000-000000000201";
const TENANT_ID = "00000000-0000-4000-8000-000000000202";
const METHOD_ID = "00000000-0000-4000-8000-000000000203";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000204";

function cookieName() {
  return `uchiha_customer_${sha256(STORE_ID).slice(0, 16)}`;
}

async function guardedApp({ destination = { value: "wallet-123" }, authenticated = false, duplicate = false } = {}) {
  const db = {
    async query(text) {
      if (text.includes("FROM payment_methods pm")) {
        return {
          rows: [{
            id: METHOD_ID,
            destination_data: destination,
            store_id: STORE_ID,
            tenant_id: TENANT_ID
          }]
        };
      }
      if (text.includes("FROM customer_sessions cs")) {
        return { rows: authenticated ? [{ id: CUSTOMER_ID }] : [] };
      }
      if (text.includes("FROM wallet_topup_proofs")) {
        return { rows: duplicate ? [{ id: "proof-existing" }] : [] };
      }
      return { rows: [] };
    }
  };

  const app = Fastify({ logger: false });
  app.addHook("onRequest", async (request) => {
    request.cookies = authenticated ? { [cookieName()]: "session-token" } : {};
  });
  installWalletProofSubmissionGuard(app, { db });
  app.post("/api/public/stores/:slug/wallet-proofs", async () => ({ ok: true }));
  await app.ready();
  return app;
}

test("wallet proof guard rejects a visible method without transfer destination", async () => {
  const app = await guardedApp({ destination: {} });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/public/stores/demo/wallet-proofs",
      payload: { paymentMethodId: METHOD_ID, referenceText: "TX-1" }
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().message, "طريقة الدفع لم يكتمل إعداد بيانات التحويل الخاصة بها بعد");
  } finally {
    await app.close();
  }
});

test("wallet proof guard allows a configured destination when proof is new", async () => {
  const app = await guardedApp({ authenticated: true });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/public/stores/live/wallet-proofs",
      payload: { paymentMethodId: METHOD_ID, referenceText: "TX-NEW" }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().ok, true);
  } finally {
    await app.close();
  }
});

test("wallet proof guard rejects replayed reference or receipt before canonical route writes", async () => {
  const app = await guardedApp({ authenticated: true, duplicate: true });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/public/stores/live/wallet-proofs",
      payload: { paymentMethodId: METHOD_ID, referenceText: "TX-USED" }
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().message, "تم إرسال هذا الإثبات مسبقًا");
  } finally {
    await app.close();
  }
});
