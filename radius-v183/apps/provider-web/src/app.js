import { api, ApiError, session, request } from "./api.js";
import { createOperations } from "./operations.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const isNativeRuntime = Boolean(document.querySelector('meta[name="uchiha-runtime"][content="native"]'));

const state = {
  meta: null,
  me: null,
  view: "dashboard",
  cache: new Map(),
  warming: new Map(),
  requestVersion: 0,
  toastTimer: null,
  warmScheduled: false,
  offsets: {}, subscriberQuery: { q: "", status: "all" }
};

const viewParents = {
  dashboard: "dashboard", subscribers: "subscribers", sessions: "sessions", billing: "billing", more: "more",
  plans: "more", devices: "more", telegram: "more", team: "more", audit: "more", subscriptions: "more"
};

const statusLabels = {
  active: "فعّال", trialing: "تجريبي", grace: "مهلة", pending: "قيد الإعداد", past_due: "متأخر",
  canceled: "ملغي", expired: "منتهي", suspended: "موقوف", online: "متصل", offline: "غير متصل",
  error: "خطأ", stopped: "منتهية", unpaid: "غير مدفوعة", partial: "جزئية", paid: "مدفوعة",
  open: "مفتوح", acknowledged: "تمت المراجعة", resolved: "محلول", inactive: "متوقف", disabled: "معطل",
  available: "متاح", assigned: "مخصص", used: "مستخدم", revoked: "ملغى", in_progress: "قيد المعالجة",
  closed: "مغلق", healthy: "سليم", degraded: "يحتاج متابعة", not_configured: "غير مربوط", void: "ملغاة", archived: "مؤرشفة"
};

const roleLabels = { owner: "مالك الشبكة", admin: "مدير", operator: "مشغّل", collector: "محصّل", viewer: "مشاهدة" };

function readPreference(key) {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function writePreference(key, value) {
  try { localStorage.setItem(key, value); }
  catch { /* The interface still works when a preview viewer blocks storage. */ }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function icon(name) {
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M18.5 9A7 7 0 0 0 6.8 6.8L4 9m16 6-2.8 2.2A7 7 0 0 1 5.5 15"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19v-1A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V19M16 7a2.5 2.5 0 0 1 0 5M17 14.5A3.5 3.5 0 0 1 20.5 18"/>',
    signal: '<path d="M5 8.5a9 9 0 0 1 14 0M8 12a5.5 5.5 0 0 1 8 0M11 15.5a1.5 1.5 0 1 1 2 0M12 17v3"/>',
    wallet: '<path d="M4 7h14a2 2 0 0 1 2 2v9H4a2 2 0 0 1-2-2V7a3 3 0 0 1 3-3h12v3M15 12h5v4h-5a2 2 0 1 1 0-4"/>',
    plan: '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/>',
    router: '<rect x="3" y="9" width="18" height="10" rx="2"/><path d="M7 9V5m10 4V5M7 15h.01M11 15h.01M15 15h2"/>',
    telegram: '<path d="m3 11 17-7-4 16-5-6-4 3 1-5 8-5-10 7z"/>',
    audit: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h6M9 16h6"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 2.8 8 7 10 4.2-2 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
    bell: '<path d="M6 10a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 20h4"/>',
    arrow: '<path d="m15 18-6-6 6-6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    bolt: '<path d="m13 2-8 12h7l-1 8 8-12h-7z"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.arrow}</svg>`;
}

function money(minor, currency = state.me?.tenantCurrency ?? "USD") {
  try {
    return new Intl.NumberFormat("ar", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(minor ?? 0) / 100);
  } catch {
    return `${Number(minor ?? 0) / 100} ${currency}`;
  }
}

function date(value, includeTime = false) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("ar", includeTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(parsed);
}

function status(value) {
  return `<span class="status-pill status-${escapeHtml(value)}">${escapeHtml(statusLabels[value] ?? value ?? "—")}</span>`;
}

function initial(value) {
  return escapeHtml(String(value ?? "؟").trim().charAt(0) || "؟");
}

function pageHead(kicker, title, description, actions = "") {
  return `<header class="page-head"><div><p class="eyebrow">${escapeHtml(kicker)}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</header>`;
}

function skeleton() {
  return `${pageHead("UCHIHA RADIUS", "لحظة واحدة", "نجلب أحدث البيانات من الخادم")}
    <div class="skeleton-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`;
}

function renderError(error) {
  const message = error instanceof ApiError ? error.message : "تعذر تحميل البيانات";
  return `${pageHead("تعذر التحميل", "لم تكتمل العملية", message)}<div class="panel empty">${icon("refresh")}<div><b>يمكن المحاولة الآن</b><p>تحقق من اتصال الخادم ثم أعد التحميل.</p><button class="button button-primary" data-action="refresh">إعادة المحاولة</button></div></div>`;
}

function updateSubscriptionStrip() {
  const subscription = state.me?.subscription;
  const label = $("#subscription-label");
  const pill = $("#subscription-state");
  label.textContent = subscription ? `${subscription.productName} · حتى ${date(subscription.endsAt)}` : "اختر باقة للمتابعة";
  pill.textContent = statusLabels[subscription?.status] ?? "غير مشترك";
  pill.className = `status-pill status-${subscription?.status ?? "neutral"}`;
}

function showToast(message, type = "success") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show${type === "error" ? " error" : ""}`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { toast.className = "toast"; }, 3000);
}

function setBusy(button, busy, label = "جارٍ الحفظ…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText ?? button.textContent;
    button.disabled = false;
  }
}

function openDrawer() {
  $("#drawer-backdrop").hidden = false;
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  $("#drawer").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
  setTimeout(() => { if (!$("#drawer").classList.contains("open")) $("#drawer-backdrop").hidden = true; }, 170);
}

function closeDialog() {
  const dialog = $("#dialog");
  if (dialog.open) dialog.close();
  $("#dialog-body").textContent = "";
  $("#dialog-actions").textContent = "";
  $("#dialog-form").onsubmit = null;
}

function openDialog({ kicker, title, body, submitText = "حفظ", submitClass = "button-primary", onSubmit }) {
  $("#dialog-kicker").textContent = kicker;
  $("#dialog-title").textContent = title;
  $("#dialog-body").innerHTML = body;
  $("#dialog-actions").innerHTML = `<button type="button" class="button" data-action="close-dialog">إلغاء</button><button type="submit" class="button ${submitClass}">${escapeHtml(submitText)}</button>`;
  const form = $("#dialog-form");
  form.onsubmit = async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    setBusy(submit, true);
    try {
      await onSubmit(new FormData(form));
      closeDialog();
    } catch (error) {
      showToast(error.message ?? "تعذر حفظ العملية", "error");
      setBusy(submit, false);
    }
  };
  $("#dialog").showModal();
  setTimeout(() => $("#dialog-body input, #dialog-body select, #dialog-body textarea")?.focus(), 30);
}

function invalidate(...views) {
  for (const view of views) {
    state.cache.delete(view);
    state.warming.delete(view);
  }
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
    for (const view of ["subscribers", "sessions", "billing", "more", "subscriptions"]) {
      if (!state.me || session.token !== token) break;
      try { await loadAndCache(view); } catch { /* A later tap will show the normal retry state. */ }
    }
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(() => warm(), { timeout: 800 });
  else setTimeout(warm, 120);
}

async function refreshContext() {
  const token = session.token;
  const me = await api.me();
  if (!token || session.token !== token) return;
  state.me = me;
  if (!session.tenantId && state.me.tenantId) session.tenantId = state.me.tenantId;
  updateSubscriptionStrip();
}

async function navigate(view, { force = false, updateHash = true } = {}) {
  if (!state.me) return;
  const requestVersion = ++state.requestVersion;
  if (!loaders[view]) view = "dashboard";
  const permission = viewPermissions[view];
  if (permission && !state.me.permissions.includes(permission)) {
    showToast("هذا القسم غير متاح لصلاحيات حسابك", "error"); return;
  }
  if (force) invalidate(view);
  state.view = view;
  if (updateHash) {
    try { history.replaceState(null, "", `#${view}`); }
    catch { /* Some local preview viewers do not expose writable history. */ }
  }
  $$(".nav-button").forEach((button) => {
    const active = button.dataset.view === viewParents[view];
    button.classList.toggle("active", active);
    active ? button.setAttribute("aria-current", "page") : button.removeAttribute("aria-current");
  });
  closeDrawer();
  const content = $("#main-content");
  const cached = cachedView(view);
  content.innerHTML = cached ?? skeleton();
  applyAccess();
  content.focus({ preventScroll: true });
  try { window.scrollTo({ top: 0, behavior: "auto" }); }
  catch { window.scrollTo(0, 0); }
  if (cached !== null) return;
  try {
    const html = await loadAndCache(view);
    if (requestVersion !== state.requestVersion || state.view !== view) return;
    content.innerHTML = html;
    applyAccess();
  } catch (error) {
    if (requestVersion !== state.requestVersion || !state.me) return;
    if (error.status === 401) return logout(false);
    if (requestVersion === state.requestVersion) content.innerHTML = renderError(error);
  }
}

