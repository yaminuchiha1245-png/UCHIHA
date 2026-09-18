import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createOperations } from "../../provider-web/src/operations.js";
import { OwnerService } from "../src/owner-service.js";
import { DEMO } from "../src/seed.js";
import { setup, devSession, headers } from "./helpers.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const form = (values) => { const result = new FormData(); for (const [name, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) result.append(name, String(item ?? "")); return result; };

async function ui(t) {
  const env = await setup(); t.after(() => env.close());
  const login = await devSession(env.app);
  const me = (await env.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: headers(login.token) })).json().data;
  let dialog;
  const downloads = [];
  const request = async (path, options = {}) => {
    const response = await env.app.inject({ method: options.method ?? "GET", url: `/api/v1${path}`,
      headers: headers(login.token, me.tenantId, options.idempotent ? { "idempotency-key": randomUUID() } : {}),
      ...(options.body !== undefined ? { payload: options.body } : {}) });
    if (response.statusCode >= 400) throw new Error(`${response.statusCode} ${response.body}`);
    return response.json().data;
  };
  const ops = createOperations({ request, context: () => me, escapeHtml: esc,
    pageHead: (kicker, title, subtitle, actions = "") => `<header>${esc(kicker)} ${esc(title)} ${esc(subtitle)} ${actions}</header>`,
    status: esc, date: (value) => value ?? "—", money: (value) => `${value / 100}`, formatBytes: (value) => `${value} B`,
    openDialog: (value) => { dialog = value; }, reasonAction: (value) => { dialog = value; },
    navigate: async () => {}, invalidate() {}, showToast() {}, download: (...args) => downloads.push(args) });
  return { ...env, ops, me, request, downloads,
    async action(action, data = {}) { dialog = null; await ops.handle({ dataset: { action: `ops-${action}`, ...data } }); return dialog; },
    async submit(values) { assert.ok(dialog, "The action must open its existing form"); return dialog.onSubmit(form(values)); } };
}

test("operational pages render real API envelopes including empty states", async (t) => {
  const env = await ui(t);
  for (const [view, load] of Object.entries(env.ops.loaders)) {
    const html = await load();
    assert.equal(typeof html, "string", view); assert.ok(html.includes("<header>"), view);
    assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/, view);
  }
});

test("network forms create and update sites, pools, policies and resellers through the API", async (t) => {
  const env = await ui(t);
  await env.action("create", { view: "sites" });
  const siteFields = { name: "فرع <script>alert(1)</script>", code: "UI-SITE", address: "اختبار", latitude: "", longitude: "" };
  await env.submit(siteFields);
  const site = (await env.request("/sites")).items.find((item) => item.code === "UI-SITE");
  const html = await env.ops.loaders.sites();
  assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/);
  await env.action("edit", { view: "sites", id: site.id });
  await env.submit({ ...siteFields, name: "فرع الاختبار", status: "active", reason: "تصحيح الاسم" });
  assert.equal((await env.request("/sites")).items.find((item) => item.id === site.id).name, "فرع الاختبار");
  await env.action("create", { view: "pools" });
  await env.submit({ name: "مجموعة الاختبار", siteId: site.id, cidr: "10.88.0.0/24", gateway: "10.88.0.1", dns: "1.1.1.1, 8.8.8.8", purpose: "pppoe" });
  assert.deepEqual((await env.request("/ip-pools")).items.find((item) => item.cidr === "10.88.0.0/24").dns, ["1.1.1.1", "8.8.8.8"]);
  await env.action("create", { view: "policies" });
  await env.submit({ name: "سياسة الاختبار", authMethods: ["pap", "chap"], simultaneousUse: 2, interimIntervalSeconds: 300, idleTimeoutSeconds: "", sessionTimeoutSeconds: "", rateLimitDownMbps: 50, rateLimitUpMbps: 10 });
  assert.equal((await env.request("/radius/policies")).items.find((item) => item.name === "سياسة الاختبار").simultaneousUse, 2);
  await env.action("create", { view: "resellers" });
  await env.submit({ name: "وكيل الاختبار", phone: "", email: "", siteId: site.id, commission: "7.25" });
  assert.equal((await env.request("/resellers")).items.find((item) => item.name === "وكيل الاختبار").commissionBps, 725);
});

