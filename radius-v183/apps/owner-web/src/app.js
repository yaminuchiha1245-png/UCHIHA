import { api, ApiError, session } from "./api.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const isNativeRuntime = Boolean(document.querySelector('meta[name="uchiha-runtime"][content="native"]'));
const state = { me: null, meta: null, view: "dashboard", tenantId: null, offsets: {}, cache: new Map(), warming: new Map(), requestVersion: 0, toastTimer: null, warmScheduled: false };
const parent = { dashboard: "dashboard", tenants: "tenants", subscriptions: "subscriptions", jobs: "jobs", more: "more", audit: "more", tenantDetails: "tenants" };
const labels = { active: "فعّال", suspended: "موقوف", closed: "مغلق", trialing: "تجريبي", grace: "مهلة", past_due: "متأخر", canceled: "ملغي", expired: "منتهي", pending: "قيد الانتظار", processing: "قيد التنفيذ", sent: "مكتمل", failed: "فشل" };

function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]); }
function status(value) { return `<span class="status-pill status-${esc(value)}">${esc(labels[value] ?? value ?? "—")}</span>`; }
function date(value, time = false) { if (!value) return "—"; return new Intl.DateTimeFormat("ar", time ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(new Date(value)); }
function icon(name) { const p = { plus: '<path d="M12 5v14M5 12h14"/>', refresh: '<path d="M20 7v5h-5M4 17v-5h5M18.5 9A7 7 0 0 0 6.8 6.8L4 9m16 6-2.8 2.2A7 7 0 0 1 5.5 15"/>', network: '<path d="M4 20V8l8-4 8 4v12M8 11h2M14 11h2M8 15h2M14 15h2"/>', wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>', jobs: '<path d="M6 4h12v16H6zM9 9h6M9 13h6M9 17h4"/>', audit: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h6M9 16h6"/>', shield: '<path d="M12 3 5 6v5c0 4.5 2.8 8 7 10 4.2-2 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>', theme: '<path d="M20 15a8 8 0 0 1-11-11 8 8 0 1 0 11 11"/>', logout: '<path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10"/>' }; return `<svg viewBox="0 0 24 24">${p[name] ?? p.shield}</svg>`; }
function head(kicker, title, text, actions = "") { return `<header class="page-head"><div><p class="eyebrow">${esc(kicker)}</p><h1>${esc(title)}</h1><p>${esc(text)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</header>`; }
function skeleton() { return `${head("OWNER CONTROL", "جارٍ التحديث", "نجلب حالة المنصة") }<div class="skeleton-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`; }
function errorView(error) { return `${head("تعذر التحميل", "لم تكتمل العملية", error.message ?? "خطأ غير متوقع")}<div class="panel empty">${icon("refresh")}<div><b>أعد المحاولة</b><p>تحقق من الخادم والاتصال.</p><button class="button button-primary" data-action="refresh">إعادة التحميل</button></div></div>`; }
function toast(message, type = "success") { const el = $("#toast"); el.textContent = message; el.className = `toast show${type === "error" ? " error" : ""}`; clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.className = "toast", 2800); }
function invalidate(...views) { views.forEach((view) => { state.cache.delete(view); state.warming.delete(view); }); }
function closeDialog() { if ($("#dialog").open) $("#dialog").close(); $("#dialog-body").textContent = ""; $("#dialog-actions").textContent = ""; $("#dialog-form").onsubmit = null; }
function busy(button, value) { if (value) { button.dataset.text = button.textContent; button.textContent = "جارٍ الحفظ…"; button.disabled = true; } else { button.textContent = button.dataset.text ?? button.textContent; delete button.dataset.text; button.disabled = false; } }

