// Included ONLY by the offline preview builder, never by either deployed application.
// All data and actions below are temporary demonstrations; no external requests are made.
let previewSequence = 0;
function previewId() { return `demo_${Date.now().toString(36)}_${++previewSequence}`; }
function previewPage(items, target) {
  const limit = Math.min(100, Math.max(1, Number(target.searchParams.get("limit")) || 25));
  const offset = Math.max(0, Number(target.searchParams.get("offset")) || 0);
  return { items: items.slice(offset, offset + limit), pagination: { total: items.length, limit, offset } };
}
function previewInvoice(item) {
  return { id: item.id, number: item.number, subscriberId: item.subscriber_id, subscriberName: item.full_name,
    amountMinor: item.amount_minor, paidMinor: item.paid_minor, currency: item.currency, status: item.status, dueAt: item.due_at };
}
Object.assign(previewData, {
  sites: [{ id: "site_1", name: "المركز", code: "MAIN", address: "دمشق", status: "active", devices: 1, onlineDevices: 1, activeSessions: 2 }, { id: "site_2", name: "الفرع الغربي", code: "WEST", status: "active", devices: 1, onlineDevices: 0, activeSessions: 0 }],
  pools: [{ id: "pool_1", name: "مشتركو المركز", siteId: "site_1", siteName: "المركز", cidr: "10.10.0.0/24", gateway: "10.10.0.1", dns: ["1.1.1.1"], purpose: "pppoe", status: "active", assignedSubscribers: 2 }],
  policies: [{ id: "pol_1", name: "سياسة الاتصال الأساسية", authMethods: ["pap", "chap"], simultaneousUse: 1, interimIntervalSeconds: 300, status: "active" }],
  resellers: [{ id: "res_1", name: "وكيل المركز", siteId: "site_1", siteName: "المركز", commissionBps: 500, voucherBatches: 0, status: "active" }],
  batches: [], tickets: [], payments: [], generatedCycles: [],
  authEvents: [{ id: "auth_1", username: "ahmad-101", result: "accepted", reason: "حساب تجريبي", latencyMs: 12, occurredAt: previewIso() }],
  accountingEvents: [{ id: "acc_1", username: "ahmad-101", sessionId: "rad_1", statusType: "interim", inputBytes: 94371840, outputBytes: 251658240, occurredAt: previewIso() }],
  nodes: [{ id: "node_1", name: "وكيل المركز التجريبي", siteName: "المركز", role: "primary", status: "online", lastSeenAt: previewIso(), cachedPrincipals: 4, pendingAccounting: 0, pendingAuth: 0, lastError: null }]
});
previewData.devices.forEach((item, index) => { item.site_id = index === 0 ? "site_1" : "site_2"; });
previewData.invoices.forEach((item, index) => { item.subscriber_id = ["cus_2", "cus_3", "cus_1"][index]; });
previewData.alerts.forEach((item) => { item.status = "open"; });

