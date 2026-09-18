import test from "node:test";
import assert from "node:assert/strict";
import { DEMO } from "../src/seed.js";
import { setup } from "./helpers.js";

const INSTALLATION_A = "11111111-1111-4111-8111-111111111111";
const INSTALLATION_B = "22222222-2222-4222-8222-222222222222";

async function login(app, mode, installationId = null) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/dev",
    headers: installationId ? { "x-installation-id": installationId, "x-uchiha-platform": "android" } : {},
    payload: { mode }
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data;
}

function auth(token, tenantId = DEMO.tenantId, installationId = null, extra = {}) {
  return {
    authorization: `Bearer ${token}`,
    ...(tenantId ? { "x-tenant-id": tenantId } : {}),
    ...(installationId ? { "x-installation-id": installationId, "x-uchiha-platform": "android" } : {}),
    ...extra
  };
}

async function issueCode(app, ownerToken) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/owner/activation-codes",
    headers: auth(ownerToken, null, null, { "idempotency-key": "issue-code-0001" }),
    payload: {
      tenantId: DEMO.tenantId,
      productId: "prd_starter",
      durationDays: 30,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      issuedToName: "مزود الاختبار",
      issuedToEmail: DEMO.email,
      issuedToPhone: "+963942586044",
      note: "اختبار ربط التثبيت",
      reason: "اختبار إصدار كود حقيقي"
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().data;
}

test("owner activation code binds one installation and activates the provider subscription", async (t) => {
  const context = await setup({ requireInstallationBinding: true });
  t.after(() => context.close());
  const owner = await login(context.app, "owner");
  const issued = await issueCode(context.app, owner.token);
  assert.match(issued.code, /^UCHI(?:-[A-HJ-NP-Z2-9]{4}){4}$/);
  assert.equal(issued.codeHint.endsWith(issued.code.slice(-4)), true);

  const provider = await login(context.app, "provider", INSTALLATION_A);
  const before = await context.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(provider.token, DEMO.tenantId, INSTALLATION_A) });
  assert.equal(before.statusCode, 200, before.body);
  assert.equal(before.json().data.canWrite, false);
  assert.equal(before.json().data.installationBound, false);

  const redeemed = await context.app.inject({
    method: "POST",
    url: "/api/v1/subscriptions/redeem",
    headers: auth(provider.token, DEMO.tenantId, INSTALLATION_A, { "idempotency-key": "redeem-code-0001" }),
    payload: { activationCode: issued.code }
  });
  assert.equal(redeemed.statusCode, 200, redeemed.body);
  assert.equal(redeemed.json().data.activated, true);
  assert.equal(redeemed.json().data.tenantId, DEMO.tenantId);

  const after = await context.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(provider.token, DEMO.tenantId, INSTALLATION_A) });
  assert.equal(after.statusCode, 200, after.body);
  assert.equal(after.json().data.canWrite, true);
  assert.equal(after.json().data.installationBound, true);

  const stored = await context.db.get("SELECT code_hash, code_hint, status FROM activation_codes WHERE id = ?", [issued.id]);
  assert.equal(stored.status, "redeemed");
  assert.notEqual(stored.code_hash, issued.code);
  assert.equal(stored.code_hint, issued.codeHint);
});

test("installation binding rejects token reuse from another installation and owner can block it", async (t) => {
  const context = await setup({ requireInstallationBinding: true });
  t.after(() => context.close());
  const owner = await login(context.app, "owner");
  const issued = await issueCode(context.app, owner.token);
  const provider = await login(context.app, "provider", INSTALLATION_A);
  const redeemed = await context.app.inject({
    method: "POST",
    url: "/api/v1/subscriptions/redeem",
    headers: auth(provider.token, DEMO.tenantId, INSTALLATION_A, { "idempotency-key": "redeem-code-0002" }),
    payload: { activationCode: issued.code }
  });
  assert.equal(redeemed.statusCode, 200, redeemed.body);

  const wrongDevice = await context.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(provider.token, DEMO.tenantId, INSTALLATION_B) });
  assert.equal(wrongDevice.statusCode, 401);

  const listed = await context.app.inject({ method: "GET", url: "/api/v1/owner/installations", headers: auth(owner.token, null) });
  assert.equal(listed.statusCode, 200, listed.body);
  const installation = listed.json().data.items.find((item) => item.tenantId === DEMO.tenantId);
  assert.ok(installation);
  const blocked = await context.app.inject({
    method: "POST",
    url: `/api/v1/owner/installations/${installation.id}/status`,
    headers: auth(owner.token, null, null, { "idempotency-key": "block-installation-0001" }),
    payload: { status: "blocked", reason: "اختبار إيقاف جهاز العميل" }
  });
  assert.equal(blocked.statusCode, 200, blocked.body);
  const afterBlock = await context.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(provider.token, DEMO.tenantId, INSTALLATION_A) });
  assert.equal([401, 403].includes(afterBlock.statusCode), true, afterBlock.body);
});