function dialog({ kicker, title, body, submitText, danger = false, onSubmit }) {
  $("#dialog-kicker").textContent = kicker; $("#dialog-title").textContent = title; $("#dialog-body").innerHTML = body;
  $("#dialog-actions").innerHTML = `<button type="button" class="button" data-action="close-dialog">إلغاء</button><button type="submit" class="button ${danger ? "button-danger" : "button-primary"}">${esc(submitText)}</button>`;
  $("#dialog-form").onsubmit = async (event) => { event.preventDefault(); const submit = event.currentTarget.querySelector('[type="submit"]'); busy(submit, true); try { await onSubmit(new FormData(event.currentTarget)); closeDialog(); } catch (error) { toast(error.message, "error"); busy(submit, false); } };
  $("#dialog").showModal();
}

function cachedView(view) {
  const entry = state.cache.get(view);
  if (entry && entry.expiresAt > Date.now()) return entry.html;
  state.cache.delete(view);
  return null;
}

function loadAndCache(view) {
  const cached = cachedView(view);
  if (cached !== null) return Promise.resolve(cached);
  if (state.warming.has(view)) return state.warming.get(view);
  const pending = loaders[view]().then((html) => {
    if (state.me && state.warming.get(view) === pending) state.cache.set(view, { html, expiresAt: Date.now() + 15_000 });
    return html;
  }).finally(() => { if (state.warming.get(view) === pending) state.warming.delete(view); });
  state.warming.set(view, pending);
  return pending;
}

function prefetchView(view) {
  if (!state.me || !loaders[view] || cachedView(view) !== null) return;
  loadAndCache(view).catch(() => {});
}

function scheduleWarmViews() {
  if (state.warmScheduled) return;
  state.warmScheduled = true;
  const token = session.token;
  const warm = async () => {
    for (const view of ["tenants", "subscriptions", "jobs", "more"]) {
      if (!state.me || session.token !== token) break;
      try { await loadAndCache(view); } catch { /* A later tap will show the normal retry state. */ }
    }
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(() => warm(), { timeout: 800 });
  else setTimeout(warm, 120);
}

async function navigate(view, force = false) {
  if (!state.me) return;
  const version = ++state.requestVersion;
  if (!loaders[view]) view = "dashboard";
  if (force) invalidate(view);
  state.view = view;
  try { history.replaceState(null, "", `#${view}`); } catch { /* Local preview may block history. */ }
  $$(".nav-button").forEach((button) => { const active = button.dataset.view === parent[view]; button.classList.toggle("active", active); active ? button.setAttribute("aria-current", "page") : button.removeAttribute("aria-current"); });
  const main = $("#main-content"); const cached = cachedView(view); main.innerHTML = cached ?? skeleton(); main.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: "auto" });
  if (cached !== null) return;
  try { const html = await loadAndCache(view); if (version === state.requestVersion && view === state.view) main.innerHTML = html; }
  catch (error) { if (version !== state.requestVersion || !state.me) return; if (error.status === 401) return logout(false, error.message); main.innerHTML = errorView(error); }
}

async function dashboard() {
  const data = await api.overview(); const m = data.metrics;
  return `${head("نظرة المنصة", `مرحبًا، ${state.me.user.displayName}`, "صورة تشغيلية واحدة لكل الشبكات")}
  <section class="metrics-grid owner-metrics"><article class="metric-card"><small>الشبكات</small><strong>${m.tenants}</strong><span>${m.activeTenants} فعّالة</span></article><article class="metric-card teal"><small>الاشتراكات الفعالة</small><strong>${m.activeSubscriptions}</strong><span>من ${m.subscriptions}</span></article><article class="metric-card amber"><small>تحتاج متابعة</small><strong>${m.subscriptionsNeedingAttention}</strong><span>اشتراك</span></article><article class="metric-card purple"><small>المستخدمون</small><strong>${m.users}</strong><span>${m.subscribers} مشتركًا</span></article><article class="metric-card"><small>تنبيهات مفتوحة</small><strong>${m.openAlerts}</strong><span>تحذير أو حرج</span></article><article class="metric-card amber"><small>مهام معلقة</small><strong>${m.pendingJobs}</strong><span>صف التكاملات</span></article></section>
  <section class="quick-grid"><button class="quick-card" data-view="tenants"><span class="quick-icon">${icon("network")}</span><b>إدارة الشبكات</b><small>إنشاء ومراجعة الحالة</small></button><button class="quick-card" data-view="subscriptions"><span class="quick-icon">${icon("wallet")}</span><b>الاشتراكات</b><small>التفعيل والمهلة</small></button><button class="quick-card" data-view="jobs"><span class="quick-icon">${icon("jobs")}</span><b>صف المهام</b><small>الأخطاء وإعادة المحاولة</small></button><button class="quick-card" data-view="audit"><span class="quick-icon">${icon("audit")}</span><b>التدقيق</b><small>كل قرار حساس</small></button></section>`;
}