async function dashboardView() {
  const data = await api.dashboard();
  const m = data.metrics;
  const alerts = data.alerts.length ? data.alerts.map((alert) => `<div class="alert-row" data-alert-id="${escapeHtml(alert.id)}"><i class="severity ${escapeHtml(alert.severity)}"></i><div class="row-main"><b>${escapeHtml(alert.title)}</b><small>${escapeHtml(alert.body)}</small></div><button class="button button-small" data-action="ack-alert" data-id="${escapeHtml(alert.id)}">راجعتُه</button></div>`).join("") : `<div class="empty">${icon("shield")}<div><b>كل شيء هادئ</b><p>لا توجد تنبيهات مفتوحة حاليًا.</p></div></div>`;
  return `${pageHead("صباح العمل", `مرحبًا، ${state.me.user.displayName}`, `آخر قراءة من ${data.tenant.name}`)}
    <section class="metrics-grid">
      <article class="metric-card"><small>كل المشتركين</small><strong>${m.subscribers}</strong><span>${m.activeSubscribers} حسابًا فعّالًا</span></article>
      <article class="metric-card teal"><small>الجلسات الآن</small><strong>${m.activeSessions}</strong><span>اتصال نشط</span></article>
      <article class="metric-card amber"><small>التحصيل المتبقي</small><strong>${money(m.outstandingMinor)}</strong><span>${m.openInvoices} فاتورة مفتوحة</span></article>
      <article class="metric-card purple"><small>أجهزة الشبكة</small><strong>${m.onlineDevices}/${m.devices}</strong><span>متصل الآن</span></article>
    </section>
    <section class="content-grid">
      <article class="panel"><div class="panel-head"><div><h2>نبض التشغيل</h2><p>التنبيهات التي تحتاج قرارًا</p></div></div>${alerts}</article>
      <aside class="panel"><div class="panel-head"><div><h2>إجراء سريع</h2><p>الخيارات الأكثر استخدامًا</p></div></div><div class="panel-body" style="display:grid;gap:8px"><button class="button button-primary button-wide" data-action="add-subscriber">${icon("plus")}إضافة مشترك</button><button class="button button-wide" data-view="sessions">${icon("signal")}الجلسات الحية</button><button class="button button-wide" data-view="billing">${icon("wallet")}متابعة التحصيل</button></div></aside>
    </section>`;
}

async function subscribersView(search = state.subscriberQuery.q, filter = state.subscriberQuery.status) {
  const query = new URLSearchParams({ limit: "25", offset: String(state.offsets.subscribers ?? 0) });
  if (search) query.set("q", search);
  if (filter !== "all") query.set("status", filter);
  const data = await api.subscribers(query.size ? `?${query}` : "");
  const rows = data.items.length ? data.items.map((item) => `<article class="list-row" data-subscriber-id="${escapeHtml(item.id)}">
    <span class="avatar">${initial(item.fullName)}</span><div class="row-main"><b>${escapeHtml(item.fullName)}</b><small dir="ltr">${escapeHtml(item.username)} · ${escapeHtml(item.phone ?? "بدون هاتف")}</small><div class="meta-line"><span>${escapeHtml(item.plan?.name ?? "بلا باقة")}</span><i></i><span>${money(item.balanceMinor)}</span></div></div>
    ${status(item.status)}<div class="row-actions"><button class="mini-button" data-action="subscriber-details" data-id="${item.id}" aria-label="تفاصيل">${icon("arrow")}</button>${item.status === "active" ? `<button class="mini-button danger" data-action="subscriber-status" data-id="${item.id}" data-status="suspend" aria-label="تعليق">${icon("close")}</button>` : `<button class="mini-button" data-action="subscriber-status" data-id="${item.id}" data-status="activate" aria-label="تفعيل">${icon("check")}</button>`}</div>
  </article>`).join("") : `<div class="empty">${icon("users")}<div><b>لا توجد نتائج</b><p>غيّر البحث أو أضف أول مشترك.</p></div></div>`;
  return `${pageHead("إدارة الحسابات", "المشتركون", `${data.pagination.total} مشتركًا ضمن الشبكة`, `<button class="button button-primary" data-action="add-subscriber">${icon("plus")}مشترك جديد</button>`)}
    <form class="toolbar" id="subscriber-search"><label class="search-field">${icon("search")}<input name="q" value="${escapeHtml(search)}" placeholder="الاسم أو اسم المستخدم أو الهاتف" autocomplete="off"></label><select class="filter-select" name="status"><option value="all" ${filter === "all" ? "selected" : ""}>كل الحالات</option><option value="active" ${filter === "active" ? "selected" : ""}>فعال</option><option value="suspended" ${filter === "suspended" ? "selected" : ""}>موقوف</option><option value="expired" ${filter === "expired" ? "selected" : ""}>منتهي</option></select><button class="button" type="submit">بحث</button></form>
    <section class="data-list">${rows}</section>${listPager("subscribers", data.pagination)}`;
}

