// Operational screens reuse the existing application's controls, dialogs and navigation.
export function createOperations({ request, context, escapeHtml: esc, pageHead: head, status, date, money,
  formatBytes, openDialog, reasonAction, navigate, invalidate, showToast, download = downloadCsv }) {
  const selected = new Map();
  const offsets = new Map();
  let detailBatch = null;
  let detailTicket = null;
  const canRead = (permission) => Boolean(context()?.permissions?.includes(permission));
  const canWrite = (permission) => Boolean(context()?.canWrite && canRead(permission));
  const scope = () => `${context()?.user?.id ?? ""}:${context()?.tenantId ?? ""}`;
  const write = (path, method, body) => request(path, { method, body, idempotent: true });
  const button = (action, label, data = {}, permitted = true) => permitted ? `<button type="button" class="button button-small" data-action="ops-${action}" ${Object.entries(data).map(([key, value]) => `data-${key}="${esc(value)}"`).join(" ")}>${esc(label)}</button>` : "";
  const link = (view, label, permission) => !permission || canRead(permission) ? `<button class="button button-small" data-view="${view}">${esc(label)}</button>` : "";
  const empty = (message = "لا توجد سجلات بعد") => `<div class="empty"><p>${esc(message)}</p></div>`;
  const info = (pairs) => `<div class="device-meta">${pairs.map(([label, value]) => `<span>${esc(label)} <b>${esc(value ?? "—")}</b></span>`).join("")}</div>`;
  const row = (title, subtitle, details = [], actions = "", state = "") => `<article class="list-row"><div class="row-main"><b>${esc(title)}</b><small>${esc(subtitle ?? "")}</small>${info(details)}</div>${state ? status(state) : ""}<div class="row-actions">${actions}</div></article>`;
  const metric = (label, value) => `<article class="metric-card"><small>${esc(label)}</small><strong>${esc(value ?? "—")}</strong></article>`;
  const choices = (values) => values.map((item) => Array.isArray(item) ? item : [item, item]);
  const option = (values, current) => choices(values).map(([value, label]) => `<option value="${esc(value)}" ${String(value) === String(current ?? "") ? "selected" : ""}>${esc(label)}</option>`).join("");
  const field = (name, label, { type = "text", value = "", values, required = false, min, max, step, pattern } = {}) => {
    const common = `name="${name}" ${required ? "required" : ""}`;
    const element = values ? `<select ${common}>${option(values, value)}</select>`
      : type === "textarea" ? `<textarea ${common} ${min ? `minlength="${min}"` : ""} maxlength="${max ?? 4000}">${esc(value ?? "")}</textarea>`
      : `<input ${common} type="${type}" value="${esc(value ?? "")}" ${min !== undefined ? `${type === "number" ? "min" : "minlength"}="${min}"` : ""} ${max !== undefined ? `${type === "number" ? "max" : "maxlength"}="${max}"` : ""} ${step ? `step="${step}"` : ""} ${pattern ? `pattern="${pattern}"` : ""} ${["password", "email"].includes(type) ? 'autocomplete="off" dir="ltr"' : ""}>`;
    return `<div class="field"><label><span>${esc(label)}</span>${element}</label></div>`;
  };
  const reasonField = () => field("reason", "سبب العملية", { type: "textarea", min: 3, max: 500, required: true });
  const text = (form, name) => String(form.get(name) ?? "").trim();
  const optional = (form, name) => text(form, name) || null;
  const number = (form, name, fallback = null) => text(form, name) === "" ? fallback : Number(text(form, name));
  const instant = (form, name) => text(form, name) ? new Date(text(form, name)).toISOString() : null;
  const dateValue = (value) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
  const networkLinks = () => `<div class="toolbar">${link("sites", "الفروع", "site:read")}${link("topology", "أجهزة الفروع", "site:read")}${link("pools", "عناوين IP", "ip_pool:read")}${link("policies", "سياسات الاتصال", "policy:read")}${link("radius", "RADIUS", "integration:read")}</div>`;
  const radiusLinks = () => `<div class="toolbar">${link("radius", "نظرة عامة")}${link("radiusNodes", "العقد")}${link("authEvents", "المصادقة")}${link("accountingEvents", "الاستهلاك")}${link("integrations", "حالة التكاملات")}</div>`;
  const pagination = (view, data) => {
    if (!data?.pagination) return "";
    const { total, offset, limit } = data.pagination;
    return `<div class="toolbar" aria-label="صفحات النتائج">${button("page", "السابق", { view, offset: Math.max(0, offset - limit) }, offset > 0)}<span>${total ? offset + 1 : 0}–${Math.min(total, offset + limit)} / ${total}</span>${button("page", "التالي", { view, offset: offset + limit }, offset + limit < total)}</div>`;
  };
  async function changed(view, message = "تم حفظ التغييرات") {
    selected.clear(); invalidate(view, "dashboard", "audit", "reports", "radius", "topology", "devices", "plans", "subscribers", "billing", "payments");
    showToast(message); await navigate(view, { force: true });
  }
  async function list(path, view) {
    const token = scope();
    const data = await request(`${path}?limit=25&offset=${offsets.get(view) ?? 0}`);
    if (token !== scope()) throw new Error("تغيرت الجلسة");
    data.items.forEach((item) => selected.set(`${view}:${item.id}`, item));
    return data;
  }
  async function references(path, labelKey = "name") {
    const { items } = await request(path);
    return [["", "غير محدد"], ...items.map((item) => [item.id, item[labelKey]])];
  }

  const definitions = {
    sites: { title: "الفروع", path: "/sites", permission: "site", summary: (item) => [["الرمز", item.code], ["الأجهزة المتصلة", `${item.onlineDevices}/${item.devices}`], ["الجلسات", item.activeSessions], ["العنوان", item.address]],
      fields: async (item) => field("name", "اسم الفرع", { value: item.name, required: true, min: 2, max: 100 }) + field("code", "رمز الفرع", { value: item.code, required: true, min: 2, max: 24, pattern: "[A-Za-z0-9_-]+" }) + field("address", "العنوان", { value: item.address, max: 500 }) + field("latitude", "خط العرض (اختياري)", { type: "number", value: item.latitude, min: -90, max: 90, step: "any" }) + field("longitude", "خط الطول (اختياري)", { type: "number", value: item.longitude, min: -180, max: 180, step: "any" }),
      payload: (form) => ({ name: text(form, "name"), code: text(form, "code"), address: optional(form, "address"), latitude: number(form, "latitude"), longitude: number(form, "longitude") }), statuses: [["active", "فعال"], ["inactive", "متوقف"]] },
    pools: { title: "مجموعات عناوين IP", path: "/ip-pools", permission: "ip_pool", summary: (item) => [["النطاق", item.cidr], ["الفرع", item.siteName], ["الحسابات المرتبطة", item.assignedSubscribers]],
      fields: async (item) => field("name", "اسم المجموعة", { value: item.name, required: true, min: 2, max: 100 }) + field("siteId", "الفرع", { values: await references("/sites"), value: item.siteId }) + field("cidr", "نطاق CIDR", { value: item.cidr, required: true, max: 64 }) + field("gateway", "البوابة (اختياري)", { value: item.gateway }) + field("dns", "DNS مفصولة بفواصل (حتى أربعة)", { value: item.dns?.join(", ") }) + field("purpose", "الاستخدام", { value: item.purpose ?? "pppoe", values: [["pppoe", "PPPoE"], ["hotspot", "Hotspot"], ["static", "عنوان ثابت"], ["management", "الإدارة"]] }),
      payload: (form) => ({ name: text(form, "name"), siteId: optional(form, "siteId"), cidr: text(form, "cidr"), gateway: optional(form, "gateway"), dns: text(form, "dns").split(",").map((value) => value.trim()).filter(Boolean), purpose: text(form, "purpose") }), statuses: [["active", "فعال"], ["disabled", "معطل"]] },
    policies: { title: "سياسات الاتصال", path: "/radius/policies", permission: "policy", summary: (item) => [["المصادقة", item.authMethods.join(" / ").toUpperCase()], ["الجلسات المتزامنة", item.simultaneousUse], ["فاصل الاستهلاك", `${item.interimIntervalSeconds} ثانية`]],
      fields: async (item) => field("name", "اسم السياسة", { value: item.name, required: true, min: 2, max: 100 }) + `<fieldset class="field"><legend>طرق المصادقة</legend>${["pap", "chap", "mschap", "mschapv2"].map((value) => `<label class="check-row"><input name="authMethods" type="checkbox" value="${value}" ${(item.authMethods ?? ["pap"]).includes(value) ? "checked" : ""}>${value.toUpperCase()}</label>`).join("")}</fieldset>` + [["simultaneousUse", "الجلسات المتزامنة", 1, 100, 1], ["interimIntervalSeconds", "فاصل الاستهلاك بالثواني", 60, 3600, 300], ["idleTimeoutSeconds", "مهلة الخمول بالثواني (اختياري)", 60, 86400, null], ["sessionTimeoutSeconds", "مدة الجلسة بالثواني (اختياري)", 300, 31536000, null], ["rateLimitDownMbps", "حد التنزيل Mbps (اختياري)", 1, 100000, null], ["rateLimitUpMbps", "حد الرفع Mbps (اختياري)", 1, 100000, null]].map(([name, label, min, max, fallback]) => field(name, label, { type: "number", value: item[name] ?? fallback, min, max, required: fallback !== null })).join(""),
      payload: (form) => ({ name: text(form, "name"), authMethods: form.getAll("authMethods"), ...Object.fromEntries(["simultaneousUse", "interimIntervalSeconds", "idleTimeoutSeconds", "sessionTimeoutSeconds", "rateLimitDownMbps", "rateLimitUpMbps"].map((name) => [name, number(form, name)])) }), statuses: [["active", "فعال"], ["disabled", "معطل"]] },
    resellers: { title: "الوكلاء", path: "/resellers", permission: "reseller", summary: (item) => [["الفرع", item.siteName], ["الهاتف", item.phone], ["العمولة", `${item.commissionBps / 100}%`], ["دفعات البطاقات", item.voucherBatches]],
      fields: async (item) => field("name", "اسم الوكيل", { value: item.name, required: true, min: 2, max: 120 }) + field("phone", "الهاتف", { value: item.phone, max: 40 }) + field("email", "البريد (اختياري)", { value: item.email, type: "email" }) + field("siteId", "الفرع", { values: await references("/sites"), value: item.siteId }) + field("commission", "العمولة %", { value: (item.commissionBps ?? 0) / 100, type: "number", min: 0, max: 100, step: "0.01", required: true }),
      payload: (form) => ({ name: text(form, "name"), phone: optional(form, "phone"), email: optional(form, "email"), siteId: optional(form, "siteId"), commissionBps: Math.round(number(form, "commission", 0) * 100) }), statuses: [["active", "فعال"], ["suspended", "موقوف"]] }
  };

  async function configuration(view) {
    const config = definitions[view]; const data = await list(config.path, view);
    return head("تشغيل الشبكة", config.title, `${data.items.length} سجل`, button("create", "إضافة", { view }, canWrite(`${config.permission}:write`)))
      + (view === "resellers" ? link("vouchers", "البطاقات", "voucher:read") : networkLinks())
      + `<section class="data-list">${data.items.map((item) => row(item.name, "", config.summary(item), button("edit", "تعديل", { view, id: item.id }, canWrite(`${config.permission}:write`)), item.status)).join("") || empty()}</section>`;
  }
  async function editConfiguration(view, id) {
    const config = definitions[view]; if (!config || !canWrite(`${config.permission}:write`)) throw new Error("لا تملك صلاحية التعديل");
    const item = id ? (await request(config.path)).items.find((row) => row.id === id) : {};
    if (!item) throw new Error("السجل غير موجود؛ حدّث القائمة");
    openDialog({ title: `${id ? "تعديل" : "إضافة"} · ${config.title}`, submitText: "حفظ",
      body: await config.fields(item) + (id ? field("status", "الحالة", { values: config.statuses, value: item.status }) + reasonField() : ""),
      onSubmit: async (form) => {
        const body = config.payload(form); if (id) Object.assign(body, { status: text(form, "status"), reason: text(form, "reason") });
        await write(`${config.path}${id ? `/${encodeURIComponent(id)}` : ""}`, id ? "PATCH" : "POST", body);
        await changed(view);
      }
    });
  }
  async function vouchers() {
    const data = await list("/voucher-batches", "vouchers");
    return head("الحسابات المدفوعة مسبقًا", "البطاقات", "دفعات البطاقات وحالتها", button("batch-create", "إصدار دفعة", {}, canWrite("voucher:write")))
      + `<section class="data-list">${data.items.map((item) => row(item.code, item.planName, [["المتاح", item.available], ["الفعال", item.active], ["العدد", item.quantity], ["المدة", `${item.validDays} يوم`]], button("batch-open", "عرض البطاقات", { id: item.id }), item.status)).join("") || empty()}</section>` + pagination("vouchers", data);
  }
  async function batchDetails() {
    if (!detailBatch) return vouchers();
    const batch = await request(`/voucher-batches/${encodeURIComponent(detailBatch)}`);
    return head("دفعة البطاقات", batch.code, batch.planName, link("vouchers", "رجوع") + button("batch-export", "تصدير بيانات الدخول", { id: batch.id }, canWrite("voucher:write")))
      + `<section class="data-list">${batch.vouchers.map((item) => row(item.username, date(item.expiresAt), [], button("voucher-revoke", "إلغاء البطاقة", { id: item.id }, canWrite("voucher:write") && item.status !== "revoked"), item.status)).join("") || empty()}</section>`;
  }
  async function createBatch() {
    const [plans, resellers] = await Promise.all([references("/plans"), references("/resellers")]);
    openDialog({ title: "إصدار دفعة بطاقات", submitText: "إصدار", body: field("planId", "الباقة", { values: plans, required: true }) + field("resellerId", "الوكيل (اختياري)", { values: resellers }) + field("quantity", "عدد البطاقات", { type: "number", value: 10, min: 1, max: 250, required: true }) + field("validDays", "أيام الخدمة بعد التفعيل", { type: "number", value: 30, min: 1, max: 3650, required: true }) + field("expiresAt", "آخر موعد للاستخدام (اختياري)", { type: "datetime-local" }) + field("usernamePrefix", "بادئة اسم المستخدم (اختياري)", { min: 2, max: 12, pattern: "[A-Za-z0-9]+" }),
      onSubmit: async (form) => { const body = { planId: text(form, "planId"), resellerId: optional(form, "resellerId"), quantity: number(form, "quantity"), validDays: number(form, "validDays"), expiresAt: instant(form, "expiresAt") }; if (text(form, "usernamePrefix")) body.usernamePrefix = text(form, "usernamePrefix"); await write("/voucher-batches", "POST", body); await changed("vouchers", "تم إصدار الدفعة"); } });
  }
  async function tickets() {
    const data = await list("/support/tickets", "tickets");
    return head("المتابعة", "الدعم والحوادث", `${data.pagination.total} تذكرة`, button("ticket-create", "تذكرة جديدة", {}, canWrite("support:write"))) + `<section class="data-list">${data.items.map((item) => row(item.title, item.number, [["الأولوية", priorityLabel(item.priority)], ["المشترك", item.subscriberName], ["التحديث", date(item.updatedAt, true)]], button("ticket-open", "التفاصيل", { id: item.id }), item.status)).join("") || empty()}</section>` + pagination("tickets", data);
  }
  async function ticketDetails() {
    if (!detailTicket) return tickets();
    const item = await request(`/support/tickets/${encodeURIComponent(detailTicket)}`);
    return head("الدعم", item.title, item.number, link("tickets", "رجوع") + button("ticket-message", "إضافة رد", { id: item.id }, canWrite("support:write")) + button("ticket-edit", "الحالة والأولوية", { id: item.id }, canWrite("support:write")))
      + `<section class="panel"><div class="panel-body"><p>${esc(item.description)}</p>${info([["الحالة", ticketStatusLabel(item.status)], ["الأولوية", priorityLabel(item.priority)], ["المسؤول", item.assignedUserName]])}</div></section>`
      + `<section class="data-list">${item.events.map((event) => row(event.actorName ?? "النظام", date(event.createdAt, true), [["التفاصيل", event.body ?? event.eventType]])).join("") || empty("لا توجد ردود بعد")}</section>`;
  }
  async function subscriberIdFor(form) {
    const username = text(form, "subscriberUsername"); if (!username) return null;
    const data = await request(`/subscribers?q=${encodeURIComponent(username)}&limit=100`);
    const found = data.items.find((item) => item.username === username);
    if (!found) throw new Error("أدخل اسم مستخدم مشترك موجود تمامًا كما هو");
    return found.id;
  }
  async function createTicket() {
    const devices = canRead("device:read") ? await references("/devices") : [["", "غير محدد"]];
    openDialog({ title: "تذكرة دعم جديدة", submitText: "إنشاء", body: field("title", "العنوان", { required: true, min: 3, max: 160 }) + field("description", "وصف المشكلة", { type: "textarea", required: true, min: 5, max: 4000 }) + field("category", "القسم", { values: [["network", "الشبكة"], ["subscriber", "مشترك"], ["billing", "الفواتير"], ["radius", "RADIUS"], ["other", "غير ذلك"]] }) + field("priority", "الأولوية", { values: priorities, value: "medium" }) + field("subscriberUsername", "اسم مستخدم المشترك (اختياري)") + field("deviceId", "الجهاز (اختياري)", { values: devices }),
      onSubmit: async (form) => { await write("/support/tickets", "POST", { title: text(form, "title"), description: text(form, "description"), category: text(form, "category"), priority: text(form, "priority"), subscriberId: await subscriberIdFor(form), deviceId: optional(form, "deviceId") }); await changed("tickets"); } });
  }
  const priorities = [["low", "منخفضة"], ["medium", "متوسطة"], ["high", "عالية"], ["critical", "حرجة"]];
  const ticketStatuses = [["open", "مفتوحة"], ["in_progress", "قيد المعالجة"], ["resolved", "محلولة"], ["closed", "مغلقة"]];
  const priorityLabel = (value) => priorities.find(([key]) => key === value)?.[1] ?? value;
  const ticketStatusLabel = (value) => ticketStatuses.find(([key]) => key === value)?.[1] ?? value;
  async function radius() {
    const data = await request("/radius/overview"); const totals = data.last24Hours;
    return head("تشغيل الاتصال", "RADIUS", `آخر اتصال ${date(data.lastSeenAt, true)}`, button("refresh", "تحديث", { view: "radius" })) + radiusLinks()
      + `<section class="metrics-grid">${metric("الجلسات النشطة", data.activeSessions)}${metric("الأجهزة المتصلة", `${data.onlineDevices}/${data.devices}`)}${metric("مصادقات مقبولة خلال 24 ساعة", totals.accepted)}${metric("مصادقات مرفوضة خلال 24 ساعة", totals.rejected)}</section>`
      + `<section class="panel"><div class="panel-body">${status(data.status)}${info([["طلبات المصادقة خلال 24 ساعة", totals.authenticationRequests], ["أحداث الاستهلاك خلال 24 ساعة", totals.accountingEvents], ["آخر خطأ", data.lastError]])}</div></section>`;
  }
  async function logs(view) {
    const isAuth = view === "authEvents"; const data = await list(isAuth ? "/radius/auth-events" : "/radius/accounting-events", view);
    return head("RADIUS", isAuth ? "سجل المصادقة" : "سجل الاستهلاك", `${data.pagination.total} حدث`) + radiusLinks() + `<section class="data-list">${data.items.map((item) => row(item.username, date(item.occurredAt, true), isAuth ? [["النتيجة", item.result], ["السبب", item.reason], ["المدة ms", item.latencyMs]] : [["الحدث", item.statusType], ["الجلسة", item.sessionId], ["الوارد", formatBytes(item.inputBytes)], ["الصادر", formatBytes(item.outputBytes)]])).join("") || empty()}</section>` + pagination(view, data);
  }
  async function radiusNodes() {
    const data = await list("/radius/nodes", "radiusNodes");
    return head("RADIUS", "العقد", "حالة الوكلاء وآخر مزامنة") + radiusLinks() + `<section class="data-list">${data.items.map((item) => row(item.name, item.siteName, [["الدور", item.role], ["آخر اتصال", date(item.lastSeenAt, true)], ["حسابات مخزنة", item.cachedPrincipals], ["أحداث بانتظار الإرسال", item.pendingAccounting + item.pendingAuth], ["آخر خطأ", item.lastError]], "", item.status)).join("") || empty("ستظهر العقد بعد تشغيل وكيل RADIUS وإرسال نبضه")}</section>`;
  }
  async function topology() {
    const data = await request("/topology");
    const groups = [...data.sites, { id: null, name: "أجهزة دون فرع" }];
    return head("البنية الشبكية", "أجهزة الفروع", "توزيع الأجهزة حسب الفرع") + networkLinks() + groups.map((site) => `<section class="panel"><div class="panel-head"><h2>${esc(site.name)}</h2></div>${data.devices.filter((device) => (device.siteId ?? null) === site.id).map((device) => row(device.name, device.host, [["الجلسات", device.activeSessions]], link("devices", "إدارة الجهاز", "device:read"), device.status)).join("") || empty("لا توجد أجهزة في هذا الفرع")}</section>`).join("");
  }
  async function integrations() {
    const data = await list("/integrations", "integrations");
    return head("التكاملات", "حالة الربط", "آخر اتصال وحالة كل خدمة") + radiusLinks() + `<section class="data-list">${data.items.map((item) => row(item.type, date(item.lastSeenAt, true), [["آخر خطأ", item.lastError]], "", item.status)).join("") || empty()}</section>`;
  }
  async function reports() {
    const data = await request("/reports/summary");
    return head("التقارير", "ملخص التشغيل", `${date(data.range.from)} — ${date(data.range.to)}`)
      + `<section class="metrics-grid">${metric("المشتركون", data.subscribers.total)}${metric("مشتركون فعالون", data.subscribers.active)}${metric("التحصيل خلال الفترة", money(data.billing.collectedMinor))}${metric("الفواتير خلال الفترة", data.billing.invoices)}${metric("استهلاك وارد خلال الفترة", formatBytes(data.traffic.inputBytes))}${metric("استهلاك صادر خلال الفترة", formatBytes(data.traffic.outputBytes))}${metric("تذاكر مفتوحة من الفترة", data.support.open)}${metric("مصادقات مرفوضة", data.authentication.rejected)}</section>`;
  }
  async function payments() {
    const data = await list("/payments", "payments");
    return head("التحصيل", "الدفعات المسجلة", `${data.pagination.total} دفعة`, link("billing", "الفواتير")) + `<section class="data-list">${data.items.map((item) => row(item.subscriberName, item.invoiceNumber, [["المبلغ", money(item.amountMinor)], ["الطريقة", item.method], ["المرجع", item.reference], ["التاريخ", date(item.createdAt, true)]])).join("") || empty()}</section>` + pagination("payments", data);
  }

  async function serviceFields(item, includePlan = true) {
    const [plans, policies, pools] = await Promise.all([includePlan ? references("/plans") : [], references("/radius/policies"), references("/ip-pools")]);
    return (includePlan ? field("planId", "الباقة", { values: plans, value: item.plan?.id }) : "")
      + field("policyId", "سياسة الاتصال (فارغ: وراثة الباقة)", { values: policies, value: item.policyId })
      + field("ipPoolId", "مجموعة IP (فارغ: وراثة الباقة)", { values: pools, value: item.ipPoolId });
  }
  async function editSubscriber(id) {
    const item = await request(`/subscribers/${encodeURIComponent(id)}`);
    openDialog({ title: `تعديل ${item.fullName}`, submitText: "حفظ", body: field("fullName", "الاسم", { value: item.fullName, required: true, min: 2, max: 120 })
      + field("phone", "الهاتف", { value: item.phone, max: 40 }) + field("address", "العنوان", { value: item.address, max: 500 })
      + await serviceFields(item) + field("serviceExpiresAt", "انتهاء الخدمة (اختياري)", { type: "datetime-local", value: dateValue(item.serviceExpiresAt) }),
      onSubmit: async (form) => { await write(`/subscribers/${encodeURIComponent(id)}`, "PATCH", { fullName: text(form, "fullName"), phone: optional(form, "phone"), address: optional(form, "address"), planId: optional(form, "planId"), policyId: optional(form, "policyId"), ipPoolId: optional(form, "ipPoolId"), serviceExpiresAt: instant(form, "serviceExpiresAt") }); await changed("subscribers"); } });
  }
  async function editPlan(id) {
    const item = (await request("/plans")).items.find((item) => item.id === id);
    if (!item) throw new Error("الباقة غير موجودة");
    openDialog({ title: `تعديل ${item.name}`, submitText: "حفظ", body: field("name", "اسم الباقة", { value: item.name, required: true, min: 2, max: 80 })
      + field("speedDownMbps", "التنزيل Mbps", { type: "number", value: item.speedDownMbps, required: true, min: 1, max: 100000 })
      + field("speedUpMbps", "الرفع Mbps", { type: "number", value: item.speedUpMbps, required: true, min: 1, max: 100000 })
      + field("price", "السعر بعملة الشبكة", { type: "number", value: item.priceMinor / 100, required: true, min: 0, max: 10000000, step: "0.01" })
      + field("billingCycle", "دورة الفوترة", { values: [["monthly", "شهرية"], ["weekly", "أسبوعية"], ["custom", "يدوية"]], value: item.billingCycle })
      + await serviceFields(item, false) + field("status", "الحالة", { values: [["active", "فعالة"], ["archived", "مؤرشفة"]], value: item.status }) + reasonField(),
      onSubmit: async (form) => { await write(`/plans/${encodeURIComponent(id)}`, "PATCH", { name: text(form, "name"), speedDownMbps: number(form, "speedDownMbps"), speedUpMbps: number(form, "speedUpMbps"), priceMinor: Math.round(number(form, "price") * 100), billingCycle: text(form, "billingCycle"), policyId: optional(form, "policyId"), ipPoolId: optional(form, "ipPoolId"), status: text(form, "status"), reason: text(form, "reason") }); await changed("plans"); } });
  }
  async function editDevice(id) {
    const item = (await request("/devices")).items.find((item) => item.id === id);
    if (!item) throw new Error("الجهاز غير موجود");
    openDialog({ title: `تعديل ${item.name}`, submitText: "حفظ", body: field("name", "اسم الجهاز", { value: item.name, required: true, min: 2, max: 100 })
      + field("siteId", "الفرع", { values: await references("/sites"), value: item.site_id }) + field("branch", "وصف الفرع", { value: item.branch, max: 100 })
      + field("host", "عنوان الجهاز", { value: item.host, required: true, min: 3, max: 253 }) + field("apiPort", "منفذ API", { type: "number", value: item.api_port, required: true, min: 1, max: 65535 })
      + field("connectionMethod", "الربط", { values: [["agent", "وكيل الشبكة"], ["vpn", "VPN"], ["api", "API"]], value: item.connection_method })
      + field("username", "اسم المستخدم", { value: item.username, max: 100 }) + field("secret", "كلمة مرور جديدة (فارغ: إبقاء الحالية)", { type: "password", min: 8, max: 500 }) + reasonField(),
      onSubmit: async (form) => { const body = { name: text(form, "name"), siteId: optional(form, "siteId"), branch: optional(form, "branch"), host: text(form, "host"), apiPort: number(form, "apiPort"), connectionMethod: text(form, "connectionMethod"), username: optional(form, "username"), reason: text(form, "reason") }; if (form.get("secret")) body.secret = String(form.get("secret")); await write(`/devices/${encodeURIComponent(id)}`, "PATCH", body); await changed("devices"); } });
  }
  function credential(id) {
    openDialog({ title: "تغيير كلمة مرور RADIUS", submitText: "حفظ وإرسال للمزامنة", body: field("radiusPassword", "كلمة المرور الجديدة", { type: "password", required: true, min: 8, max: 128 }) + reasonField(),
      onSubmit: async (form) => { await write(`/subscribers/${encodeURIComponent(id)}/credential`, "PUT", { radiusPassword: String(form.get("radiusPassword")), reason: text(form, "reason") }); await changed("subscribers", "تم حفظ كلمة المرور وإدراج المزامنة"); } });
  }
  function createInvoice() {
    openDialog({ title: "فاتورة جديدة", submitText: "إنشاء الفاتورة", body: field("subscriberUsername", "اسم المستخدم للمشترك", { required: true })
      + field("amount", "المبلغ (فارغ: سعر الباقة)", { type: "number", min: 0.01, max: 10000000, step: "0.01" })
      + field("dueAt", "موعد الاستحقاق", { type: "datetime-local", value: dateValue(new Date(Date.now() + 7 * 86_400_000)), required: true }) + reasonField(),
      onSubmit: async (form) => { const body = { subscriberId: await subscriberIdFor(form), dueAt: instant(form, "dueAt"), reason: text(form, "reason") }; if (text(form, "amount")) body.amountMinor = Math.round(number(form, "amount") * 100); await write("/invoices", "POST", body); await changed("billing", "تم إنشاء الفاتورة"); } });
  }
  function generateInvoices() {
    openDialog({ title: "توليد فواتير الدورة الحالية", submitText: "توليد الفواتير", body: `<div class="inline-message">ينشئ فواتير الحسابات المستحقة فقط. الفواتير المسجلة للدورة نفسها لا تتكرر.</div>` + field("dueDays", "أيام مهلة السداد", { type: "number", value: 7, required: true, min: 1, max: 90 }) + reasonField(),
      onSubmit: async (form) => { const result = await write("/billing/generate", "POST", { dueDays: number(form, "dueDays"), reason: text(form, "reason") }); await changed("billing", `أُنشئت ${result.created} فاتورة`); } });
  }

  const loaders = { ...Object.fromEntries(Object.keys(definitions).map((view) => [view, () => configuration(view)])), vouchers, batchDetails, tickets, ticketDetails, radius, authEvents: () => logs("authEvents"), accountingEvents: () => logs("accountingEvents"), radiusNodes, topology, integrations, reports, payments };
  const readPermissions = { sites: "site:read", pools: "ip_pool:read", policies: "policy:read", resellers: "reseller:read", vouchers: "voucher:read", batchDetails: "voucher:read", tickets: "support:read", ticketDetails: "support:read", radius: "integration:read", authEvents: "integration:read", accountingEvents: "integration:read", radiusNodes: "integration:read", topology: "site:read", integrations: "integration:read", reports: "report:read", payments: "billing:read" };
  async function handle(buttonElement) {
    const { action, view, id, offset } = buttonElement.dataset;
    if (!action?.startsWith("ops-")) return false;
    const name = action.slice(4);
    const required = ["batch-create", "batch-export", "voucher-revoke"].includes(name) ? "voucher:write" : ["ticket-create", "ticket-message", "ticket-edit"].includes(name) ? "support:write"
      : ["edit-subscriber", "subscriber-credential"].includes(name) ? "subscriber:write" : name === "edit-plan" ? "plan:write" : name === "edit-device" ? "device:write"
      : ["add-invoice", "void-invoice", "generate-invoices"].includes(name) ? "billing:write" : ["telegram-test", "telegram-disable"].includes(name) ? "integration:write" : name === "resolve-alert" ? "alert:write" : null;
    if (required && !canWrite(required)) throw new Error("لا تملك صلاحية هذه العملية");
    if (name === "edit-subscriber") await editSubscriber(id);
    else if (name === "edit-plan") await editPlan(id);
    else if (name === "edit-device") await editDevice(id);
    else if (name === "subscriber-credential") credential(id);
    else if (name === "add-invoice") createInvoice();
    else if (name === "generate-invoices") generateInvoices();
    else if (name === "void-invoice") reasonAction({ title: "إلغاء الفاتورة", message: "لا يمكن إلغاء فاتورة سُجلت عليها دفعة. سيبقى سجل الإلغاء محفوظًا.", danger: true, confirmText: "إلغاء الفاتورة", onSubmit: async (reason) => { await write(`/invoices/${encodeURIComponent(id)}/void`, "POST", { reason }); await changed("billing"); } });
    else if (name === "resolve-alert") reasonAction({ title: "إغلاق التنبيه", message: "أغلق التنبيه بعد معالجة سببه.", confirmText: "تم الحل", onSubmit: async (reason) => { await write(`/alerts/${encodeURIComponent(id)}/resolve`, "POST", { reason }); await changed("dashboard"); } });
    else if (name === "telegram-test" || name === "telegram-disable") reasonAction({ title: name === "telegram-test" ? "تنبيه تجريبي" : "إيقاف بوت التنبيهات", message: name === "telegram-test" ? "سيُدرج تنبيه تجريبي لإرساله إلى المحادثة المرتبطة." : "سيتوقف إرسال التنبيهات إلى المحادثة المرتبطة.", confirmText: name === "telegram-test" ? "إرسال اختبار" : "إيقاف", onSubmit: async (reason) => { await write(`/integrations/telegram/${name === "telegram-test" ? "test" : "disable"}`, "POST", { reason }); await changed("telegram", name === "telegram-test" ? "أُدرج التنبيه للإرسال؛ تابع آخر اتصال للتحقق من التسليم" : "تم إيقاف الربط"); } });
    else if (name === "create" || name === "edit") await editConfiguration(view, name === "edit" ? id : null);
    else if (name === "page" || name === "refresh") { if (!loaders[view]) return false; offsets.set(view, Math.max(0, Number(offset) || 0)); invalidate(view); await navigate(view, { force: true }); }
    else if (name === "batch-create") await createBatch();
    else if (name === "batch-open") { detailBatch = id; await navigate("batchDetails", { force: true }); }
    else if (name === "batch-export") reasonAction({ title: "تصدير بيانات دخول البطاقات", message: "الملف يحتوي أسماء المستخدمين وكلمات المرور. احفظه في مكان خاص.", confirmText: "تصدير", onSubmit: async (reason) => { const data = await write(`/voucher-batches/${encodeURIComponent(id)}/export`, "POST", { reason }); download(`cards-${data.code}.csv`, ["username", "password", "status", "validDays", "expiresAt"], data.vouchers); showToast("تم تجهيز ملف البطاقات"); } });
    else if (name === "voucher-revoke") reasonAction({ title: "إلغاء البطاقة", message: "لن تقبل البطاقة بعد مزامنة الوكيل. إلغاء البطاقة لا يؤكد فصل جلسة قائمة.", danger: true, confirmText: "إلغاء البطاقة", onSubmit: async (reason) => { await write(`/vouchers/${encodeURIComponent(id)}/revoke`, "POST", { reason }); await changed("batchDetails"); } });
    else if (name === "ticket-create") await createTicket();
    else if (name === "ticket-open") { detailTicket = id; await navigate("ticketDetails", { force: true }); }
    else if (name === "ticket-message") openDialog({ title: "إضافة رد", submitText: "حفظ الرد", body: field("body", "الرد", { type: "textarea", required: true, min: 1, max: 4000 }), onSubmit: async (form) => { await write(`/support/tickets/${encodeURIComponent(id)}/messages`, "POST", { body: text(form, "body") }); await changed("ticketDetails"); } });
    else if (name === "ticket-edit") {
      const item = await request(`/support/tickets/${encodeURIComponent(id)}`);
      openDialog({ title: "حالة التذكرة", submitText: "حفظ", body: field("status", "الحالة", { values: ticketStatuses, value: item.status }) + field("priority", "الأولوية", { values: priorities, value: item.priority }) + reasonField(), onSubmit: async (form) => { await write(`/support/tickets/${encodeURIComponent(id)}`, "PATCH", { status: text(form, "status"), priority: text(form, "priority"), reason: text(form, "reason") }); await changed("ticketDetails"); } });
    } else return false;
    return true;
  }
  return { loaders, readPermissions, handle, field, option, text, number, instant, dateValue, reasonField, subscriberIdFor,
    reset() { selected.clear(); offsets.clear(); detailBatch = null; detailTicket = null; } };
}

export function downloadCsv(filename, columns, rows) {
  const cell = (value) => { const text = String(value ?? ""); return `"${(/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`; };
  const csv = "\ufeff" + [columns, ...rows.map((row) => columns.map((column) => row[column]))].map((row) => row.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