function previewNewInvoice(subscriber, amountMinor, dueAt, cycle = null) {
  const item = { id: previewId(), number: `DEMO-${previewData.invoices.length + 1}`, subscriber_id: subscriber.id,
    full_name: subscriber.fullName, amount_minor: amountMinor, paid_minor: 0, currency: "USD", status: "unpaid", due_at: dueAt, cycle };
  previewData.invoices.unshift(item); return previewInvoice(item);
}
const previewBasicFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  options.signal?.throwIfAborted();
  const target = new URL(String(input), "https://preview.uchiha.invalid");
  const route = target.pathname.replace(/^\/api\/v1/, "");
  const method = String(options.method ?? "GET").toUpperCase();
  const body = options.body ? JSON.parse(options.body) : {};
  const fail = (message = "السجل غير موجود", status = 404) => previewResponse({ code: status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR", message }, status);
  const paths = { "/sites": "sites", "/ip-pools": "pools", "/radius/policies": "policies", "/resellers": "resellers" };
  for (const [path, collection] of Object.entries(paths)) {
    if (route !== path && !route.startsWith(`${path}/`)) continue;
    const items = previewData[collection];
    const id = route === path ? null : decodeURIComponent(route.slice(path.length + 1));
    if (method === "GET" && !id) return previewResponse(previewPage(items, target));
    if (method === "POST" && !id) {
      const item = { id: previewId(), status: "active", devices: 0, onlineDevices: 0, activeSessions: 0, assignedSubscribers: 0, voucherBatches: 0, ...body };
      item.siteName = previewData.sites.find((site) => site.id === item.siteId)?.name ?? null;
      items.unshift(item); previewAudit(`${collection}.create`, collection); return previewResponse(item, 201);
    }
    const item = items.find((item) => item.id === id); if (!item) return fail();
    if (method === "PATCH") { const { reason, ...fields } = body; Object.assign(item, fields); item.siteName = previewData.sites.find((site) => site.id === item.siteId)?.name ?? null; previewAudit(`${collection}.update`, collection, reason); return previewResponse(item); }
  }
  const credential = route.match(/^\/subscribers\/([^/]+)\/credential$/);
  if (credential && method === "PUT") {
    const item = previewData.subscribers.find((item) => item.id === credential[1]); if (!item) return fail();
    item.credentialConfigured = true; previewAudit("subscriber.credential.update", "subscriber", body.reason);
    return previewResponse({ id: item.id, credentialConfigured: true, queued: true });
  }
  const planMatch = route.match(/^\/plans\/([^/]+)$/);
  if (planMatch && method === "PATCH") {
    const item = previewData.plans.find((item) => item.id === planMatch[1]); if (!item) return fail();
    const { reason, ...fields } = body; Object.assign(item, fields);
    for (const subscriber of previewData.subscribers) if (subscriber.plan?.id === item.id) subscriber.plan.name = item.name;
    previewAudit("plan.update", "plan", reason); return previewResponse(item);
  }
  const deviceMatch = route.match(/^\/devices\/([^/]+)$/);
  if (deviceMatch && method === "PATCH") {
    const item = previewData.devices.find((item) => item.id === deviceMatch[1]); if (!item) return fail();
    const { secret, reason, apiPort, connectionMethod, siteId, ...fields } = body;
    Object.assign(item, fields, { api_port: apiPort, connection_method: connectionMethod, site_id: siteId });
    previewAudit("device.update", "network_device", reason); return previewResponse(item);
  }
  if (route === "/invoices" && method === "POST") {
    const subscriber = previewData.subscribers.find((item) => item.id === body.subscriberId); if (!subscriber) return fail("المشترك غير موجود");
    const amount = body.amountMinor ?? previewData.plans.find((item) => item.id === subscriber.plan?.id)?.priceMinor;
    if (!Number.isInteger(amount) || amount <= 0) return fail("تحقق من مبلغ الفاتورة", 422);
    previewAudit("invoice.create", "invoice", body.reason); return previewResponse(previewNewInvoice(subscriber, amount, body.dueAt), 201);
  }
  const voidInvoice = route.match(/^\/invoices\/([^/]+)\/void$/);
  if (voidInvoice && method === "POST") {
    const item = previewData.invoices.find((item) => item.id === voidInvoice[1]); if (!item) return fail();
    if (item.paid_minor > 0) return fail("لا يمكن إلغاء فاتورة عليها دفعة", 422);
    item.status = "void"; previewAudit("invoice.void", "invoice", body.reason); return previewResponse(previewInvoice(item));
  }
  if (route === "/billing/generate" && method === "POST") {
    const cycle = previewIso().slice(0, 7); let created = 0;
    for (const subscriber of previewData.subscribers.filter((item) => item.status === "active")) {
      const plan = previewData.plans.find((item) => item.id === subscriber.plan?.id);
      const key = `${cycle}:${subscriber.id}`;
      if (!plan || plan.billingCycle !== "monthly" || previewData.generatedCycles.includes(key)) continue;
      previewNewInvoice(subscriber, plan.priceMinor, previewIso(body.dueDays ?? 7), cycle); previewData.generatedCycles.push(key); created++;
    }
    previewAudit("billing.generate", "invoice", body.reason); return previewResponse({ created });
  }
  if (route === "/payments" && method === "GET") return previewResponse(previewPage(previewData.payments, target));
  const resolveAlert = route.match(/^\/alerts\/([^/]+)\/resolve$/);
  if (resolveAlert && method === "POST") {
    previewData.alerts = previewData.alerts.filter((item) => item.id !== resolveAlert[1]); previewAudit("alert.resolve", "alert", body.reason);
    return previewResponse({ id: resolveAlert[1], status: "resolved" });
  }
  if (route === "/voucher-batches" && method === "GET") return previewResponse(previewPage(previewData.batches.map(({ vouchers, ...batch }) => ({ ...batch, available: vouchers.filter((v) => v.status === "available").length, active: vouchers.filter((v) => v.status === "active").length })), target));
  if (route === "/voucher-batches" && method === "POST") {
    const plan = previewData.plans.find((item) => item.id === body.planId); if (!plan) return fail("اختر باقة موجودة", 422);
    if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 250) return fail("العدد من 1 إلى 250", 422);
    const batch = { id: previewId(), code: `DEMO-${previewData.batches.length + 1}`, planId: plan.id, planName: plan.name, quantity: body.quantity, validDays: body.validDays, status: "active", vouchers: [] };
    batch.vouchers = Array.from({ length: body.quantity }, (_, index) => ({ id: previewId(), username: `${body.usernamePrefix || "DEMO"}${previewSequence}${index + 1}`, password: `demo-card-${previewSequence}-${index + 1}`, status: "available", validDays: body.validDays, expiresAt: body.expiresAt }));
    previewData.batches.unshift(batch); previewAudit("voucher_batch.create", "voucher_batch"); return previewResponse({ ...batch, vouchers: undefined }, 201);
  }
  const batchMatch = route.match(/^\/voucher-batches\/([^/]+)(\/export)?$/);
  if (batchMatch) {
    const batch = previewData.batches.find((item) => item.id === batchMatch[1]); if (!batch) return fail();
    if (batchMatch[2] && method === "POST") { previewAudit("voucher_batch.export", "voucher_batch", body.reason); return previewResponse(batch); }
    if (!batchMatch[2] && method === "GET") return previewResponse({ ...batch, vouchers: batch.vouchers.map(({ password, ...voucher }) => voucher) });
  }
  const revokeVoucher = route.match(/^\/vouchers\/([^/]+)\/revoke$/);
  if (revokeVoucher && method === "POST") {
    const item = previewData.batches.flatMap((batch) => batch.vouchers).find((item) => item.id === revokeVoucher[1]); if (!item) return fail();
    item.status = "revoked"; previewAudit("voucher.revoke", "voucher", body.reason); return previewResponse({ id: item.id, status: item.status });
  }
  if (route === "/support/tickets" && method === "GET") return previewResponse(previewPage(previewData.tickets, target));
  if (route === "/support/tickets" && method === "POST") {
    const ticket = { id: previewId(), number: `SUP-${previewData.tickets.length + 1}`, ...body, subscriberName: previewData.subscribers.find((item) => item.id === body.subscriberId)?.fullName ?? null, status: "open", updatedAt: previewIso(), events: [] };
    previewData.tickets.unshift(ticket); previewAudit("support.ticket.create", "support_ticket"); return previewResponse(ticket, 201);
  }
  const ticketMatch = route.match(/^\/support\/tickets\/([^/]+)(\/messages)?$/);
  if (ticketMatch) {
    const item = previewData.tickets.find((item) => item.id === ticketMatch[1]); if (!item) return fail();
    if (method === "GET" && !ticketMatch[2]) return previewResponse(item);
    if (method === "PATCH" || method === "POST" && ticketMatch[2]) {
      if (method === "PATCH") Object.assign(item, { status: body.status, priority: body.priority });
      item.updatedAt = previewIso(); item.events.push({ id: previewId(), actorName: previewData.user.displayName, body: body.body ?? body.reason, createdAt: previewIso() });
      previewAudit(method === "PATCH" ? "support.ticket.update" : "support.message.create", "support_ticket", body.reason); return previewResponse(item);
    }
  }
  if (route === "/radius/overview") return previewResponse({ status: "active", lastSeenAt: previewIso(), lastError: null, activeSessions: previewData.sessions.filter((item) => item.status === "active").length, devices: previewData.devices.length, onlineDevices: previewData.devices.filter((item) => item.status === "online").length, last24Hours: { accepted: previewData.authEvents.length, rejected: 0, authenticationRequests: previewData.authEvents.length, accountingEvents: previewData.accountingEvents.length } });
  if (route === "/radius/auth-events") return previewResponse(previewPage(previewData.authEvents, target));
  if (route === "/radius/accounting-events") return previewResponse(previewPage(previewData.accountingEvents, target));
  if (route === "/radius/nodes") return previewResponse(previewPage(previewData.nodes, target));
  if (route === "/topology") return previewResponse({ sites: previewData.sites, devices: previewData.devices.map((item) => ({ ...item, siteId: item.site_id, activeSessions: previewData.sessions.filter((session) => session.nas_ip === item.host && session.status === "active").length })) });
  if (route === "/integrations") return previewResponse({ items: [{ id: "int_radius", type: "RADIUS (تجريبي)", status: "active", lastSeenAt: previewIso(), lastError: null }, { id: "int_telegram", type: "Telegram (تجريبي)", ...previewData.telegram, lastError: null }] });
  if (route === "/integrations/telegram/disable" && method === "POST") {
    previewData.telegram = { status: "disabled", chatLabel: null, lastSeenAt: null }; previewAudit("integration.telegram.disable", "integration", body.reason); return previewResponse(previewData.telegram);
  }
  if (route === "/integrations/telegram/test" && method === "POST") {
    if (previewData.telegram.status !== "active") return fail("اربط البوت أولًا", 422);
    previewAudit("integration.telegram.test", "integration", body.reason); return previewResponse({ queued: true, demo: true }, 202);
  }
  if (route === "/reports/summary") return previewResponse({ range: { from: previewIso(-30), to: previewIso() }, subscribers: { total: previewData.subscribers.length, active: previewData.subscribers.filter((item) => item.status === "active").length }, billing: { collectedMinor: previewData.payments.reduce((sum, item) => sum + item.amountMinor, 0), invoices: previewData.invoices.length }, traffic: { inputBytes: previewData.accountingEvents.reduce((sum, item) => sum + item.inputBytes, 0), outputBytes: previewData.accountingEvents.reduce((sum, item) => sum + item.outputBytes, 0) }, support: { open: previewData.tickets.filter((item) => ["open", "in_progress"].includes(item.status)).length }, authentication: { rejected: 0 } });
  return previewBasicFetch(input, options);
};
