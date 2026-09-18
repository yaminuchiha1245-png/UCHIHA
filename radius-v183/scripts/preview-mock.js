const previewNow = new Date();
const previewIso = (days = 0) => new Date(previewNow.getTime() + days * 86_400_000).toISOString();
const previewPermissions = [
  "tenant:read", "tenant:manage", "subscriber:read", "subscriber:write", "subscriber:suspend",
  "plan:read", "plan:write", "session:read", "session:disconnect", "billing:read", "billing:write",
  "device:read", "device:write", "alert:read", "alert:write", "audit:read",
  ...["site", "ip_pool", "policy", "voucher", "reseller", "support", "integration"].flatMap((name) => [`${name}:read`, `${name}:write`]), "report:read"
];
const previewData = {
  user: { id: "usr_preview", email: "preview@uchiha.test", displayName: "مدير شبكة النخبة", platformRole: "none" },
  subscription: { id: "sub_preview", status: "active", productCode: "growth", productName: "النمو", startsAt: previewIso(-12), endsAt: previewIso(18), limits: { subscribers: 1500, devices: 10, team: 12 } },
  subscribers: [
    { id: "cus_1", username: "ahmad-101", fullName: "أحمد الخطيب", phone: "+963900000101", address: "دمشق", status: "active", balanceMinor: 0, serviceExpiresAt: previewIso(18), plan: { id: "pln_plus", name: "السريع 50" } },
    { id: "cus_2", username: "sara-204", fullName: "سارة محمود", phone: "+963900000204", address: "دمشق", status: "active", balanceMinor: 1200, serviceExpiresAt: previewIso(12), plan: { id: "pln_home", name: "المنزل 20" } },
    { id: "cus_3", username: "samir-office", fullName: "مكتب سمير", phone: "+963900000330", address: "ريف دمشق", status: "suspended", balanceMinor: 5500, serviceExpiresAt: previewIso(9), plan: { id: "pln_business", name: "الأعمال 100" } },
    { id: "cus_4", username: "nour-440", fullName: "نور حسن", phone: "+963900000440", address: "دمشق", status: "expired", balanceMinor: 1800, serviceExpiresAt: previewIso(-2), plan: { id: "pln_home", name: "المنزل 20" } }
  ],
  plans: [
    { id: "pln_home", name: "المنزل 20", speedDownMbps: 20, speedUpMbps: 5, priceMinor: 1800, billingCycle: "monthly", status: "active" },
    { id: "pln_plus", name: "السريع 50", speedDownMbps: 50, speedUpMbps: 10, priceMinor: 3000, billingCycle: "monthly", status: "active" },
    { id: "pln_business", name: "الأعمال 100", speedDownMbps: 100, speedUpMbps: 25, priceMinor: 5500, billingCycle: "monthly", status: "active" }
  ],
  sessions: [
    { id: "rad_1", username: "ahmad-101", framed_ip: "10.10.0.21", nas_ip: "192.0.2.10", started_at: previewIso(0), input_bytes: 94371840, output_bytes: 251658240, status: "active" },
    { id: "rad_2", username: "sara-204", framed_ip: "10.10.0.34", nas_ip: "192.0.2.10", started_at: previewIso(0), input_bytes: 25165824, output_bytes: 83886080, status: "active" }
  ],
  invoices: [
    { id: "inv_1", number: "INV-2026-091", full_name: "سارة محمود", amount_minor: 3000, paid_minor: 1800, currency: "USD", status: "partial", due_at: previewIso(4) },
    { id: "inv_2", number: "INV-2026-092", full_name: "مكتب سمير", amount_minor: 5500, paid_minor: 0, currency: "USD", status: "unpaid", due_at: previewIso(2) },
    { id: "inv_3", number: "INV-2026-090", full_name: "أحمد الخطيب", amount_minor: 3000, paid_minor: 3000, currency: "USD", status: "paid", due_at: previewIso(-3) }
  ],
  devices: [
    { id: "dev_1", name: "MikroTik الرئيسي", branch: "المركز", host: "192.0.2.10", api_port: 8729, connection_method: "agent", status: "online", last_seen_at: previewIso(0) },
    { id: "dev_2", name: "MikroTik الفرع", branch: "الفرع الغربي", host: "192.0.2.22", api_port: 8729, connection_method: "vpn", status: "offline", last_seen_at: previewIso(-1) }
  ],
  alerts: [
    { id: "alt_1", severity: "warning", title: "دفعة جزئية", body: "لدى المشترك سارة محمود رصيد متبقٍ." },
    { id: "alt_2", severity: "critical", title: "جهاز لا يستجيب", body: "لم يصل نبض الفرع الغربي ضمن المهلة." }
  ],
  audit: [
    { id: "aud_1", action: "subscriber.create", actor_name: "مدير شبكة النخبة", entity_type: "subscriber", reason: "إضافة حساب جديد", created_at: previewIso(0) },
    { id: "aud_2", action: "payment.record", actor_name: "المحصّل", entity_type: "payment", reason: "تحصيل دفعة موثقة", created_at: previewIso(-1) }
  ],
  team: [
    { id: "mem_1", displayName: "مدير شبكة النخبة", email: "owner@example.test", role: "owner", status: "active" },
    { id: "mem_2", displayName: "فريق التشغيل", email: "operator@example.test", role: "operator", status: "active" },
    { id: "mem_3", displayName: "مسؤول التحصيل", email: "collector@example.test", role: "collector", status: "active" }
  ],
  telegram: { status: "active", chatLabel: "فريق الشبكة", lastSeenAt: previewIso(0) },
  pending: null,
  products: [
    { id: "prd_starter", code: "starter", nameAr: "البداية", priceMinor: 1900, currency: "USD", billingPeriod: "monthly", limits: { subscribers: 250, devices: 2, team: 3 } },
    { id: "prd_growth", code: "growth", nameAr: "النمو", priceMinor: 4900, currency: "USD", billingPeriod: "monthly", limits: { subscribers: 1500, devices: 10, team: 12 } },
    { id: "prd_scale", code: "scale", nameAr: "المؤسسات", priceMinor: 9900, currency: "USD", billingPeriod: "monthly", limits: { subscribers: 10000, devices: 50, team: 50 } }
  ]
};