async function tenants(mode = "all") {
  const view = mode === "subscriptions" ? "subscriptions" : "tenants";
  const data = await api.tenants(`?limit=25&offset=${state.offsets[view] ?? 0}`);
  const items = data.items;
  const cards = items.map((item) => `<article class="tenant-card"><div class="tenant-card-head"><span class="avatar">${esc(item.name.charAt(0))}</span><div><h3>${esc(item.name)}</h3><p>${esc(item.slug)}</p></div>${status(item.status)}</div><div class="tenant-stats"><div><small>المشتركون</small><b>${item.subscribers_count}</b></div><div><small>الفريق</small><b>${item.members_count}</b></div></div><div class="meta-line" style="margin-bottom:12px"><span>الخطة: ${esc(item.product_name ?? "—")}</span><i></i><span>${labels[item.subscription_status] ?? item.subscription_status ?? "بلا اشتراك"}</span></div><div class="tenant-actions"><button class="button" data-action="tenant-details" data-id="${esc(item.id)}">تفاصيل الشبكة</button><button class="button button-primary" data-action="subscription" data-id="${item.id}" data-status="${esc(item.subscription_status ?? "pending")}">إدارة الاشتراك</button><button class="button" data-action="radius-key" data-id="${item.id}" data-slug="${esc(item.slug)}">مفتاح الوكيل</button><button class="button ${item.status === "active" ? "danger-text" : ""}" data-action="tenant-status" data-id="${item.id}" data-status="${item.status === "active" ? "suspended" : "active"}">${item.status === "active" ? "إيقاف" : "تفعيل"}</button></div></article>`).join("");
  const title = mode === "subscriptions" ? "الاشتراكات" : "الشبكات";
  return `${head("إدارة المنصة", title, `${items.length} سجلًا في هذه الصفحة`, mode === "all" ? `<button class="button button-primary" data-action="add-tenant">${icon("plus")}شبكة</button>` : "")}<section class="cards-grid">${cards || `<div class="panel empty"><div><b>لا توجد عناصر</b><p>لا توجد شبكات في هذه الصفحة.</p></div></div>`}</section>${pager(view, data.pagination)}`;
}

async function jobs() {
  const data = await api.jobs(`?limit=25&offset=${state.offsets.jobs ?? 0}`);
  const rows = data.items.map((item) => `<article class="list-row"><span class="avatar amber">${icon("jobs")}</span><div class="row-main"><b class="job-topic">${esc(item.topic)}</b><small>${date(item.created_at, true)} · ${item.attempts} محاولة</small>${item.last_error ? `<div class="meta-line"><span>${esc(item.last_error)}</span></div>` : ""}</div>${status(item.status)}${["pending", "failed"].includes(item.status) ? `<button class="button button-small" data-action="retry-job" data-id="${esc(item.id)}">إعادة المحاولة</button>` : ""}</article>`).join("");
  return `${head("التكاملات", "صف المهام", "متابعة المهام البطيئة بعيدًا عن أزرار المستخدم", `<button class="button" data-action="refresh">${icon("refresh")}تحديث</button>`)}<section class="data-list">${rows || `<div class="empty"><div><b>الصف فارغ</b><p>لا توجد مهام خارجية حاليًا.</p></div></div>`}</section>${pager("jobs", data.pagination)}`;
}