test("voucher UI issues, opens, exports and revokes cards through authenticated endpoints", async (t) => {
  const env = await ui(t);
  await env.action("batch-create");
  await env.submit({ planId: "pln_demo_home", resellerId: "", quantity: 3, validDays: 7, expiresAt: "", usernamePrefix: "UITEST" });
  const batch = (await env.request("/voucher-batches")).items[0];
  await env.action("batch-open", { id: batch.id });
  const html = await env.ops.loaders.batchDetails(); assert.match(html, /UITEST/); assert.doesNotMatch(html, /password=/);
  const confirmExport = await env.action("batch-export", { id: batch.id });
  await confirmExport.onSubmit("تسليم تجريبي للبطاقات");
  assert.equal(env.downloads[0][2].length, 3); assert.ok(env.downloads[0][2][0].password);
  const card = env.downloads[0][2][0];
  const revoke = await env.action("voucher-revoke", { id: card.id });
  await revoke.onSubmit("إلغاء بطاقة اختبار");
  assert.equal((await env.request(`/voucher-batches/${batch.id}`)).vouchers.find((item) => item.id === card.id).status, "revoked");
});

test("support UI creates a linked ticket, adds a reply and resolves it", async (t) => {
  const env = await ui(t);
  await env.action("ticket-create");
  await env.submit({ title: "مشكلة اتصال تجريبية", description: "انقطاع اتصال الحساب التجريبي", category: "network", priority: "high", subscriberUsername: "ahmad-101", deviceId: "dev_demo_core" });
  const ticket = (await env.request("/support/tickets")).items[0];
  assert.equal(ticket.subscriberId, "cus_demo_1");
  await env.action("ticket-open", { id: ticket.id });
  await env.action("ticket-message", { id: ticket.id }); await env.submit({ body: "جاري مراجعة السجلات" });
  await env.action("ticket-edit", { id: ticket.id }); await env.submit({ status: "resolved", priority: "medium", reason: "استعاد الحساب الاتصال" });
  const updated = await env.request(`/support/tickets/${ticket.id}`);
  assert.equal(updated.status, "resolved"); assert.ok(updated.events.some((event) => event.body === "جاري مراجعة السجلات"));
  assert.match(await env.ops.loaders.ticketDetails(), /استعاد الحساب الاتصال/);
});

test("subscriber, credential, plan, device and invoice UI edits persist safely", async (t) => {
  const env = await ui(t);
  await env.action("edit-subscriber", { id: "cus_demo_1" });
  await env.submit({ fullName: "أحمد بعد التعديل", phone: "", address: "عنوان محدث", planId: "pln_demo_plus", policyId: "", ipPoolId: "", serviceExpiresAt: "2030-01-01T12:00" });
  await env.action("subscriber-credential", { id: "cus_demo_1" });
  await env.submit({ radiusPassword: "ui-test-strong-password", reason: "تحديث كلمة مرور تجريبية" });
  const subscriber = await env.request("/subscribers/cus_demo_1"); assert.equal(subscriber.fullName, "أحمد بعد التعديل"); assert.equal(subscriber.credentialConfigured, true);
  assert.equal(JSON.stringify(subscriber).includes("ui-test-strong-password"), false);
  await env.action("edit-plan", { id: "pln_demo_home" });
  await env.submit({ name: "باقة منزل محدثة", speedDownMbps: 30, speedUpMbps: 5, price: "21.25", billingCycle: "monthly", policyId: "", ipPoolId: "", status: "active", reason: "تعديل باقة الاختبار" });
  assert.equal((await env.request("/plans")).items.find((item) => item.id === "pln_demo_home").priceMinor, 2125);
  await env.action("edit-device", { id: "dev_demo_core" });
  await env.submit({ name: "جهاز الاختبار", siteId: "", branch: "المركز", host: "192.0.2.10", apiPort: 8729, connectionMethod: "agent", username: "test", secret: "", reason: "تحديث منفذ الجهاز" });
  assert.equal((await env.request("/devices")).items.find((item) => item.id === "dev_demo_core").api_port, 8729);
  await env.action("add-invoice");
  await env.submit({ subscriberUsername: "ahmad-101", amount: "12.50", dueAt: "2030-01-05T12:00", reason: "فاتورة اختبار يدوي" });
  const invoice = (await env.request("/invoices")).items.find((item) => item.amountMinor === 1250);
  assert.ok(invoice); const confirmVoid = await env.action("void-invoice", { id: invoice.id }); await confirmVoid.onSubmit("إلغاء فاتورة اختبار");
  assert.equal((await env.request("/invoices")).items.find((item) => item.id === invoice.id).status, "void");
});

test("operational UI hides writes for read-only sessions and rejects forged action clicks", async (t) => {
  const env = await ui(t); env.me.canWrite = false;
  assert.doesNotMatch(await env.ops.loaders.sites(), /data-action="ops-(create|edit)"/);
  for (const action of ["batch-create", "edit-subscriber", "add-invoice", "ticket-create", "telegram-test"]) await assert.rejects(env.action(action, { id: "test" }), /صلاحية/);
});

