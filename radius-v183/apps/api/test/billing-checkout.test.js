import assert from "node:assert/strict";
import test from "node:test";
import { OutboxWorker } from "../src/outbox-worker.js";
import { devSession, headers, setup } from "./helpers.js";

async function selectStarter(env, key) {
  const provider = await devSession(env.app);
  const response = await env.app.inject({
    method: "POST",
    url: "/api/v1/subscriptions/select",
    headers: headers(provider.token, "ten_demo_isp", { "idempotency-key": key }),
    payload: { productId: "prd_starter" }
  });
  assert.equal(response.statusCode, 202);
  return { provider, data: response.json().data };
}

test("subscription selection uses one reusable manual-review request without a payment adapter", async (t) => {
  const env = await setup();
  t.after(() => env.close());
  const first = await selectStarter(env, "manual-subscription-1");
  const second = await selectStarter(env, "manual-subscription-2");
  assert.equal(first.data.checkoutStatus, "manual_review");
  assert.equal(first.data.jobId, null);
  assert.equal(second.data.subscriptionId, first.data.subscriptionId);
  assert.equal(second.data.reused, true);
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM tenant_subscriptions WHERE tenant_id='ten_demo_isp' AND product_id='prd_starter' AND status='pending'")).total, 1);
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM outbox WHERE topic='billing.checkout.create'")).total, 0);

  const status = await env.app.inject({ method: "GET", url: `/api/v1/subscriptions/requests/${first.data.subscriptionId}`, headers: headers(first.provider.token) });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().data.checkoutStatus, "manual_review");
});

test("concurrent subscription selections converge on one pending request", async (t) => {
  const env = await setup();
  t.after(() => env.close());
  const provider = await devSession(env.app);
  const makeRequest = (key) => env.app.inject({
    method: "POST",
    url: "/api/v1/subscriptions/select",
    headers: headers(provider.token, "ten_demo_isp", { "idempotency-key": key }),
    payload: { productId: "prd_starter" }
  });
  const [first, second] = await Promise.all([makeRequest("parallel-plan-a"), makeRequest("parallel-plan-b")]);
  assert.equal(first.statusCode, 202);
  assert.equal(second.statusCode, 202);
  assert.equal(first.json().data.subscriptionId, second.json().data.subscriptionId);
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM tenant_subscriptions WHERE tenant_id='ten_demo_isp' AND product_id='prd_starter' AND status='pending'")).total, 1);
});

test("configured billing adapter creates and exposes an HTTPS checkout safely", async (t) => {
  const calls = [];
  const env = await setup({
    billingCheckoutEndpoint: "https://billing.example.test/v1/checkouts",
    billingCheckoutToken: "billing-adapter-token-1234567890",
    billingCheckoutAllowedHosts: ["pay.example.test"]
  });
  t.after(() => env.close());
  const selected = await selectStarter(env, "adapter-subscription-1");
  assert.equal(selected.data.checkoutStatus, "queued");
  assert.ok(selected.data.jobId);

  const worker = new OutboxWorker({
    db: env.db,
    config: env.config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 201,
        json: async () => ({
          provider: "test-pay",
          externalId: "checkout-ext-1001",
          checkoutUrl: "https://pay.example.test/session/checkout-ext-1001",
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
        })
      };
    }
  });
  assert.equal((await worker.runOnce()).status, "sent");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, env.config.billingCheckoutEndpoint);
  assert.equal(calls[0].options.headers.authorization, `Bearer ${env.config.billingCheckoutToken}`);
  assert.equal(calls[0].options.headers["x-idempotency-key"], selected.data.jobId);
  assert.equal(calls[0].body.subscriptionId, selected.data.subscriptionId);
  assert.match(calls[0].body.webhookUrl, /\/webhooks\/billing$/);

  const status = await env.app.inject({ method: "GET", url: `/api/v1/subscriptions/requests/${selected.data.subscriptionId}`, headers: headers(selected.provider.token) });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().data.checkoutStatus, "ready");
  assert.equal(status.json().data.checkoutUrl, "https://pay.example.test/session/checkout-ext-1001");
  const stored = await env.db.get("SELECT provider,external_id,checkout_url FROM tenant_subscriptions WHERE id=?", [selected.data.subscriptionId]);
  assert.deepEqual({ ...stored }, { provider: "test-pay", external_id: "checkout-ext-1001", checkout_url: "https://pay.example.test/session/checkout-ext-1001" });
});

test("billing adapter rejects checkout links outside the production allowlist", async (t) => {
  const env = await setup({
    billingCheckoutEndpoint: "https://billing.example.test/v1/checkouts",
    billingCheckoutToken: "billing-adapter-token-1234567890",
    billingCheckoutAllowedHosts: ["pay.example.test"]
  });
  t.after(() => env.close());
  const selected = await selectStarter(env, "adapter-host-rejection-1");
  const worker = new OutboxWorker({
    db: env.db,
    config: env.config,
    fetchImpl: async () => ({
      ok: true,
      status: 201,
      json: async () => ({ provider: "test-pay", externalId: "bad-host-1001", checkoutUrl: "https://lookalike.example/session/bad-host-1001" })
    })
  });
  assert.equal((await worker.runOnce()).status, "failed");
  const stored = await env.db.get("SELECT checkout_url FROM tenant_subscriptions WHERE id = ?", [selected.data.subscriptionId]);
  assert.equal(stored.checkout_url, null);
  const job = await env.db.get("SELECT last_error FROM outbox WHERE id = ?", [selected.data.jobId]);
  assert.match(job.last_error, /allowlist/);
});