async function audit() {
  const data = await api.audit(`?limit=25&offset=${state.offsets.audit ?? 0}`);
  const rows = data.items.map((item) => `<article class="list-row"><span class="avatar">${icon("audit")}</span><div class="row-main"><b>${esc(item.action)}</b><small>${esc(item.actor_name ?? item.actor_email ?? item.actor_type)} · ${date(item.created_at, true)}</small><div class="meta-line"><span>${esc(item.tenant_name ?? "المنصة")}</span>${item.reason ? `<i></i><span>${esc(item.reason)}</span>` : ""}</div></div><span class="owner-badge">${esc(item.entity_type)}</span></article>`).join("");
  return `${head("الحوكمة", "سجل التدقيق", "الأحداث الحساسة من كل الشبكات", `<button class="button" data-view="more">رجوع</button>`)}<section class="data-list">${rows || `<div class="empty">لا توجد أحداث</div>`}</section>${pager("audit", data.pagination)}`;
}

async function more() {
  return `${head("إعدادات المالك", "المزيد", "خيارات قليلة ومباشرة")}
  <section class="quick-grid"><button class="quick-card" data-view="audit"><span class="quick-icon">${icon("audit")}</span><b>سجل التدقيق</b><small>مراجعة كل قرار</small></button><button class="quick-card" data-action="theme"><span class="quick-icon">${icon("theme")}</span><b>المظهر</b><small>فاتح أو داكن</small></button><button class="quick-card" data-action="logout"><span class="quick-icon">${icon("logout")}</span><b>تسجيل الخروج</b><small>إلغاء الجلسة الحالية</small></button></section>`;
}

const loaders = { dashboard, tenants: () => tenants("all"), subscriptions: () => tenants("subscriptions"), jobs, more, audit, tenantDetails };


function pager(view, data) {
  if (!data) return "";
  const { total, offset, limit } = data;
  return `<div class="toolbar" aria-label="صفحات النتائج"><button class="button" data-action="page" data-view="${view}" data-offset="${Math.max(0, offset - limit)}" ${offset === 0 ? "disabled" : ""}>السابق</button><span>${total ? offset + 1 : 0}–${Math.min(total, offset + limit)} / ${total}</span><button class="button" data-action="page" data-view="${view}" data-offset="${offset + limit}" ${offset + limit >= total ? "disabled" : ""}>التالي</button></div>`;
}

async function tenantDetails() {
  if (!state.tenantId) return tenants();
  const item = await api.tenant(state.tenantId);
  const subscription = item.subscription;
  const metric = (label, value) => `<article class="metric-card"><small>${esc(label)}</small><strong>${esc(value)}</strong></article>`;
  const list = (title, rows) => `<section class="panel"><div class="panel-head"><h2>${esc(title)}</h2></div><div class="data-list">${rows.join("") || '<div class="empty">لا توجد سجلات</div>'}</div></section>`;
  const row = (title, subtitle, state) => `<article class="list-row"><div class="row-main"><b>${esc(title)}</b><small>${esc(subtitle)}</small></div>${status(state)}</article>`;
  return head("تفاصيل الشبكة", item.name, item.slug, '<button class="button" data-view="tenants">رجوع</button>')
    + `<section class="metrics-grid">${metric("المشتركون", item.usage.subscribers)}${metric("الجلسات النشطة", item.usage.activeSessions)}${metric("الأجهزة", item.usage.devices)}${metric("تذاكر مفتوحة", item.usage.openTickets)}${metric("المتبقي للتحصيل", new Intl.NumberFormat("ar", { style: "currency", currency: item.currency }).format(item.usage.outstandingMinor / 100))}</section>`
    + list("الاشتراك", subscription ? [row(subscription.product.nameAr, `ينتهي ${date(subscription.endsAt)}`, subscription.status), `<div class="panel-body"><button class="button" data-action="subscription" data-id="${esc(item.id)}" data-status="${esc(subscription.status)}">إدارة الاشتراك</button></div>`] : [])
    + list("الفريق", item.members.map((member) => row(member.displayName, member.email, member.status)))
    + list("التكاملات", item.integrations.map((integration) => row(integration.type, integration.lastError ?? date(integration.lastSeenAt, true), integration.status)))
    + list("عقد RADIUS", item.radiusNodes.map((node) => row(node.name, node.lastError ?? date(node.lastSeenAt, true), node.status)));
}