async function sessionsView() {
  const data = await api.sessions(`?limit=25&offset=${state.offsets.sessions ?? 0}`);
  const rows = data.items.length ? data.items.map((item) => `<article class="list-row"><span class="avatar teal">${icon("signal")}</span><div class="row-main"><b dir="ltr">${escapeHtml(item.username)}</b><small dir="ltr">${escapeHtml(item.framed_ip ?? "—")} · NAS ${escapeHtml(item.nas_ip ?? "—")}</small><div class="meta-line"><span>بدأت ${date(item.started_at, true)}</span><i></i><span>${formatBytes(Number(item.input_bytes) + Number(item.output_bytes))}</span></div></div>${status(item.status)}${item.status === "active" ? `<button class="button button-small" data-action="disconnect" data-id="${item.id}">فصل</button>` : ""}</article>`).join("") : `<div class="empty">${icon("signal")}<div><b>لا توجد جلسات</b><p>ستظهر جلسات RADIUS هنا بعد وصول Accounting.</p></div></div>`;
  const active = data.items.filter((item) => item.status === "active").length;
  return `${pageHead("المراقبة المباشرة", "الجلسات", `${active} جلسة فعّالة في هذه الصفحة`, `<button class="button" data-action="refresh">${icon("refresh")}تحديث</button>`)}<section class="data-list">${rows}</section>${listPager("sessions", data.pagination)}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function openCheckout(url) {
  try {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.username || target.password) throw new Error("invalid checkout URL");
    window.location.assign(target.href);
  } catch {
    showToast("رابط الدفع غير صالح، أعد المحاولة", "error");
  }
}

async function waitForCheckout(subscriptionId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const request = await api.subscriptionRequest(subscriptionId);
    if (request.checkoutStatus !== "processing") return request;
  }
  return null;
}

async function billingView() {
  const data = await api.invoices(`?limit=25&offset=${state.offsets.billing ?? 0}`);
  const outstanding = data.items.reduce((sum, item) => sum + Math.max(0, Number(item.amountMinor) - Number(item.paidMinor)), 0);
  const rows = data.items.length ? data.items.map((item) => `<article class="list-row" data-invoice-id="${escapeHtml(item.id)}" data-paid="${Number(item.paidMinor)}" data-invoice-status="${escapeHtml(item.status)}"><span class="avatar amber">${icon("wallet")}</span><div class="row-main"><b>${escapeHtml(item.subscriberName)}</b><small>${escapeHtml(item.number)} · الاستحقاق ${date(item.dueAt)}</small><div class="meta-line"><span>المدفوع ${money(item.paidMinor, item.currency)}</span><i></i><span>من ${money(item.amountMinor, item.currency)}</span></div></div>${status(item.status)}${item.status !== "paid" && item.status !== "void" ? `<button class="button button-small button-primary" data-action="pay" data-id="${item.id}" data-remaining="${Number(item.amountMinor) - Number(item.paidMinor)}" data-currency="${escapeHtml(item.currency)}">دفعة</button>` : ""}</article>`).join("") : `<div class="empty">${icon("wallet")}<div><b>لا توجد فواتير</b><p>ستظهر دورة التحصيل هنا.</p></div></div>`;
  return `${pageHead("المال بوضوح", "التحصيل", `المتبقي في هذه الصفحة ${money(outstanding)}`, `<button class="button" data-view="payments">الدفعات</button><button class="button" data-action="ops-add-invoice">فاتورة جديدة</button><button class="button" data-action="ops-generate-invoices">فواتير الدورة</button>`)}<section class="data-list">${rows}</section>${listPager("billing", data.pagination)}`;
}

async function moreView() {
  return `${pageHead("الأدوات المنظمة", "المزيد", "الخيارات الأقل استخدامًا في مكان واحد")}
    <section class="quick-grid">
      ${quickCard("plans", "plan", "الباقات", "السرعات والأسعار")}
      ${quickCard("devices", "router", "الأجهزة والربط", "MikroTik وRADIUS")}
      ${quickCard("team", "users", "الفريق", "الأدوار والصلاحيات")}
      ${quickCard("audit", "audit", "سجل النشاط", "تتبّع العمليات")}
      ${quickCard("sites", "router", "الفروع والشبكة", "الفروع وعناوين IP والسياسات")}
      ${quickCard("radius", "signal", "تشغيل RADIUS", "العقد والمصادقة والاستهلاك")}
      ${quickCard("vouchers", "plan", "البطاقات", "الإصدار والتصدير والإلغاء")}
      ${quickCard("resellers", "users", "الوكلاء", "الوكلاء ودفعات البطاقات")}
      ${quickCard("tickets", "shield", "الدعم والحوادث", "التذاكر والردود والمتابعة")}
      ${quickCard("reports", "audit", "التقارير", "التحصيل والاستهلاك والتشغيل")}
    </section>`;
}

function quickCard(view, iconName, title, description) {
  return `<button class="quick-card" data-view="${view}"><span class="quick-icon">${icon(iconName)}</span><b>${title}</b><small>${description}</small></button>`;
}

async function plansView() {
  const data = await api.plans();
  const cards = data.items.map((plan) => `<article class="plan-card" data-plan-id="${escapeHtml(plan.id)}"><div style="display:flex;justify-content:space-between;gap:8px"><h3>${escapeHtml(plan.name)}</h3>${status(plan.status)}</div><div class="plan-speed">${plan.speedDownMbps}<small> Mbps تنزيل</small></div><div class="plan-price">رفع ${plan.speedUpMbps} Mbps · ${money(plan.priceMinor)} / ${plan.billingCycle === "monthly" ? "شهر" : "دورة"}</div></article>`).join("");
  return `${pageHead("إعداد الخدمة", "الباقات", "باقات المشتركين وسرعاتها", `<button class="button" data-view="more">رجوع</button><button class="button button-primary" data-action="add-plan">${icon("plus")}باقة</button>`)}<section class="cards-grid">${cards || `<div class="empty">لا توجد باقات</div>`}</section>`;
}

async function devicesView() {
  const data = await api.devices();
  const cards = data.items.map((device) => `<article class="device-card" data-device-id="${escapeHtml(device.id)}"><div style="display:flex;justify-content:space-between;gap:8px"><h3>${escapeHtml(device.name)}</h3>${status(device.status)}</div><div class="device-meta"><span>الفرع <b>${escapeHtml(device.branch ?? "—")}</b></span><span>العنوان <b>${escapeHtml(device.host)}:${device.api_port}</b></span><span>طريقة الربط <b>${escapeHtml(device.connection_method)}</b></span><span>آخر اتصال <b>${date(device.last_seen_at, true)}</b></span></div></article>`).join("");
  return `${pageHead("البنية الشبكية", "الأجهزة والربط", "الأسرار مشفرة ولا تظهر بعد الحفظ", `<button class="button" data-view="more">رجوع</button><button class="button button-primary" data-action="add-device">${icon("plus")}جهاز</button>`)}<section class="cards-grid">${cards || `<div class="empty">لا توجد أجهزة</div>`}</section>`;
}

async function telegramView() {
  const integration = await api.telegram();
  const connected = integration.status === "active";
  return `${pageHead("التنبيهات الموحدة", "بوت Telegram", "مدخل واحد للتنبيهات والأوامر البسيطة", `<button class="button" data-view="more">رجوع</button>`)}
    <section class="content-grid"><article class="panel"><div class="panel-head"><span class="quick-icon">${icon("telegram")}</span><div><h2>${connected ? "البوت متصل" : "البوت غير متصل"}</h2><p>${connected ? escapeHtml(integration.chatLabel ?? "Telegram") : "أدخل رقم المحادثة بعد إنشاء البوت"}</p></div>${status(connected ? "active" : "pending")}</div><div class="panel-body"><div class="inline-message">الأوامر المتاحة للقراءة فقط: /status و/alerts و/subscriber. الأوامر الحساسة لا تُنفذ من Telegram.</div><button class="button button-primary button-wide" style="margin-top:12px" data-action="configure-telegram">${connected ? "تحديث الإعداد" : "ربط المحادثة"}</button>${connected ? '<div class="toolbar"><button class="button" data-action="ops-telegram-test">اختبار التنبيه</button><button class="button" data-action="ops-telegram-disable">إيقاف الربط</button></div>' : ""}</div></article><aside class="panel"><div class="panel-head"><div><h2>آخر اتصال</h2><p>${date(integration.lastSeenAt, true)}</p></div></div><div class="panel-body"><small style="color:var(--muted);line-height:1.8">رمز البوت يُضبط على الخادم فقط، ورقم المحادثة يُخزّن مشفرًا.</small></div></aside></section>`;
}

async function auditView() {
  const data = await api.audit(`?limit=25&offset=${state.offsets.audit ?? 0}`);
  const rows = data.items.length ? data.items.map((item) => `<article class="list-row"><span class="avatar">${icon("audit")}</span><div class="row-main"><b>${escapeHtml(item.action)}</b><small>${escapeHtml(item.actor_name ?? item.actor_email ?? item.actor_type ?? "النظام")} · ${date(item.created_at, true)}</small>${item.reason ? `<div class="meta-line"><span>السبب: ${escapeHtml(item.reason)}</span></div>` : ""}</div><span class="status-pill">${escapeHtml(item.entity_type)}</span></article>`).join("") : `<div class="empty">${icon("audit")}<div><b>السجل فارغ</b><p>تظهر العمليات الحساسة هنا تلقائيًا.</p></div></div>`;
  return `${pageHead("الشفافية", "سجل النشاط", "سجل غير قابل للتعديل من الواجهة", `<button class="button" data-view="more">رجوع</button>`)}<section class="data-list">${rows}</section>${listPager("audit", data.pagination)}`;
}

async function teamView() {
  const data = await api.team();
  const memberStatus = { active: "فعّال", invited: "مدعو", disabled: "معطّل" };
  const rows = data.items.map((member) => `<article class="list-row"><span class="avatar">${initial(member.displayName)}</span><div class="row-main"><b>${escapeHtml(member.displayName)}</b><small dir="ltr">${escapeHtml(member.email)}</small><div class="meta-line"><span>${escapeHtml(roleLabels[member.role] ?? member.role)}</span><i></i><span>${memberStatus[member.status] ?? member.status}</span></div></div>${status(member.status === "active" ? "active" : member.status === "disabled" ? "suspended" : "pending")}<button class="button button-small" data-action="edit-member" data-id="${member.id}" data-role="${member.role}" data-status="${member.status}" data-name="${escapeHtml(member.displayName)}">إدارة</button></article>`).join("");
  return `${pageHead("الوصول المنظم", "الفريق والصلاحيات", `${data.items.length} عضوًا ومدعوًا`, `<button class="button" data-view="more">رجوع</button><button class="button button-primary" data-action="invite-member">${icon("plus")}دعوة</button>`)}<section class="data-list">${rows}</section>`;
}

async function subscriptionsView() {
  const data = await api.products();
  const pending = data.pending;
  const pendingAction = pending?.checkoutStatus === "ready" && pending.checkoutUrl
    ? `<button class="button button-primary" data-action="open-checkout" data-url="${escapeHtml(pending.checkoutUrl)}">متابعة الدفع</button>`
    : pending?.checkoutStatus === "processing"
      ? `<button class="button" data-action="refresh">تحديث حالة الدفع</button>`
      : "";
  const pendingMessage = pending?.checkoutStatus === "ready"
    ? "صفحة الدفع الآمنة أصبحت جاهزة."
    : pending?.checkoutStatus === "processing"
      ? "يتم تجهيز صفحة الدفع في الخلفية دون تعطيل التطبيق."
      : "تم إرسال الطلب للمالك للمراجعة والتفعيل.";
  const pendingPanel = pending ? `<article class="panel subscription-request"><div><small>طلب اشتراك قيد المتابعة</small><b>${escapeHtml(pending.productName)}</b><span>${escapeHtml(pendingMessage)}</span></div>${pendingAction}</article>` : "";
  const cards = data.products.map((product) => {
    const current = data.current?.productCode === product.code;
    const requested = pending?.productCode === product.code;
    const disabled = current || requested || !state.me.permissions.includes("tenant:manage");
    return `<article class="product-card ${current ? "current" : ""}"><div style="display:flex;justify-content:space-between;gap:8px"><h3>${escapeHtml(product.nameAr)}</h3>${current ? status(data.current.status) : requested ? status("pending") : ""}</div><div class="product-price">${money(product.priceMinor, product.currency)} <small>/ شهر</small></div><div class="limits"><span>حتى ${product.limits.subscribers} مشترك</span><span>${product.limits.devices} أجهزة</span><span>${product.limits.team} أعضاء فريق</span></div><button class="button ${current || requested ? "" : "button-primary"} button-wide" data-action="select-product" data-id="${product.id}" ${disabled ? "disabled" : ""}>${current ? "الخطة الحالية" : requested ? "الطلب قيد المتابعة" : "اختيار الخطة"}</button></article>`;
  }).join("");
  return `${pageHead("خطة UCHIHA", "الاشتراك", data.canWrite ? "كل عمليات الشبكة متاحة" : "وضع التصفح فقط حتى تفعيل الاشتراك", `<button class="button" data-view="more">رجوع</button>`)}${!data.canWrite ? `<div class="inline-message warning" style="margin-bottom:14px">يمكنك تصفح البيانات، بينما الإضافة والربط والتنفيذ مقفلة من الخادم.</div>` : ""}${pendingPanel}<section class="cards-grid">${cards}</section>`;
}

const operations = createOperations({ request, context: () => state.me, escapeHtml, pageHead, status, date, money,
  formatBytes, openDialog, reasonAction, navigate, invalidate, showToast });
for (const view of Object.keys(operations.loaders)) viewParents[view] = view === "payments" ? "billing" : "more";
const viewPermissions = { dashboard: "tenant:read", subscribers: "subscriber:read", sessions: "session:read", billing: "billing:read",
  plans: "plan:read", devices: "device:read", telegram: "integration:read", team: "tenant:manage", audit: "audit:read",
  ...operations.readPermissions };
const actionPermissions = { "add-subscriber": "subscriber:write", "edit-subscriber": "subscriber:write", "subscriber-credential": "subscriber:write",
  "subscriber-status": "subscriber:suspend", disconnect: "session:disconnect", "add-plan": "plan:write", "edit-plan": "plan:write",
  "add-device": "device:write", "edit-device": "device:write", pay: "billing:write", "add-invoice": "billing:write", "void-invoice": "billing:write",
  "generate-invoices": "billing:write", "ack-alert": "alert:write", "resolve-alert": "alert:write", "configure-telegram": "integration:write",
  "telegram-test": "integration:write", "telegram-disable": "integration:write", "invite-member": "tenant:manage", "edit-member": "tenant:manage" };
function applyAccess() {
  augmentManagement();
  $$("[data-view]:not([data-action])").forEach((button) => {
    const permission = viewPermissions[button.dataset.view];
    button.disabled = Boolean(permission && !state.me?.permissions?.includes(permission));
    if (button.disabled) button.title = "غير متاح لهذا الدور"; else button.removeAttribute("title");
  });
  $$("[data-action]").forEach((button) => {
    const permission = actionPermissions[button.dataset.action.replace(/^ops-/, "")]; if (!permission) return;
    button.disabled = !state.me?.canWrite || !state.me.permissions.includes(permission);
    if (button.disabled) button.title = state.me?.canWrite ? "غير متاح لهذا الدور" : "الاشتراك الحالي يسمح بالمشاهدة فقط";
    else button.removeAttribute("title");
  });
}
function listPager(view, pagination) {
  if (!pagination) return "";
  const { total, offset, limit } = pagination;
  return `<div class="toolbar" aria-label="صفحات النتائج"><button class="button" data-action="page" data-view="${view}" data-offset="${Math.max(0, offset - limit)}" ${offset === 0 ? "disabled" : ""}>السابق</button><span>${total ? offset + 1 : 0}–${Math.min(total, offset + limit)} / ${total}</span><button class="button" data-action="page" data-view="${view}" data-offset="${offset + limit}" ${offset + limit >= total ? "disabled" : ""}>التالي</button></div>`;
}
function augmentManagement() {
  for (const [attribute, actions] of [
    ["data-subscriber-id", [["edit-subscriber", "تعديل"], ["subscriber-credential", "كلمة مرور RADIUS"]]],
    ["data-plan-id", [["edit-plan", "تعديل الباقة"]]],
    ["data-device-id", [["edit-device", "تعديل الربط"]]],
    ["data-invoice-id", [["void-invoice", "إلغاء الفاتورة"]]],
    ["data-alert-id", [["resolve-alert", "تم الحل"]]]
  ]) {
    $$(`[${attribute}]`, $("#main-content")).forEach((card) => {
      if (card.querySelector("[data-management-actions]")) return;
      if (attribute === "data-invoice-id" && (Number(card.dataset.paid) > 0 || card.dataset.invoiceStatus === "void")) return;
      const controls = document.createElement("div"); controls.className = "row-actions"; controls.dataset.managementActions = "true";
      controls.innerHTML = actions.map(([action, label]) => `<button class="button button-small" type="button" data-action="ops-${action}" data-id="${escapeHtml(card.getAttribute(attribute))}">${label}</button>`).join("");
      card.append(controls);
    });
  }
}
const loaders = {
  ...operations.loaders,
  dashboard: dashboardView,
  subscribers: subscribersView,
  sessions: sessionsView,
  billing: billingView,
  more: moreView,
  plans: plansView,
  devices: devicesView,
  telegram: telegramView,
  team: teamView,
  audit: auditView,
  subscriptions: subscriptionsView
};

async function addSubscriber() {
  const plans = (await api.plans()).items;
  openDialog({
    kicker: "حساب جديد", title: "إضافة مشترك", submitText: "إنشاء الحساب",
    body: `<div class="field-row"><div class="field"><label>اسم المشترك</label><input name="fullName" required minlength="2" maxlength="120"></div><div class="field"><label>اسم المستخدم في RADIUS</label><input name="username" dir="ltr" required minlength="3" maxlength="64" pattern="[A-Za-z0-9._@-]+"></div></div><div class="field-row"><div class="field"><label>الهاتف</label><input name="phone" dir="ltr" maxlength="40"></div><div class="field"><label>الباقة</label><select name="planId"><option value="">بدون باقة</option>${plans.map((plan) => `<option value="${plan.id}">${escapeHtml(plan.name)}</option>`).join("")}</select></div></div><div class="field"><label>العنوان</label><input name="address" maxlength="500"></div><div class="field"><label>كلمة مرور RADIUS (اختيارية أثناء الإعداد)<input name="radiusPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password"></label></div><div class="field"><label>انتهاء الخدمة (اختياري)<input name="serviceExpiresAt" type="datetime-local"></label></div><div class="inline-message">يُنشأ الحساب قيد الإعداد. أكمل كلمة مرور RADIUS والباقة ثم فعّله من قائمة المشتركين.</div>`,
    onSubmit: async (form) => {
      await api.createSubscriber({ fullName: form.get("fullName"), username: form.get("username"), phone: form.get("phone") || null, address: form.get("address") || null, planId: form.get("planId") || null, ...(form.get("radiusPassword") ? { radiusPassword: String(form.get("radiusPassword")) } : {}), serviceExpiresAt: form.get("serviceExpiresAt") ? new Date(form.get("serviceExpiresAt")).toISOString() : null });
      invalidate("dashboard", "subscribers");
      showToast("تم إنشاء المشترك قيد الإعداد");
      await navigate("subscribers", { force: true });
    }
  });
}

function addPlan() {
  openDialog({
    kicker: "خدمة جديدة", title: "إنشاء باقة", submitText: "حفظ الباقة",
    body: `<div class="field"><label>اسم الباقة</label><input name="name" required minlength="2" maxlength="80"></div><div class="field-row"><div class="field"><label>سرعة التنزيل Mbps</label><input name="down" type="number" min="1" max="100000" required></div><div class="field"><label>سرعة الرفع Mbps</label><input name="up" type="number" min="1" max="100000" required></div></div><div class="field-row"><div class="field"><label>السعر بوحدة السنت</label><input name="price" type="number" min="0" max="1000000000" required></div><div class="field"><label>الدورة</label><select name="cycle"><option value="monthly">شهري</option><option value="weekly">أسبوعي</option><option value="custom">مخصص</option></select></div></div>`,
    onSubmit: async (form) => {
      await api.createPlan({ name: form.get("name"), speedDownMbps: Number(form.get("down")), speedUpMbps: Number(form.get("up")), priceMinor: Number(form.get("price")), billingCycle: form.get("cycle") });
      invalidate("plans"); showToast("تم إنشاء الباقة"); await navigate("plans", { force: true });
    }
  });
}

function addDevice() {
  openDialog({
    kicker: "ربط آمن", title: "إضافة جهاز شبكة", submitText: "حفظ الجهاز",
    body: `<div class="field-row"><div class="field"><label>اسم الجهاز</label><input name="name" required maxlength="100"></div><div class="field"><label>الفرع</label><input name="branch" maxlength="100"></div></div><div class="field-row"><div class="field"><label>Public IP أو اسم المضيف</label><input name="host" dir="ltr" required placeholder="198.51.100.10"></div><div class="field"><label>منفذ API</label><input name="port" type="number" min="1" max="65535" value="8728" required></div></div><div class="field"><label>طريقة الاتصال</label><select name="method"><option value="agent">UCHIHA Agent</option><option value="vpn">VPN Tunnel</option><option value="api">RouterOS API</option></select></div><div class="field-row"><div class="field"><label>اسم مستخدم محدود الصلاحيات</label><input name="username" dir="ltr"></div><div class="field"><label>كلمة السر / الرمز</label><input name="secret" type="password" minlength="8" autocomplete="new-password"></div></div><div class="inline-message warning">لا تمنح الحساب صلاحيات كاملة على الراوتر. السر يُشفّر عند الحفظ ولا يعود للواجهة.</div>`,
    onSubmit: async (form) => {
      await api.createDevice({ name: form.get("name"), branch: form.get("branch") || null, host: form.get("host"), apiPort: Number(form.get("port")), connectionMethod: form.get("method"), username: form.get("username") || null, secret: form.get("secret") || null });
      invalidate("devices", "dashboard"); showToast("تم حفظ الجهاز بأمان"); await navigate("devices", { force: true });
    }
  });
}

function configureTelegram() {
  openDialog({
    kicker: "تنبيهات موحدة", title: "ربط Telegram", submitText: "حفظ الربط",
    body: `<div class="field"><label>رقم المحادثة Chat ID</label><input name="chatId" dir="ltr" required pattern="-?[0-9]{1,24}"><small>يمكن أن يبدأ بالسالب للمجموعات.</small></div><div class="field"><label>اسم يظهر داخل التطبيق</label><input name="chatLabel" value="فريق الشبكة" maxlength="100"></div><div class="field"><label>التنبيهات المرسلة</label><label class="check-row"><input type="checkbox" name="severity" value="critical" checked>حرجة</label><label class="check-row"><input type="checkbox" name="severity" value="warning" checked>تحذيرات</label><label class="check-row"><input type="checkbox" name="severity" value="info">معلومات</label></div><div class="inline-message">Token الخاص بالبوت لا يُدخل هنا؛ يوضع مرة واحدة كسر في الخادم.</div>`,
    onSubmit: async (form) => {
      const enabledSeverities = form.getAll("severity");
      await api.configureTelegram({ chatId: form.get("chatId"), chatLabel: form.get("chatLabel") || "Telegram", enabledSeverities });
      invalidate("telegram"); showToast("تم ربط Telegram"); await navigate("telegram", { force: true });
    }
  });
}

function inviteMember() {
  openDialog({ kicker: "وصول محدود", title: "دعوة عضو فريق", submitText: "إنشاء الدعوة", body: `<div class="field-row"><div class="field"><label>اسم العضو</label><input name="displayName" minlength="2" maxlength="120" required></div><div class="field"><label>البريد المرتبط بـGoogle</label><input name="email" type="email" dir="ltr" required></div></div><div class="field"><label>الدور</label><select name="role"><option value="operator">مشغّل</option><option value="collector">محصّل</option><option value="viewer">مشاهدة</option><option value="admin">مدير</option></select></div><div class="field"><label>سبب منح الوصول</label><textarea name="reason" minlength="3" maxlength="500" required></textarea></div><div class="inline-message">تتفعل الدعوة عندما يسجل العضو الدخول بحساب Google المطابق للبريد.</div>`, onSubmit: async (form) => {
    await api.inviteMember({ displayName: form.get("displayName"), email: form.get("email"), role: form.get("role"), reason: form.get("reason") }); invalidate("team", "audit"); showToast("تم إنشاء الدعوة"); await navigate("team", { force: true });
  }});
}

function editMember(button) {
  openDialog({ kicker: "صلاحيات الفريق", title: `إدارة ${button.dataset.name}`, submitText: "حفظ الصلاحيات", body: `<div class="field"><label>الدور</label><select name="role"><option value="owner" ${button.dataset.role === "owner" ? "selected" : ""}>مالك</option><option value="admin" ${button.dataset.role === "admin" ? "selected" : ""}>مدير</option><option value="operator" ${button.dataset.role === "operator" ? "selected" : ""}>مشغّل</option><option value="collector" ${button.dataset.role === "collector" ? "selected" : ""}>محصّل</option><option value="viewer" ${button.dataset.role === "viewer" ? "selected" : ""}>مشاهدة</option></select></div><div class="field"><label>الحالة</label><select name="status"><option value="active" ${button.dataset.status === "active" ? "selected" : ""}>فعال</option><option value="invited" ${button.dataset.status === "invited" ? "selected" : ""}>مدعو</option><option value="disabled" ${button.dataset.status === "disabled" ? "selected" : ""}>معطّل</option></select></div><div class="field"><label>سبب التعديل</label><textarea name="reason" minlength="3" maxlength="500" required></textarea></div>`, onSubmit: async (form) => {
    await api.updateMember(button.dataset.id, { role: form.get("role"), status: form.get("status"), reason: form.get("reason") }); invalidate("team", "audit"); showToast("تم تحديث الصلاحيات"); await navigate("team", { force: true });
  }});
}

function reasonAction({ title, message, confirmText, danger = false, onSubmit }) {
  openDialog({
    kicker: "عملية موثّقة", title, submitText: confirmText, submitClass: danger ? "button-danger" : "button-primary",
    body: `<div class="inline-message ${danger ? "danger" : "warning"}">${escapeHtml(message)}</div><div class="field"><label>سبب العملية</label><textarea name="reason" required minlength="3" maxlength="500" placeholder="اكتب سببًا واضحًا ليسهل تدقيق العملية لاحقًا"></textarea></div>`,
    onSubmit: async (form) => onSubmit(form.get("reason"))
  });
}

async function subscriberDetails(id) {
  try {
    const item = await api.subscriber(id);
    openDialog({
      kicker: item.username, title: item.fullName, submitText: "إغلاق",
      body: `<div class="device-meta"><span>الحالة <b>${escapeHtml(statusLabels[item.status] ?? item.status)}</b></span><span>الباقة <b>${escapeHtml(item.plan?.name ?? "—")}</b></span><span>الهاتف <b dir="ltr">${escapeHtml(item.phone ?? "—")}</b></span><span>العنوان <b>${escapeHtml(item.address ?? "—")}</b></span><span>الرصيد <b>${money(item.balanceMinor)}</b></span><span>انتهاء الخدمة <b>${date(item.serviceExpiresAt)}</b></span></div>`,
      onSubmit: async () => {}
    });
  } catch (error) { showToast(error.message, "error"); }
}

async function logout(callApi = true) {
  // Start revocation with the old token, then clear the visible session immediately.
  const revoke = callApi && session.token ? api.logout() : Promise.resolve();
  const nativeSignOut = isNativeRuntime ? window.UchihaNativeAuth?.signOut().catch(() => {}) : Promise.resolve();
  state.requestVersion++;
  operations.reset(); state.offsets = {}; state.subscriberQuery = { q: "", status: "all" };
  session.clear(); state.me = null; state.cache.clear(); state.warming.clear(); state.warmScheduled = false;
  $("#main-content").textContent = "";
  $("#app-shell").hidden = true; $("#login-view").hidden = false;
  closeDialog();
  closeDrawer();
  setBusy($("#dev-login"), false);
  $("#login-status").textContent = "";
  await Promise.all([nativeSignOut, revoke.catch(() => { if (!session.token) $("#login-status").textContent = "تم الخروج من هذا الجهاز، لكن تعذر تأكيد إلغاء الجلسة على الخادم."; })]);
}

async function establishSession(result) {
  state.requestVersion++; state.cache.clear(); state.warming.clear(); state.warmScheduled = false;
  operations.reset();
  state.me = null;
  if (session.token !== result.token) session.clear();
  session.token = result.token;
  await refreshContext();
  if (!state.me || session.token !== result.token) return;
  if (state.me.tenantId) session.tenantId = state.me.tenantId;
  $("#login-view").hidden = true;
  $("#app-shell").hidden = false;
  $("#profile-name").textContent = state.me.user.displayName;
  $("#profile-role").textContent = roleLabels[state.me.role] ?? state.me.user.platformRole;
  $("#profile-initial").textContent = initial(state.me.user.displayName).replaceAll("&", "");
  await navigate(location.hash.slice(1) || "dashboard", { updateHash: false });
  scheduleWarmViews();
}

async function setupGoogle(clientId) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      google.accounts.id.initialize({ client_id: clientId, callback: async ({ credential }) => {
        try { await establishSession(await api.googleLogin(credential)); }
        catch (error) { $("#login-status").textContent = error.message; }
      }});
      google.accounts.id.renderButton($("#google-login"), { theme: "outline", size: "large", shape: "pill", text: "continue_with", locale: "ar", width: 300 });
      resolve();
    };
    script.onerror = reject;
    document.head.append(script);
  });
}

async function setupNativeGoogle(clientId) {
  if (!window.UchihaNativeAuth) throw new Error("موصل Google الأصلي غير متاح");
  await window.UchihaNativeAuth.initializeGoogle(clientId);
  $("#google-login").innerHTML = `<button type="button" class="native-google-button" data-action="native-google-login"><span aria-hidden="true">G</span><b>المتابعة بواسطة Google</b></button>`;
}

async function nativeGoogleLogin(button) {
  setBusy(button, true, "جارٍ فتح Google…");
  $("#login-status").textContent = "";
  try {
    const credential = await window.UchihaNativeAuth.signInWithGoogle(state.meta.googleClientId);
    await establishSession(await api.googleLogin(credential));
  } catch (error) {
    const canceled = /cancel|dismiss/i.test(`${error?.code ?? ""} ${error?.message ?? ""}`);
    $("#login-status").textContent = canceled ? "تم إلغاء تسجيل الدخول" : (error?.message ?? "تعذر تسجيل الدخول بواسطة Google");
  } finally { setBusy(button, false); }
}

async function boot() {
  const savedTheme = readPreference("uchiha-theme");
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  try {
    state.meta = await api.meta();
    if (state.meta.devAuthAvailable) $("#demo-login").hidden = false;
    if (state.meta.googleClientId) {
      const setup = isNativeRuntime ? setupNativeGoogle : setupGoogle;
      setup(state.meta.googleClientId).catch(() => { $("#login-status").textContent = "تعذر تحميل تسجيل Google"; });
    }
    if (session.token) {
      try {
        await establishSession({ token: session.token });
      } catch { session.clear(); }
    }
  } catch {
    $("#login-status").textContent = "الخادم غير متاح حاليًا";
  }
  if (!isNativeRuntime && "serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/provider/sw.js").catch(() => {});
}

document.addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-view]:not([data-action])");
  if (viewButton && !viewButton.disabled) {
    event.preventDefault();
    await navigate(viewButton.dataset.view);
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action.startsWith("ops-")) {
    setBusy(button, true, "لحظة…");
    try { await operations.handle(button); } catch (error) { showToast(error.message, "error"); }
    finally { setBusy(button, false); }
    return;
  }
  if (action === "page") { state.offsets[button.dataset.view] = Math.max(0, Number(button.dataset.offset) || 0); return navigate(button.dataset.view, { force: true }); }
  if (action === "drawer") return openDrawer();
  if (action === "close-drawer") return closeDrawer();
  if (action === "close-dialog") return closeDialog();
  if (action === "refresh") { invalidate(state.view); return navigate(state.view, { force: true }); }
  if (action === "theme") {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme; writePreference("uchiha-theme", theme); return;
  }
  if (action === "native-google-login") return nativeGoogleLogin(button);
  if (action === "logout") return logout();
  if (action === "open-checkout") return openCheckout(button.dataset.url);
  if (action === "add-subscriber") return addSubscriber().catch((error) => showToast(error.message, "error"));
  if (action === "add-plan") return addPlan();
  if (action === "add-device") return addDevice();
  if (action === "configure-telegram") return configureTelegram();
  if (action === "invite-member") return inviteMember();
  if (action === "edit-member") return editMember(button);
  if (action === "subscriber-details") return subscriberDetails(button.dataset.id);
  if (action === "subscriber-status") {
    const activating = button.dataset.status === "activate";
    return reasonAction({ title: activating ? "تفعيل المشترك" : "تعليق المشترك", message: activating ? "سيُرسل التفعيل إلى RADIUS في الخلفية." : "سيُمنع الحساب بعد تنفيذ موصل RADIUS.", confirmText: activating ? "تفعيل" : "تعليق", danger: !activating, onSubmit: async (reason) => {
      await api.subscriberStatus(button.dataset.id, activating ? "activate" : "suspend", reason);
      invalidate("subscribers", "dashboard", "audit"); showToast("تم تسجيل العملية وإرسالها للتنفيذ"); await navigate("subscribers", { force: true });
    }});
  }
  if (action === "disconnect") return reasonAction({ title: "فصل الجلسة", message: "سيذهب طلب الفصل إلى الموصل دون انتظار الواجهة.", confirmText: "فصل الجلسة", danger: true, onSubmit: async (reason) => {
    await api.disconnect(button.dataset.id, reason); invalidate("sessions", "dashboard", "audit"); showToast("تم إرسال طلب الفصل"); await navigate("sessions", { force: true });
  }});
  if (action === "pay") {
    const remaining = Number(button.dataset.remaining);
    return openDialog({ kicker: "تحصيل موثّق", title: "تسجيل دفعة", submitText: "تسجيل الدفعة", body: `<div class="inline-message">المتبقي: ${money(remaining, button.dataset.currency)}</div><div class="field"><label>المبلغ بوحدة السنت</label><input name="amount" type="number" min="1" max="${remaining}" value="${remaining}" required></div><div class="field"><label>طريقة الدفع</label><select name="method"><option value="cash">نقدي</option><option value="transfer">تحويل</option><option value="card">بطاقة</option><option value="other">أخرى</option></select></div><div class="field"><label>مرجع اختياري</label><input name="reference" maxlength="120"></div><div class="field"><label>سبب التسجيل</label><textarea name="reason" minlength="3" maxlength="500" required>تحصيل دفعة من المشترك</textarea></div>`, onSubmit: async (form) => {
      await api.payment(button.dataset.id, { amountMinor: Number(form.get("amount")), method: form.get("method"), reference: form.get("reference") || null, reason: form.get("reason") });
      invalidate("billing", "dashboard", "audit"); showToast("تم تسجيل الدفعة"); await navigate("billing", { force: true });
    }});
  }
  if (action === "ack-alert") {
    button.disabled = true;
    try { await api.acknowledgeAlert(button.dataset.id); invalidate("dashboard", "audit"); showToast("تمت مراجعة التنبيه"); await navigate("dashboard", { force: true }); }
    catch (error) { button.disabled = false; showToast(error.message, "error"); }
    return;
  }
  if (action === "select-product") return reasonAction({ title: "اختيار خطة الاشتراك", message: state.meta?.billingCheckoutAvailable ? "سيتم تجهيز صفحة دفع آمنة ثم فتحها لك." : "سيُرسل الطلب إلى مالك المنصة للمراجعة والتفعيل.", confirmText: "متابعة", onSubmit: async () => {
    const created = await api.selectSubscription(button.dataset.id);
    invalidate("subscriptions");
    await refreshContext();
    if (created.checkoutStatus === "ready" && created.checkoutUrl) return openCheckout(created.checkoutUrl);
    if (created.checkoutStatus === "queued") {
      showToast("جارٍ تجهيز صفحة الدفع…");
      const checkout = await waitForCheckout(created.subscriptionId);
      invalidate("subscriptions");
      if (checkout?.checkoutStatus === "ready" && checkout.checkoutUrl) return openCheckout(checkout.checkoutUrl);
      showToast("تم حفظ الطلب ويمكن متابعته من شاشة الاشتراك");
    } else {
      showToast("تم إرسال طلب الاشتراك للمراجعة");
    }
    await navigate("subscriptions", { force: true });
  }});
});

document.addEventListener("pointerdown", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton && !viewButton.disabled) prefetchView(viewButton.dataset.view);
}, { passive: true });

document.addEventListener("submit", async (event) => {
  if (event.target.id !== "subscriber-search") return;
  event.preventDefault();
  const form = new FormData(event.target);
  state.subscriberQuery = { q: String(form.get("q") ?? "").trim(), status: form.get("status") };
  state.offsets.subscribers = 0;
  const version = ++state.requestVersion;
  const content = $("#main-content");
  content.innerHTML = skeleton();
  try {
    const html = await subscribersView(form.get("q").trim(), form.get("status"));
    if (version === state.requestVersion && state.me) { content.innerHTML = html; applyAccess(); }
  } catch (error) {
    if (version === state.requestVersion && state.me) content.innerHTML = renderError(error);
  }
});

$("#dev-login").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  setBusy(button, true, "جارٍ الدخول…");
  $("#login-status").textContent = "";
  try { await establishSession(await api.devLogin("provider")); }
  catch (error) { $("#login-status").textContent = error.message; }
  finally { setBusy(button, false); }
});

$("#dialog").addEventListener("click", (event) => {
  if (event.target === $("#dialog")) closeDialog();
});

window.addEventListener("hashchange", () => navigate(location.hash.slice(1) || "dashboard", { updateHash: false }));
boot();
