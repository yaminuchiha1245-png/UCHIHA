import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import { createOperations } from "../../provider-web/src/operations.js";

function preview() {
  const source = ["scripts/preview-mock.js", "scripts/preview-operations.js", "apps/provider-web/src/api.js"].map((path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/^export /gm, "")).join("\n");
  const sandbox = vm.createContext({ Response, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, document: { querySelector: () => null },
    sessionStorage: { getItem() { throw Error("Local storage denied"); }, setItem() { throw Error("Local storage denied"); }, removeItem() {} },
    crypto: { getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) } });
  return { sandbox, ...vm.runInContext(`${source}\n({api, request, session})`, sandbox) };
}

test("offline preview signs in with blocked storage and renders every operational screen", async () => {
  const env = preview();
  const login = await env.api.devLogin("provider"); env.session.token = login.token;
  const me = await env.api.me(); env.session.tenantId = me.tenantId;
  assert.equal(me.canWrite, true);
  const source = readFileSync(new URL("../../provider-web/src/app.js", import.meta.url), "utf8").replace(/^import .*;\s*/gm, "");
  env.sandbox.createOperations = createOperations;
  env.sandbox.document.querySelectorAll = () => [];
  const views = vm.runInContext(`${source.slice(0, source.indexOf('document.addEventListener("click"'))}\n({ state, loaders, operations })`, env.sandbox);
  views.state.me = me; views.state.meta = await env.api.meta();
  for (const [name, render] of Object.entries(views.loaders)) {
    const html = await render(); assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/, name);
  }
  const page = await env.api.invoices("?limit=1&offset=1");
  assert.equal(page.items.length, 1); assert.equal(page.pagination.offset, 1); assert.equal(page.items[0].amountMinor, 5500);
  assert.equal(page.items[0].subscriberName, "مكتب سمير");
  await env.api.logout(); env.session.clear(); assert.equal(env.session.token, null);
  env.session.token = (await env.api.devLogin("provider")).token; assert.ok((await env.api.me()).tenantId);
});

test("offline preview mutations persist in memory and expose current API shapes without external calls", async () => {
  const env = preview(); env.session.token = (await env.api.devLogin("provider")).token;
  const write = (path, method, body) => env.request(path, { method, body, idempotent: true });
  for (const [path, body] of [["/sites", { name: "فرع التجربة", code: "NEW" }], ["/ip-pools", { name: "تجربة IP", dns: [], cidr: "10.12.0.0/24" }], ["/radius/policies", { name: "سياسة تجريبية", authMethods: ["pap"], simultaneousUse: 1, interimIntervalSeconds: 300 }], ["/resellers", { name: "وكيل تجريبي", commissionBps: 500 }]]) {
    const item = await write(path, "POST", body);
    await write(`${path}/${item.id}`, "PATCH", { ...body, name: "اسم محدث", reason: "اختبار" });
    assert.equal((await env.request(path)).items.find((row) => row.id === item.id).name, "اسم محدث");
  }
  await write("/subscribers/cus_1", "PATCH", { fullName: "أحمد المحدث", planId: "pln_home" });
  await write("/subscribers/cus_1/credential", "PUT", { radiusPassword: "temporary-test-password", reason: "اختبار" });
  const subscriber = await env.api.subscriber("cus_1"); assert.equal(subscriber.fullName, "أحمد المحدث"); assert.equal(subscriber.credentialConfigured, true);
  assert.doesNotMatch(JSON.stringify(subscriber), /temporary-test-password/);
  await write("/plans/pln_home", "PATCH", { name: "باقة محدثة", priceMinor: 1900, reason: "اختبار" });
  await write("/devices/dev_1", "PATCH", { name: "جهاز محدث", apiPort: 8729, siteId: "site_1", connectionMethod: "agent", secret: "demo-secret", reason: "اختبار" });
  assert.equal((await env.api.devices()).items[0].api_port, 8729); assert.doesNotMatch(JSON.stringify(await env.api.devices()), /demo-secret/);
  const invoice = await write("/invoices", "POST", { subscriberId: "cus_1", amountMinor: 1000, dueAt: "2030-01-01T00:00:00Z", reason: "اختبار" });
  await env.api.payment(invoice.id, { amountMinor: 500, method: "cash", reason: "اختبار" });
  assert.equal((await env.api.invoices()).items.find((item) => item.id === invoice.id).paidMinor, 500);
  assert.equal((await env.request("/payments")).items[0].amountMinor, 500);
  await assert.rejects(write(`/invoices/${invoice.id}/void`, "POST", { reason: "اختبار" }));
  await write("/invoices/inv_2/void", "POST", { reason: "اختبار" });
  assert.equal((await env.api.invoices()).items.find((item) => item.id === "inv_2").status, "void");
  const batch = await write("/voucher-batches", "POST", { planId: "pln_home", quantity: 2, validDays: 7 });
  assert.doesNotMatch(JSON.stringify(await env.request(`/voucher-batches/${batch.id}`)), /password/);
  const exported = await write(`/voucher-batches/${batch.id}/export`, "POST", { reason: "اختبار" }); assert.equal(exported.vouchers.length, 2);
  await write(`/vouchers/${exported.vouchers[0].id}/revoke`, "POST", { reason: "اختبار" });
  assert.equal((await env.request(`/voucher-batches/${batch.id}`)).vouchers[0].status, "revoked");
  const ticket = await write("/support/tickets", "POST", { title: "انقطاع تجريبي", description: "وصف المشكلة", subscriberId: "cus_1", category: "network", priority: "medium" });
  await write(`/support/tickets/${ticket.id}/messages`, "POST", { body: "جارٍ الفحص" });
  await write(`/support/tickets/${ticket.id}`, "PATCH", { status: "resolved", priority: "low", reason: "تمت المعالجة" });
  assert.equal((await env.request(`/support/tickets/${ticket.id}`)).events.length, 2);
  await write("/integrations/telegram/test", "POST", { reason: "اختبار" });
  await write("/integrations/telegram/disable", "POST", { reason: "اختبار" });
  assert.equal((await env.api.telegram()).status, "disabled");
  const generation = { dueDays: 7, reason: "اختبار" }; await write("/billing/generate", "POST", generation);
  assert.equal((await write("/billing/generate", "POST", generation)).created, 0);
  assert.ok((await env.request("/reports/summary")).billing.collectedMinor > 0);
});