function retryJob(button) {
  dialog({ kicker: "متابعة التكاملات", title: "إعادة محاولة المهمة", submitText: "إدراج للمحاولة",
    body: '<div class="inline-message">ستُدرج المهمة مجددًا في صف المعالجة. راجع سبب الفشل قبل المتابعة.</div><div class="field"><label>سبب إعادة المحاولة<textarea name="reason" required minlength="5" maxlength="500"></textarea></label></div>',
    onSubmit: async (form) => { await api.retryJob(button.dataset.id, { reason: form.get("reason") }); invalidate("jobs", "audit", "dashboard"); toast("أُدرجت المهمة للمحاولة"); await navigate("jobs", true); } });
}

async function addTenant() {
  const products = (await api.products()).products;
  dialog({ kicker: "Onboarding", title: "إضافة شبكة", submitText: "إنشاء وبدء التجربة", body: `<div class="field-row"><div class="field"><label>اسم الشبكة</label><input name="name" required minlength="2" maxlength="120"></div><div class="field"><label>المعرّف Slug</label><input name="slug" dir="ltr" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*"></div></div><div class="field-row"><div class="field"><label>اسم المالك</label><input name="ownerName" required minlength="2"></div><div class="field"><label>بريد المالك</label><input name="ownerEmail" type="email" dir="ltr" required></div></div><div class="field-row"><div class="field"><label>العملة</label><input name="currency" value="USD" minlength="3" maxlength="3" required></div><div class="field"><label>المنطقة الزمنية</label><input name="timeZone" value="Asia/Damascus" required></div></div><div class="field"><label>الخطة</label><select name="productId">${products.map((p) => `<option value="${p.id}">${esc(p.nameAr)}</option>`).join("")}</select></div><div class="field"><label>سبب الإنشاء</label><textarea name="reason" minlength="5" required>تهيئة عميل جديد بعد التحقق</textarea></div>`, onSubmit: async (form) => {
    await api.createTenant(Object.fromEntries(form)); invalidate("dashboard", "tenants", "subscriptions", "tenantDetails", "audit"); toast("تم إنشاء الشبكة وبدء الفترة التجريبية"); await navigate("tenants", true);
  }});
}

function changeSubscription(button) {
  dialog({ kicker: "قرار اشتراك", title: "تحديث حالة الاشتراك", submitText: "حفظ القرار", body: `<div class="field"><label>الحالة الجديدة</label><select name="status"><option value="active">فعال</option><option value="trialing">تجريبي</option><option value="grace">مهلة</option><option value="past_due">متأخر</option><option value="canceled">ملغي</option><option value="expired">منتهي</option></select></div><div class="field"><label>تاريخ النهاية (اختياري)</label><input name="endsAt" type="datetime-local"></div><div class="field"><label>سبب القرار</label><textarea name="reason" minlength="5" required></textarea></div>`, onSubmit: async (form) => {
    const endsAt = form.get("endsAt") ? new Date(form.get("endsAt")).toISOString() : null;
    await api.subscriptionStatus(button.dataset.id, { status: form.get("status"), endsAt, reason: form.get("reason") }); invalidate("dashboard", "tenants", "subscriptions", "tenantDetails", "audit"); toast("تم تحديث الاشتراك وتوثيق القرار"); await navigate(state.view, true);
  }});
}

function changeTenantStatus(button) {
  const suspending = button.dataset.status === "suspended";
  dialog({ kicker: "عملية حساسة", title: suspending ? "إيقاف الشبكة" : "إعادة تفعيل الشبكة", submitText: suspending ? "إيقاف" : "تفعيل", danger: suspending, body: `<div class="inline-message ${suspending ? "danger" : "warning"}">${suspending ? "سيُمنع تشغيل الشبكة حتى إعادة تفعيلها." : "ستعود الشبكة إلى الحالة الفعالة."}</div><div class="field"><label>سبب القرار</label><textarea name="reason" minlength="5" required></textarea></div>`, onSubmit: async (form) => {
    await api.tenantStatus(button.dataset.id, { status: button.dataset.status, reason: form.get("reason") }); invalidate("dashboard", "tenants", "subscriptions", "tenantDetails", "audit"); toast("تم حفظ القرار في سجل التدقيق"); await navigate(state.view, true);
  }});
}