test("primary provider pages consume current API response names and include list pagination", async (t) => {
  const env = await ui(t);
  const paths = { dashboard: "/dashboard", subscribers: "/subscribers", sessions: "/sessions", invoices: "/invoices", plans: "/plans", devices: "/devices", telegram: "/integrations/telegram", audit: "/audit", products: "/subscriptions/products", team: "/team" };
  const api = Object.fromEntries(Object.entries(paths).map(([method, path]) => [method, (query = "") => env.request(path + query)]));
  const source = readFileSync(new URL("../../provider-web/src/app.js", import.meta.url), "utf8").replace(/^import .*;\s*/gm, "");
  const declarations = source.slice(0, source.indexOf('document.addEventListener("click"'));
  const sandbox = vm.createContext({ document: { querySelector: () => null, querySelectorAll: () => [] }, api, createOperations, request: env.request,
    session: { token: "test-session" }, ApiError: Error, URLSearchParams, setTimeout, clearTimeout, FormData });
  const views = vm.runInContext(`${declarations}\n({ state, dashboardView, subscribersView, sessionsView, billingView, plansView, devicesView, telegramView, auditView, teamView, moreView })`, sandbox);
  views.state.me = env.me;
  for (const [name, render] of Object.entries(views).filter(([name]) => name !== "state")) {
    const html = await render();
    assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/, name);
    if (["subscribersView", "billingView", "sessionsView", "auditView"].includes(name)) assert.match(html, /صفحات النتائج/, name);
  }
  const billing = await views.billingView();
  assert.match(billing, /سارة/); assert.match(billing, /data-remaining="[0-9]+"/);
  views.state.subscriberQuery = { q: "nonexistent-account", status: "all" };
  assert.match(await views.subscribersView(), /لا توجد نتائج/);
});

test("owner screens show real tenant details and pagination for subscriptions, jobs and audit", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const login = await devSession(env.app, "owner");
  const get = async (path) => {
    const response = await env.app.inject({ method: "GET", url: `/api/v1${path}`, headers: headers(login.token, null) });
    assert.equal(response.statusCode, 200, response.body); return response.json().data;
  };
  const api = { overview: () => get("/owner/overview"), tenants: (q = "") => get(`/owner/tenants${q}`), tenant: (id) => get(`/owner/tenants/${id}`), jobs: (q = "") => get(`/owner/jobs${q}`), audit: (q = "") => get(`/owner/audit${q}`) };
  const source = readFileSync(new URL("../../owner-web/src/app.js", import.meta.url), "utf8").replace(/^import .*;\s*/gm, "");
  const sandbox = vm.createContext({ document: { querySelector: () => null, querySelectorAll: () => [] }, api, session: { token: login.token }, ApiError: Error, setTimeout, clearTimeout });
  const views = vm.runInContext(`${source.slice(0, source.indexOf('document.addEventListener("click"'))}\n({ state, loaders })`, sandbox);
  views.state.me = await get("/auth/me"); views.state.tenantId = DEMO.tenantId;
  for (const [name, render] of Object.entries(views.loaders)) {
    const html = await render(); assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/, name);
    if (["tenants", "subscriptions", "jobs", "audit"].includes(name)) assert.match(html, /صفحات النتائج/, name);
  }
  assert.match(await views.loaders.tenantDetails(), /شبكة النخبة/);
  for (const path of ["/owner/tenants", "/owner/jobs", "/owner/audit"]) {
    const page = await get(`${path}?limit=1&offset=1`);
    assert.equal(page.pagination.offset, 1); assert.ok(page.items.length <= 1); assert.equal(typeof page.pagination.total, "number");
  }
});

test("owner retry cannot reset a job claimed by a worker during the request", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const login = await devSession(env.app, "owner");
  const context = (await env.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: headers(login.token, null) })).json().data;
  const timestamp = new Date().toISOString();
  await env.db.run("INSERT INTO outbox (id,tenant_id,topic,payload_json,status,attempts,available_at,created_at,updated_at) VALUES ('job_ui_race',?,'telegram.send','{}','pending',0,?,?,?)", [DEMO.tenantId, timestamp, timestamp, timestamp]);
  const racingDb = {
    async get(sql, params) { const snapshot = await env.db.get(sql, params); await env.db.run("UPDATE outbox SET status='processing',locked_at=? WHERE id='job_ui_race'", [timestamp]); return snapshot; },
    run: (sql, params) => env.db.run(sql, params)
  };
  await assert.rejects(new OwnerService(env.db, env.config).retryJob(context, "job_ui_race", "محاولة إدارية", racingDb), /تغيرت حالة المهمة/);
  assert.equal((await env.db.get("SELECT status FROM outbox WHERE id='job_ui_race'")).status, "processing");
});