function previewResponse(data, status = 200) {
  return new Response(JSON.stringify(status < 400 ? { data, meta: { requestId: "preview" } } : { error: data, meta: { requestId: "preview" } }), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function previewAudit(action, entityType, reason = "عملية من المعاينة") {
  previewData.audit.unshift({ id: previewId(), action, actor_name: previewData.user.displayName, entity_type: entityType, reason, created_at: new Date().toISOString() });
}

globalThis.fetch = async (input, options = {}) => {
  options.signal?.throwIfAborted();
  const target = new URL(String(input), "https://preview.uchiha.invalid");
  const route = target.pathname.replace(/^\/api\/v1/, "");
  const method = String(options.method ?? "GET").toUpperCase();
  const body = options.body ? JSON.parse(options.body) : {};

  if (route === "/meta") return previewResponse({ product: "UCHIHA RADIUS", version: "1.0.0-rc.1", googleClientId: null, billingCheckoutAvailable: false, devAuthAvailable: true });
  if (route === "/auth/dev" && method === "POST") return previewResponse({ token: "preview-session-token", expiresAt: previewIso(1), user: previewData.user });
  if (route === "/auth/logout" && method === "POST") return previewResponse({ loggedOut: true });
  if (route === "/auth/me") return previewResponse({
    sessionId: "ses_preview", user: previewData.user,
    memberships: [{ tenantId: "ten_preview", tenantName: "شبكة النخبة", slug: "elite-preview", role: "owner", status: "active" }],
    tenantId: "ten_preview", tenantName: "شبكة النخبة", role: "owner", permissions: previewPermissions,
    subscription: previewData.subscription, canWrite: true, tenantCurrency: "USD", tenantTimeZone: "Asia/Damascus"
  });
  if (route === "/dashboard") {
    const outstanding = previewData.invoices.filter((item) => item.status !== "void").reduce((sum, invoice) => sum + Math.max(0, invoice.amount_minor - invoice.paid_minor), 0);
    return previewResponse({ tenant: { id: "ten_preview", name: "شبكة النخبة" }, metrics: {
      subscribers: previewData.subscribers.length,
      activeSubscribers: previewData.subscribers.filter((item) => item.status === "active").length,
      activeSessions: previewData.sessions.filter((item) => item.status === "active").length,
      outstandingMinor: outstanding,
      openInvoices: previewData.invoices.filter((item) => !["paid", "void"].includes(item.status)).length,
      devices: previewData.devices.length,
      onlineDevices: previewData.devices.filter((item) => item.status === "online").length
    }, alerts: previewData.alerts });
  }
  if (route === "/subscribers" && method === "POST") {
    const plan = previewData.plans.find((item) => item.id === body.planId);
    const item = { id: previewId(), username: body.username, fullName: body.fullName, phone: body.phone, address: body.address, status: "pending", balanceMinor: 0, serviceExpiresAt: body.serviceExpiresAt ?? null, credentialConfigured: Boolean(body.radiusPassword), plan: plan ? { id: plan.id, name: plan.name } : null };
    previewData.subscribers.unshift(item); previewAudit("subscriber.create", "subscriber", "إضافة من المعاينة"); return previewResponse(item, 201);
  }
  if (route === "/subscribers" && method === "GET") {
    const query = (target.searchParams.get("q") ?? "").toLowerCase();
    const status = target.searchParams.get("status");
    const items = previewData.subscribers.filter((item) => (!query || `${item.fullName} ${item.username} ${item.phone}`.toLowerCase().includes(query)) && (!status || item.status === status));
    return previewResponse(previewPage(items, target));
  }
  const subscriberMatch = route.match(/^\/subscribers\/([^/]+)$/);
  if (subscriberMatch) {
    const item = previewData.subscribers.find((candidate) => candidate.id === subscriberMatch[1]);
    if (item && method === "PATCH") {
      const { radiusPassword, reason, planId, ...fields } = body;
      Object.assign(item, fields); if ("planId" in body) { const plan = previewData.plans.find((p) => p.id === planId); item.plan = plan ? { id: plan.id, name: plan.name } : null; }
      previewAudit("subscriber.update", "subscriber", reason);
    }
    return item ? previewResponse(item) : previewResponse({ code: "NOT_FOUND", message: "المشترك غير موجود" }, 404);
  }
  const subscriberStatus = route.match(/^\/subscribers\/([^/]+)\/(activate|suspend)$/);
  if (subscriberStatus && method === "POST") {
    const item = previewData.subscribers.find((candidate) => candidate.id === subscriberStatus[1]);
    if (item) item.status = subscriberStatus[2] === "activate" ? "active" : "suspended";
    previewAudit(`subscriber.${subscriberStatus[2]}`, "subscriber", body.reason); return previewResponse({ id: subscriberStatus[1], status: item?.status, queued: true }, 202);
  }
  if (route === "/plans" && method === "POST") {
    const item = { id: previewId(), name: body.name, speedDownMbps: body.speedDownMbps, speedUpMbps: body.speedUpMbps, priceMinor: body.priceMinor, billingCycle: body.billingCycle, status: "active" };
    previewData.plans.unshift(item); previewAudit("plan.create", "plan"); return previewResponse(item, 201);
  }
  if (route === "/plans") return previewResponse({ items: previewData.plans });
  const disconnect = route.match(/^\/sessions\/([^/]+)\/disconnect$/);
  if (disconnect && method === "POST") {
    const item = previewData.sessions.find((candidate) => candidate.id === disconnect[1]); if (item) item.status = "stopped";
    previewAudit("radius.session.disconnect", "radius_session", body.reason); return previewResponse({ id: disconnect[1], queued: true }, 202);
  }
  if (route === "/sessions") return previewResponse(previewPage(previewData.sessions, target));
  const payment = route.match(/^\/invoices\/([^/]+)\/payments$/);
  if (payment && method === "POST") {
    const invoice = previewData.invoices.find((candidate) => candidate.id === payment[1]);
    if (!invoice || invoice.status === "void" || !Number.isInteger(body.amountMinor) || body.amountMinor <= 0 || body.amountMinor > invoice.amount_minor - invoice.paid_minor) return previewResponse({ code: "VALIDATION_ERROR", message: "تحقق من المبلغ والفاتورة" }, 422);
    previewData.payments.unshift({ id: previewId(), invoiceId: invoice.id, invoiceNumber: invoice.number, subscriberName: invoice.full_name, amountMinor: body.amountMinor, method: body.method, reference: body.reference, createdAt: previewIso() });
    if (invoice) { invoice.paid_minor = Math.min(invoice.amount_minor, invoice.paid_minor + Number(body.amountMinor)); invoice.status = invoice.paid_minor === invoice.amount_minor ? "paid" : "partial"; }
    previewAudit("payment.record", "payment", body.reason); return previewResponse({ id: previewId(), invoiceId: payment[1], invoiceStatus: invoice?.status }, 201);
  }
  if (route === "/invoices" && method === "GET") return previewResponse(previewPage(previewData.invoices.map(previewInvoice), target));
  if (route === "/devices" && method === "POST") {
    const item = { id: previewId(), name: body.name, branch: body.branch, host: body.host, api_port: body.apiPort, connection_method: body.connectionMethod, status: "pending", last_seen_at: null };
    previewData.devices.unshift(item); previewAudit("device.create", "network_device"); return previewResponse(item, 201);
  }
  if (route === "/devices") return previewResponse({ items: previewData.devices });
  const acknowledge = route.match(/^\/alerts\/([^/]+)\/acknowledge$/);
  if (acknowledge && method === "POST") {
    previewData.alerts = previewData.alerts.filter((item) => item.id !== acknowledge[1]); previewAudit("alert.acknowledge", "alert"); return previewResponse({ id: acknowledge[1], status: "acknowledged" });
  }
  if (route === "/alerts") return previewResponse({ items: previewData.alerts });
  if (route === "/audit") return previewResponse(previewPage(previewData.audit, target));
  if (route === "/subscriptions/products") return previewResponse({ current: previewData.subscription, canWrite: true, pending: previewData.pending, products: previewData.products });
  if (route === "/subscriptions/select" && method === "POST") {
    const product = previewData.products.find((item) => item.id === body.productId);
    previewData.pending = { id: previewId(), status: "pending", productCode: product?.code, productName: product?.nameAr, checkoutStatus: "manual_review", checkoutUrl: null, checkoutExpiresAt: null, createdAt: new Date().toISOString() };
    previewAudit("subscription.select", "tenant_subscription"); return previewResponse({ subscriptionId: previewData.pending.id, status: "pending", checkoutStatus: "manual_review", checkoutUrl: null, jobId: null, reused: false }, 202);
  }
  if (/^\/subscriptions\/requests\//.test(route)) return previewResponse(previewData.pending ?? { status: "pending", checkoutStatus: "manual_review" });
  if (route === "/integrations/telegram" && method === "PUT") {
    previewData.telegram = { status: "active", chatLabel: body.chatLabel, enabledSeverities: body.enabledSeverities, lastSeenAt: new Date().toISOString() };
    previewAudit("integration.telegram.configure", "integration"); return previewResponse(previewData.telegram);
  }
  if (route === "/integrations/telegram") return previewResponse(previewData.telegram);
  if (route === "/team/invitations" && method === "POST") {
    const item = { id: previewId(), displayName: body.displayName, email: body.email, role: body.role, status: "invited" };
    previewData.team.push(item); previewAudit("membership.invite", "membership", body.reason); return previewResponse(item, 201);
  }
  const member = route.match(/^\/team\/([^/]+)$/);
  if (member && method === "PATCH") {
    const item = previewData.team.find((candidate) => candidate.id === member[1]); if (item) Object.assign(item, { role: body.role, status: body.status });
    previewAudit("membership.update", "membership", body.reason); return previewResponse(item);
  }
  if (route === "/team") return previewResponse({ items: previewData.team });
  return previewResponse({ code: "NOT_FOUND", message: "هذا المسار غير موجود في المعاينة" }, 404);
};