function rotateRadiusKey(button) {
  dialog({ kicker: "مفتاح خاص بالشبكة", title: "إصدار مفتاح جديد لوكيل RADIUS", submitText: "إصدار المفتاح", danger: true, body: `<div class="inline-message warning">سيتوقف أي وكيل يستخدم المفتاح القديم فورًا. سيظهر المفتاح الجديد مرة واحدة فقط.</div><div class="field"><label>سبب التدوير</label><textarea name="reason" minlength="10" maxlength="500" required>تهيئة وكيل RADIUS للشبكة بعد التحقق</textarea></div>`, onSubmit: async (form) => {
    const issued = await api.rotateRadiusCredential(button.dataset.id, { reason: form.get("reason") });
    invalidate("audit");
    setTimeout(() => dialog({ kicker: `الشبكة: ${issued.tenantSlug}`, title: "احفظ المفتاح الآن", submitText: "حفظتُه في مدير الأسرار", body: `<div class="inline-message warning">لن يعرض الخادم هذا المفتاح مرة ثانية. ضعه في ملف الوكيل بصلاحية 0600.</div><div class="field"><label>RADIUS_AGENT_SIGNING_SECRET</label><textarea id="radius-issued-secret" dir="ltr" readonly rows="3">${esc(issued.connectorSecret)}</textarea></div><button type="button" class="button button-wide" data-action="copy-radius-secret">نسخ المفتاح</button>`, onSubmit: async () => {} }), 0);
  }});
}

async function establish(result) {
  state.requestVersion++; state.cache.clear(); state.warming.clear(); state.warmScheduled = false;
  state.me = null; state.offsets = {}; state.tenantId = null;
  if (session.token !== result.token) session.clear();
  session.token = result.token;
  const me = await api.me();
  if (session.token !== result.token) return;
  state.me = me;
  if (state.me.user.platformRole !== "platform_owner") { session.clear(); state.me = null; throw new ApiError(403, "FORBIDDEN", "هذا الحساب ليس مالك المنصة"); }
  $("#login-view").hidden = true; $("#app-shell").hidden = false; await navigate(location.hash.slice(1) || "dashboard"); scheduleWarmViews();
}

async function logout(callApi = true, message = "") {
  const revoke = callApi && session.token ? api.logout() : Promise.resolve();
  const nativeSignOut = isNativeRuntime ? window.UchihaNativeAuth?.signOut().catch(() => {}) : Promise.resolve();
  state.requestVersion++; state.me = null; state.offsets = {}; state.tenantId = null;
  session.clear(); state.cache.clear(); state.warming.clear(); state.warmScheduled = false;
  $("#main-content").textContent = ""; closeDialog();
  $("#app-shell").hidden = true; $("#login-view").hidden = false;
  $("#login-status").textContent = message; busy($("#dev-login"), false);
  await Promise.all([nativeSignOut, revoke.catch(() => { if (!session.token) $("#login-status").textContent = "تم الخروج محليًا، وتعذر تأكيد إلغاء الجلسة على الخادم."; })]);
}

async function setupGoogle(clientId) {
  const script = document.createElement("script"); script.src = "https://accounts.google.com/gsi/client"; script.async = true;
  script.onload = () => { google.accounts.id.initialize({ client_id: clientId, callback: async ({ credential }) => { try { await establish(await api.googleLogin(credential)); } catch (error) { $("#login-status").textContent = error.message; } } }); google.accounts.id.renderButton($("#google-login"), { theme: "outline", size: "large", shape: "pill", locale: "ar", width: 300 }); };
  document.head.append(script);
}

