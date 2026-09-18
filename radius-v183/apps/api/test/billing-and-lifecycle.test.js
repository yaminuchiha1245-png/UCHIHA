import assert from "node:assert/strict";
import test from "node:test";
import { DEMO } from "../src/seed.js";
import { devSession, headers, setup } from "./helpers.js";

function writeHeaders(token, key) {
  return headers(token, DEMO.tenantId, { "idempotency-key": key });
}

test("periodic billing is idempotent per subscriber and billing period", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const login = await devSession(env.app);
  const request = {
    method: "POST", url: "/api/v1/billing/generate",
    headers: writeHeaders(login.token, "billing-run-2031-a"),
    payload: { asOf: "2031-02-12T10:00:00.000Z", dueDays: 9, reason: "تشغيل دورة شباط للاختبار" }
  };
  const first = await env.app.inject(request);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().data.created, 2);
  assert.equal(first.json().data.skipped, 0);
  const second = await env.app.inject({ ...request, headers: writeHeaders(login.token, "billing-run-2031-b") });
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(second.json().data.created, 0);
  assert.equal(second.json().data.skipped, 2);
  const invoices = await env.db.get(`SELECT COUNT(*) AS total FROM invoices
    WHERE tenant_id=? AND period_start='2031-02-01T00:00:00.000Z'`, [DEMO.tenantId]);
  assert.equal(invoices.total, 2);
  assert.equal((await env.db.get("SELECT balance_minor FROM subscribers WHERE id='cus_demo_1'")).balance_minor, 3000);
});

test("manual invoice, payment and void keep subscriber balance consistent", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const login = await devSession(env.app);
  const created = await env.app.inject({
    method: "POST", url: "/api/v1/invoices", headers: writeHeaders(login.token, "invoice-create-lifecycle"),
    payload: { subscriberId: "cus_demo_1", amountMinor: 2500, dueAt: "2032-01-15T00:00:00.000Z", reason: "فاتورة خدمة موثقة" }
  });
  assert.equal(created.statusCode, 201, created.body);
  const invoiceId = created.json().data.id;
  assert.equal((await env.db.get("SELECT balance_minor FROM subscribers WHERE id='cus_demo_1'")).balance_minor, 2500);
  const partial = await env.app.inject({
    method: "POST", url: `/api/v1/invoices/${invoiceId}/payments`, headers: writeHeaders(login.token, "invoice-payment-lifecycle"),
    payload: { amountMinor: 800, method: "cash", reason: "دفعة جزئية موثقة" }
  });
  assert.equal(partial.statusCode, 201, partial.body);
  assert.equal(partial.json().data.remainingMinor, 1700);
  assert.equal((await env.db.get("SELECT balance_minor FROM subscribers WHERE id='cus_demo_1'")).balance_minor, 1700);
  const voided = await env.app.inject({
    method: "POST", url: `/api/v1/invoices/${invoiceId}/void`, headers: writeHeaders(login.token, "invoice-void-lifecycle"),
    payload: { reason: "إلغاء الجزء المتبقي بعد مراجعة الفاتورة" }
  });
  assert.equal(voided.statusCode, 200, voided.body);
  assert.equal((await env.db.get("SELECT balance_minor FROM subscribers WHERE id='cus_demo_1'")).balance_minor, 0);
  const rejected = await env.app.inject({
    method: "POST", url: `/api/v1/invoices/${invoiceId}/payments`, headers: writeHeaders(login.token, "invoice-payment-after-void"),
    payload: { amountMinor: 100, method: "cash", reason: "يجب رفض هذه الدفعة" }
  });
  assert.equal(rejected.statusCode, 400);
});

test("plans, devices and alerts have safe audited lifecycle updates", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const login = await devSession(env.app);
  const plan = await env.app.inject({
    method: "PATCH", url: "/api/v1/plans/pln_demo_plus", headers: writeHeaders(login.token, "plan-update-1"),
    payload: { priceMinor: 3200, reason: "تحديث سعر الباقة بعد المراجعة" }
  });
  assert.equal(plan.statusCode, 200, plan.body);
  assert.equal(plan.json().data.priceMinor, 3200);
  const blockedArchive = await env.app.inject({
    method: "PATCH", url: "/api/v1/plans/pln_demo_plus", headers: writeHeaders(login.token, "plan-archive-blocked"),
    payload: { status: "archived", reason: "اختبار حماية المشترك النشط" }
  });
  assert.equal(blockedArchive.statusCode, 400);

  const device = await env.app.inject({
    method: "PATCH", url: "/api/v1/devices/dev_demo_core", headers: writeHeaders(login.token, "device-update-1"),
    payload: { branch: "المركز الرئيسي", secret: "new-device-secret", status: "offline", reason: "تدوير بيانات اتصال الجهاز" }
  });
  assert.equal(device.statusCode, 200, device.body);
  assert.equal(device.json().data.credentialConfigured, true);
  assert.equal("secret" in device.json().data, false);
  assert.match((await env.db.get("SELECT secret_ciphertext FROM network_devices WHERE id='dev_demo_core'")).secret_ciphertext, /^v1\./);

  const resolved = await env.app.inject({
    method: "POST", url: "/api/v1/alerts/alt_demo_1/resolve", headers: writeHeaders(login.token, "alert-resolve-1"),
    payload: { reason: "تمت مراجعة الدفعة وإغلاق التنبيه" }
  });
  assert.equal(resolved.statusCode, 200, resolved.body);
  assert.equal(resolved.json().data.status, "resolved");
  assert.ok((await env.db.get("SELECT resolved_at FROM alerts WHERE id='alt_demo_1'")).resolved_at);
});