async function setupNativeGoogle(clientId) {
  if (!window.UchihaNativeAuth) throw new Error("موصل Google الأصلي غير متاح");
  await window.UchihaNativeAuth.initializeGoogle(clientId);
  $("#google-login").innerHTML = `<button type="button" class="native-google-button" data-action="native-google-login"><span aria-hidden="true">G</span><b>المتابعة بواسطة Google</b></button>`;
}

async function nativeGoogleLogin(button) {
  busy(button, true);
  $("#login-status").textContent = "";
  try {
    const credential = await window.UchihaNativeAuth.signInWithGoogle(state.meta.googleClientId);
    await establish(await api.googleLogin(credential));
  } catch (error) {
    const canceled = /cancel|dismiss/i.test(`${error?.code ?? ""} ${error?.message ?? ""}`);
    $("#login-status").textContent = canceled ? "تم إلغاء تسجيل الدخول" : (error?.message ?? "تعذر تسجيل الدخول بواسطة Google");
  } finally { busy(button, false); }
}

document.addEventListener("click", async (event) => {
  const view = event.target.closest("[data-view]:not([data-action])"); if (view && !view.disabled) return navigate(view.dataset.view);
  const button = event.target.closest("[data-action]"); if (!button || button.disabled) return;
  if (button.dataset.action === "page") { state.offsets[button.dataset.view] = Math.max(0, Number(button.dataset.offset) || 0); return navigate(button.dataset.view, true); }
  if (button.dataset.action === "tenant-details") { state.tenantId = button.dataset.id; return navigate("tenantDetails", true); }
  if (button.dataset.action === "retry-job") return retryJob(button);
  if (button.dataset.action === "refresh") { invalidate(state.view); return navigate(state.view, true); }
  if (button.dataset.action === "close-dialog") return closeDialog();
  if (button.dataset.action === "add-tenant") return addTenant().catch((error) => toast(error.message, "error"));
  if (button.dataset.action === "subscription") return changeSubscription(button);
  if (button.dataset.action === "radius-key") return rotateRadiusKey(button);
  if (button.dataset.action === "tenant-status") return changeTenantStatus(button);
  if (button.dataset.action === "copy-radius-secret") { const value = $("#radius-issued-secret")?.value; if (value) { try { if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable"); await navigator.clipboard.writeText(value); toast("تم نسخ المفتاح"); } catch { $("#radius-issued-secret").select(); toast("حدّدنا المفتاح؛ انسخه من قائمة الجهاز", "error"); } } return; }
  if (button.dataset.action === "theme") { const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = theme; try { localStorage.setItem("uchiha-theme", theme); } catch { /* Local preference is optional. */ } return; }
  if (button.dataset.action === "native-google-login") return nativeGoogleLogin(button);
  if (button.dataset.action === "logout") return logout();
});

document.addEventListener("pointerdown", (event) => {
  const view = event.target.closest("[data-view]");
  if (view && !view.disabled) prefetchView(view.dataset.view);
}, { passive: true });

$("#dev-login").addEventListener("click", async (event) => { const button = event.currentTarget; busy(button, true); try { await establish(await api.devLogin()); } catch (error) { $("#login-status").textContent = error.message; } finally { busy(button, false); } });
$("#dialog").addEventListener("click", (event) => { if (event.target === $("#dialog")) closeDialog(); });

async function boot() {
  try { document.documentElement.dataset.theme = localStorage.getItem("uchiha-theme") ?? "light"; } catch { document.documentElement.dataset.theme = "light"; }
  try { state.meta = await api.meta(); $("#dev-login").hidden = !state.meta.devAuthAvailable; if (state.meta.googleClientId) { const setup = isNativeRuntime ? setupNativeGoogle : setupGoogle; setup(state.meta.googleClientId).catch(() => { $("#login-status").textContent = "تعذر تحميل تسجيل Google"; }); } if (session.token) await establish({ token: session.token }); }
  catch (error) { if (session.token) session.clear(); $("#login-status").textContent = error.message ?? "الخادم غير متاح"; }
  if (!isNativeRuntime && "serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/owner/sw.js").catch(() => {});
}

window.addEventListener("hashchange", () => navigate(location.hash.slice(1) || "dashboard"));
boot();
