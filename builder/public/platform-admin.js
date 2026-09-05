(() => {
  "use strict";

  const LANGUAGE_KEY = "uchiha-ui-language";
  const state = {
    locale: readLocale(),
    me: null,
    csrf: "",
    data: null,
    section: "dashboard",
    editor: null
  };

  const text = {
    ar: {
      loginTitle: "تسجيل دخول إدارة المنصة", loginText: "هذه المساحة مخصصة لمديري المنصة فقط.", email: "البريد الإلكتروني", password: "كلمة المرور", signIn: "تسجيل الدخول", backHome: "العودة للرئيسية", signOut: "تسجيل الخروج", publicPortal: "فتح الواجهة العامة", save: "حفظ التغييرات",
      dashboard: "لوحة المعلومات", users: "المستخدمون", stores: "المتاجر", subscriptions: "الاشتراكات", services: "الخدمات", serviceRequests: "طلبات الخدمات", payments: "طرق الدفع", contacts: "التواصل", api: "UCHIHA API", providers: "المزودون", products: "المنتجات", orders: "الطلبات", templates: "القوالب", settings: "الإعدادات", identity: "الهوية والتصميم", logs: "السجلات", backups: "النسخ الاحتياطي", system: "حالة النظام", banners: "البنرات",
      dashboardDesc: "أرقام فعلية من قاعدة البيانات دون بيانات افتراضية.", usersCount: "المستخدمون", storesCount: "المتاجر", activeSubscriptions: "الاشتراكات النشطة", openRequests: "طلبات الخدمات المفتوحة", openProviderOrders: "طلبات المزودين المفتوحة", recentRequests: "أحدث طلبات الخدمات", providerHealth: "حالة تكامل المزودين", noRows: "لا توجد بيانات في هذا القسم حاليًا.", add: "إضافة", edit: "تعديل", sync: "مزامنة وفحص", refresh: "تحديث", name: "الاسم", description: "الوصف", status: "الحالة", order: "الترتيب", actions: "الإجراءات", createdAt: "تاريخ الإنشاء", service: "الخدمة", customer: "العميل", contact: "التواصل", source: "المصدر", details: "التفاصيل", type: "النوع", target: "الوجهة", currency: "العملة", network: "الشبكة", configured: "البيانات", configuredYes: "مهيأة", configuredNo: "غير مهيأة", publicAlias: "الاسم العام", connection: "الاتصال", balance: "الرصيد", lastCheck: "آخر فحص", error: "الخطأ", retryable: "قابل للإعادة", auditAction: "الإجراء", entity: "العنصر", actor: "المنفّذ", platformData: "بيانات المنصة", platformDataHint: "القائمة التفصيلية لهذا القسم تبقى ضمن وحدته الحالية. تعرض هذه الصفحة العدد الحقيقي ولا تنشئ سجلات وهمية.", noEndpoint: "لا توجد حاليًا واجهة كتابة منفصلة لهذا القسم في بوابة المنصة الجديدة.", working: "جارٍ الحفظ...", saved: "تم حفظ التغييرات.", failed: "تعذرت العملية. راجع الحقول وحاول مجددًا.", forbidden: "الحساب الحالي ليس مدير منصة.", sessionRequired: "سجّل الدخول بحساب مدير منصة.", active: "نشط", hidden: "مخفي", coming_soon: "قريبًا", disabled: "متوقف", new: "جديد", contacted: "تم التواصل", quoted: "تم التسعير", approved: "معتمد", in_progress: "قيد التنفيذ", completed: "مكتمل", cancelled: "ملغي", rejected: "مرفوض", pending: "قيد الانتظار", submitted: "مُرسل", processing: "قيد المعالجة", partial: "جزئي", failedStatus: "فشل", requires_review: "يحتاج مراجعة", connected: "متصل", not_configured: "غير مهيأ", unknown: "غير معروف", secureNote: "لا تعرض هذه الواجهة بيانات اعتماد المزودين أو أسرار الدفع داخل السجلات.", systemReady: "البوابة تعمل وتقرأ البيانات بنجاح.", systemHint: "تُعرض سلامة الاتصال الحالية فقط؛ النسخ الاحتياطي الفعلي يجب ربطه بمزود تخزين آمن قبل تفعيله.", backupHint: "لم يتم تفعيل تنفيذ نسخ احتياطي من المتصفح. هذا يمنع إعطاء انطباع زائف بوجود نسخة قابلة للاستعادة.", createService: "إضافة خدمة", editService: "تعديل الخدمة", createContact: "إضافة وسيلة تواصل", editContact: "تعديل وسيلة التواصل", createPayment: "إضافة طريقة دفع", editPayment: "تعديل طريقة الدفع", createBanner: "إضافة بنر", editBanner: "تعديل البنر", requiredBoth: "الحقول العربية والإنجليزية مطلوبة للمحتوى العام.", none: "—", language: "EN", theme: "تبديل المظهر", loginFailed: "بيانات الدخول غير صحيحة أو لا تملك الصلاحية.", requestStatusSaved: "تم تحديث حالة الطلب.", syncDone: "اكتملت المزامنة وفحص الاتصال.", qrSecurity: "بيانات QR لا تظهر للعامة إلا عندما تكون الطريقة نشطة ومهيأة."
    },
    en: {
      loginTitle: "Platform Admin Sign In", loginText: "This workspace is restricted to platform administrators.", email: "Email", password: "Password", signIn: "Sign In", backHome: "Back to Home", signOut: "Sign Out", publicPortal: "Open Public Portal", save: "Save Changes",
      dashboard: "Dashboard", users: "Users", stores: "Stores", subscriptions: "Subscriptions", services: "Services", serviceRequests: "Service Requests", payments: "Payment Methods", contacts: "Contact", api: "UCHIHA API", providers: "Providers", products: "Products", orders: "Orders", templates: "Templates", settings: "Settings", identity: "Identity & Design", logs: "Audit Logs", backups: "Backups", system: "System Status", banners: "Banners",
      dashboardDesc: "Live database counts with no fictional metrics.", usersCount: "Users", storesCount: "Stores", activeSubscriptions: "Active Subscriptions", openRequests: "Open Service Requests", openProviderOrders: "Open Provider Orders", recentRequests: "Recent Service Requests", providerHealth: "Provider Integration Health", noRows: "There is no data in this section yet.", add: "Add", edit: "Edit", sync: "Sync & Test", refresh: "Refresh", name: "Name", description: "Description", status: "Status", order: "Order", actions: "Actions", createdAt: "Created", service: "Service", customer: "Customer", contact: "Contact", source: "Source", details: "Details", type: "Type", target: "Target", currency: "Currency", network: "Network", configured: "Configuration", configuredYes: "Configured", configuredNo: "Not configured", publicAlias: "Public Alias", connection: "Connection", balance: "Balance", lastCheck: "Last Check", error: "Error", retryable: "Retryable", auditAction: "Action", entity: "Entity", actor: "Actor", platformData: "Platform Data", platformDataHint: "Detailed records remain in their existing module. This page shows the live count and never fabricates rows.", noEndpoint: "The new platform portal does not expose a separate write endpoint for this section yet.", working: "Saving...", saved: "Changes saved.", failed: "The operation failed. Review the fields and try again.", forbidden: "The current account is not a platform administrator.", sessionRequired: "Sign in with a platform administrator account.", active: "Active", hidden: "Hidden", coming_soon: "Coming Soon", disabled: "Disabled", new: "New", contacted: "Contacted", quoted: "Quoted", approved: "Approved", in_progress: "In Progress", completed: "Completed", cancelled: "Cancelled", rejected: "Rejected", pending: "Pending", submitted: "Submitted", processing: "Processing", partial: "Partial", failedStatus: "Failed", requires_review: "Requires Review", connected: "Connected", not_configured: "Not Configured", unknown: "Unknown", secureNote: "Provider credentials and payment secrets are never exposed in this interface or its logs.", systemReady: "The portal is online and reading live data.", systemHint: "Only current connectivity is shown. Backup execution must be connected to secure storage before activation.", backupHint: "Browser-triggered backups are not enabled. This avoids falsely claiming a restorable backup exists.", createService: "Add Service", editService: "Edit Service", createContact: "Add Contact Method", editContact: "Edit Contact Method", createPayment: "Add Payment Method", editPayment: "Edit Payment Method", createBanner: "Add Banner", editBanner: "Edit Banner", requiredBoth: "Arabic and English fields are required for public content.", none: "—", language: "عربي", theme: "Toggle theme", loginFailed: "The credentials are invalid or the account lacks permission.", requestStatusSaved: "Request status updated.", syncDone: "Synchronization and connection test completed.", qrSecurity: "QR data is public only when the payment method is active and configured."
    }
  };

  Object.assign(text.ar, {
    createProvider: "إضافة مزود",
    editProvider: "تعديل المزود",
    internalProviderName: "الاسم الحقيقي الداخلي",
    adapter: "المحوّل",
    baseUrl: "رابط API الأساسي",
    primaryCredential: "بيانات الاعتماد الأساسية",
    webhookSecret: "سر Webhook",
    webhookUrl: "رابط Webhook",
    testMode: "وضع الاختبار",
    capabilities: "الإمكانات",
    credentialStored: "محفوظة ومشفرة",
    credentialMissing: "غير مهيأة",
    credentialHint: "اترك السر فارغًا للاحتفاظ بالقيمة المشفرة الحالية. لا تُعاد الأسرار إلى المتصفح بعد الحفظ.",
    providerCatalog: "كتالوج المزودين",
    syncHistory: "سجل المزامنة",
    attempts: "المحاولات",
    orderNumber: "رقم الطلب",
    store: "المتجر",
    cost: "التكلفة",
    limits: "الحدود",
    cancelOrder: "طلب الإلغاء",
    cancelConfirm: "هل تريد إرسال طلب إلغاء هذا الطلب إلى المزود؟",
    cancelDone: "تم تحديث حالة طلب المزود.",
    categories: "الأقسام"
  });
  Object.assign(text.en, {
    createProvider: "Add Provider",
    editProvider: "Edit Provider",
    internalProviderName: "Private Internal Name",
    adapter: "Adapter",
    baseUrl: "API Base URL",
    primaryCredential: "Primary Credential",
    webhookSecret: "Webhook Secret",
    webhookUrl: "Webhook URL",
    testMode: "Test Mode",
    capabilities: "Capabilities",
    credentialStored: "Stored & encrypted",
    credentialMissing: "Not configured",
    credentialHint: "Leave a secret blank to preserve its encrypted value. Secrets are never returned to the browser after saving.",
    providerCatalog: "Provider Catalog",
    syncHistory: "Sync History",
    attempts: "Attempts",
    orderNumber: "Order Number",
    store: "Store",
    cost: "Cost",
    limits: "Limits",
    cancelOrder: "Request Cancellation",
    cancelConfirm: "Send a cancellation request to the provider?",
    cancelDone: "The provider order status was updated.",
    categories: "Categories"
  });

  const nav = [
    ["dashboard", "▦"], ["users", "◎"], ["stores", "▣"], ["subscriptions", "◫"],
    ["services", "◇"], ["serviceRequests", "◷"], ["payments", "◈"], ["contacts", "◉"],
    ["banners", "▤"], ["api", "API"], ["providers", "⇄"], ["products", "□"],
    ["orders", "≡"], ["templates", "▧"], ["settings", "⚙"], ["identity", "◐"],
    ["logs", "≣"], ["backups", "↥"], ["system", "●"]
  ];

  const requestStatuses = ["new", "contacted", "quoted", "approved", "in_progress", "completed", "cancelled", "rejected"];

  function readLocale() {
    try { return localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "ar"; } catch { return "ar"; }
  }
  function tr(key) { return text[state.locale]?.[key] ?? key; }
  function local(value) { return value?.[state.locale] || value?.ar || value?.en || ""; }
  function escape(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
  function date(value) { return value ? new Intl.DateTimeFormat(state.locale === "ar" ? "ar-SY" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : tr("none"); }
  function status(value) { if (value === "failed") return tr("failedStatus"); return tr(value) === value ? value : tr(value); }
  function pill(value) { return `<span class="status-pill ${escape(value)}">${escape(status(value))}</span>`; }
  function fieldValue(form, name) { return form.elements[name]?.type === "number" ? Number(form.elements[name].value || 0) : form.elements[name]?.value?.trim() ?? ""; }

  async function api(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.method && options.method !== "GET" && state.csrf) headers["x-csrf-token"] = state.csrf;
    const response = await fetch(url, { credentials: "same-origin", ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(payload.message || payload.error || `HTTP ${response.status}`); error.status = response.status; error.code = payload.code; throw error; }
    return payload;
  }

  function applyLanguage() {
    document.documentElement.lang = state.locale;
    document.documentElement.dir = state.locale === "ar" ? "rtl" : "ltr";
    document.querySelectorAll("[data-copy]").forEach((node) => node.textContent = tr(node.dataset.copy));
    document.querySelectorAll("[data-language-toggle]").forEach((button) => { button.textContent = tr("language"); button.setAttribute("aria-label", state.locale === "ar" ? "Switch to English" : "التبديل إلى العربية"); });
    renderNav();
    renderSection();
  }

  function renderNav() {
    const container = document.getElementById("platformNav");
    if (!container) return;
    container.innerHTML = nav.map(([key, icon]) => `<button type="button" data-section="${key}" class="${key === state.section ? "active" : ""}"><span>${icon}</span><span>${tr(key)}</span></button>`).join("");
    container.querySelectorAll("[data-section]").forEach((button) => button.addEventListener("click", () => {
      state.section = button.dataset.section;
      document.querySelector(".platform-admin-shell").classList.remove("menu-open");
      renderNav();
      renderSection();
    }));
  }

  function heading(title, description, action = "") {
    return `<div class="admin-page-heading"><div><h2>${escape(title)}</h2><p>${escape(description)}</p></div>${action}</div>`;
  }

  function empty(title, detail) { return `<div class="admin-empty"><b>${escape(title)}</b><p>${escape(detail)}</p></div>`; }

  function table(headers, rows) {
    if (!rows.length) return empty(tr("noRows"), tr("platformDataHint"));
    return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${headers.map((item) => `<th>${escape(item)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  }

  function renderDashboard() {
    const counts = state.data.counts;
    const metrics = [["usersCount", counts.users], ["storesCount", counts.stores], ["activeSubscriptions", counts.subscriptions], ["openRequests", counts.openServiceRequests], ["openProviderOrders", counts.openProviderOrders]];
    const requests = (state.data.serviceRequests || []).slice(0, 8).map((item) => `<tr><td><strong>${escape(local(item.serviceName))}</strong><small>${escape(item.id)}</small></td><td>${escape(item.customerName)}<small>${escape(item.customerEmail || item.customerPhone || tr("none"))}</small></td><td>${pill(item.status)}</td><td>${escape(date(item.createdAt))}</td></tr>`);
    const providers = (state.data.providers || []).map((item) => `<tr><td><strong>${escape(item.alias)}</strong><small>${escape(item.currency)}</small></td><td>${pill(item.connectionStatus || "not_configured")}</td><td>${item.balanceMinor === null ? tr("none") : escape(String(item.balanceMinor))}</td><td>${escape(date(item.lastCheckedAt))}</td></tr>`);
    return `${heading(tr("dashboard"), tr("dashboardDesc"))}<div class="metric-grid">${metrics.map(([key, value]) => `<article class="metric-card"><span>${tr(key)}</span><strong>${Number(value || 0).toLocaleString(state.locale === "ar" ? "ar" : "en")}</strong></article>`).join("")}</div><section class="admin-panel"><h3>${tr("recentRequests")}</h3><p>${tr("secureNote")}</p>${table([tr("service"), tr("customer"), tr("status"), tr("createdAt")], requests)}</section><section class="admin-panel"><h3>${tr("providerHealth")}</h3><p>${tr("secureNote")}</p>${table([tr("publicAlias"), tr("connection"), tr("balance"), tr("lastCheck")], providers)}</section>`;
  }

  function renderServices() {
    const rows = (state.data.services || []).map((item) => `<tr><td><strong>${escape(local(item.name))}</strong><small>${escape(item.key)}</small></td><td>${escape(local(item.description))}</td><td>${pill(item.status)}</td><td>${item.sortOrder}</td><td><button type="button" data-edit-service="${item.id}">${tr("edit")}</button></td></tr>`);
    return `${heading(tr("services"), tr("requiredBoth"), `<button class="primary-button" type="button" data-create="service">${tr("add")} ${tr("services")}</button>`)}<section class="admin-panel">${table([tr("name"), tr("description"), tr("status"), tr("order"), tr("actions")], rows)}</section>`;
  }

  function renderRequests() {
    const rows = (state.data.serviceRequests || []).map((item) => `<tr><td><strong>${escape(local(item.serviceName))}</strong><small>${escape(item.id)}</small></td><td><strong>${escape(item.customerName)}</strong><small>${escape(item.customerEmail || item.customerPhone || tr("none"))}</small></td><td title="${escape(item.details)}">${escape(item.details.slice(0, 110))}${item.details.length > 110 ? "…" : ""}</td><td><select data-request-status="${item.id}">${requestStatuses.map((value) => `<option value="${value}" ${value === item.status ? "selected" : ""}>${status(value)}</option>`).join("")}</select></td><td>${escape(date(item.createdAt))}</td></tr>`);
    return `${heading(tr("serviceRequests"), tr("secureNote"))}<section class="admin-panel">${table([tr("service"), tr("customer"), tr("details"), tr("status"), tr("createdAt")], rows)}</section>`;
  }

  function renderPayments() {
    const rows = (state.data.paymentMethods || []).map((item) => `<tr><td><strong>${escape(local(item.name))}</strong><small>${escape(item.key)}</small></td><td>${escape(item.currency)}</td><td>${escape(item.network || tr("none"))}</td><td>${pill(item.status)}</td><td>${item.configured ? tr("configuredYes") : tr("configuredNo")}</td><td><button type="button" data-edit-payment="${item.id}">${tr("edit")}</button></td></tr>`);
    return `${heading(tr("payments"), tr("qrSecurity"), `<button class="primary-button" type="button" data-create="payment">${tr("add")} ${tr("payments")}</button>`)}<section class="admin-panel">${table([tr("name"), tr("currency"), tr("network"), tr("status"), tr("configured"), tr("actions")], rows)}</section>`;
  }

  function renderContacts() {
    const rows = (state.data.contacts || []).map((item) => `<tr><td><strong>${escape(local(item.name))}</strong><small>${escape(item.type)}</small></td><td dir="ltr">${escape(item.target)}</td><td>${escape(local(item.workingHours) || tr("none"))}</td><td>${pill(item.status)}</td><td>${item.sortOrder}</td><td><button type="button" data-edit-contact="${item.id}">${tr("edit")}</button></td></tr>`);
    return `${heading(tr("contacts"), tr("requiredBoth"), `<button class="primary-button" type="button" data-create="contact">${tr("add")} ${tr("contacts")}</button>`)}<section class="admin-panel">${table([tr("name"), tr("target"), tr("details"), tr("status"), tr("order"), tr("actions")], rows)}</section>`;
  }

  function renderBanners() {
    const rows = (state.data.banners || []).map((item) => `<tr><td><strong>${escape(local(item.title))}</strong><small>${escape(item.linkUrl)}</small></td><td>${escape(local(item.subtitle))}</td><td>${pill(item.status)}</td><td>${item.sortOrder}</td><td><button type="button" data-edit-banner="${item.id}">${tr("edit")}</button></td></tr>`);
    return `${heading(tr("banners"), tr("requiredBoth"), `<button class="primary-button" type="button" data-create="banner">${tr("add")} ${tr("banners")}</button>`)}<section class="admin-panel">${table([tr("name"), tr("description"), tr("status"), tr("order"), tr("actions")], rows)}</section>`;
  }

  function renderProviders() {
    const rows = (state.data.providers || []).map((item) => `<tr><td><strong>${escape(item.alias)}</strong><small>${escape(item.internalName || item.id)}</small></td><td><strong>${escape(item.adapterKey || "mock")}</strong><small>${escape(item.baseUrl || tr("testMode"))}</small></td><td>${pill(item.connectionStatus || "not_configured")}<small>${escape(item.hasPrimaryCredential ? tr("credentialStored") : tr("credentialMissing"))}</small></td><td>${escape(item.currency)}</td><td>${item.balanceMinor === null ? tr("none") : escape(String(item.balanceMinor))}</td><td>${escape(date(item.lastCheckedAt))}</td><td><div class="row-actions"><button type="button" data-edit-provider="${item.id}">${tr("edit")}</button><button type="button" data-sync-provider="${item.id}">${tr("sync")}</button></div></td></tr>`);
    const errors = (state.data.providerErrors || []).map((item) => `<tr><td>${escape(item.error_code || tr("unknown"))}</td><td>${escape(item.safe_message || tr("none"))}</td><td>${item.retryable ? "✓" : "—"}</td><td>${escape(date(item.created_at))}</td></tr>`);
    const syncRows = (state.data.providerSyncLogs || []).map((item) => `<tr><td><strong>${escape(item.providerAlias)}</strong><small>${escape(item.id)}</small></td><td>${pill(item.status)}</td><td>${item.categoriesCount}</td><td>${item.servicesCount}</td><td>${escape(item.errorMessage || tr("none"))}</td><td>${escape(date(item.startedAt))}</td></tr>`);
    return `${heading(tr(state.section), tr("secureNote"), `<button class="primary-button" type="button" data-create="provider">${tr("createProvider")}</button>`)}<section class="admin-panel"><h3>${tr("providers")}</h3>${table([tr("publicAlias"), tr("adapter"), tr("connection"), tr("currency"), tr("balance"), tr("lastCheck"), tr("actions")], rows)}</section><section class="admin-panel"><h3>${tr("syncHistory")}</h3>${table([tr("publicAlias"), tr("status"), tr("categories"), tr("products"), tr("details"), tr("createdAt")], syncRows)}</section><section class="admin-panel"><h3>${tr("error")}</h3>${table([tr("error"), tr("details"), tr("retryable"), tr("createdAt")], errors)}</section>`;
  }

  function renderProviderCatalog() {
    const rows = (state.data.providerCatalog || []).map((item) => `<tr><td><strong>${escape(item.name)}</strong><small>${escape(item.id)}</small></td><td>${escape(item.categoryName || tr("none"))}</td><td>${escape(item.providerAlias)}</td><td>${pill(item.status)}</td><td>${escape(`${item.costMinor} ${item.currency}`)}</td><td>${escape(`${item.minimumQuantity} — ${item.maximumQuantity ?? "∞"}`)}</td></tr>`);
    return `${heading(tr("products"), tr("secureNote"))}<section class="admin-panel"><h3>${tr("providerCatalog")}</h3>${table([tr("name"), tr("categories"), tr("publicAlias"), tr("status"), tr("cost"), tr("limits")], rows)}</section>`;
  }

  function renderProviderOrders() {
    const terminal = new Set(["completed", "partial", "failed", "cancelled"]);
    const rows = (state.data.providerOrders || []).map((item) => `<tr><td><strong>${escape(item.orderNumber)}</strong><small>${escape(item.id)}</small></td><td>${escape(item.storeName)}</td><td>${escape(item.providerAlias)}<small>${escape(item.externalOrderId || tr("none"))}</small></td><td>${pill(item.status)}</td><td>${item.attemptCount}</td><td>${escape(date(item.createdAt))}</td><td>${terminal.has(item.status) ? "—" : `<button type="button" data-cancel-provider-order="${item.id}">${tr("cancelOrder")}</button>`}</td></tr>`);
    return `${heading(tr("orders"), tr("secureNote"))}<section class="admin-panel">${table([tr("orderNumber"), tr("store"), tr("publicAlias"), tr("status"), tr("attempts"), tr("createdAt"), tr("actions")], rows)}</section>`;
  }

  function renderLogs() {
    const rows = (state.data.auditLogs || []).map((item) => `<tr><td>${escape(item.action)}</td><td><strong>${escape(item.entity_type)}</strong><small>${escape(item.entity_id)}</small></td><td>${escape(item.actor_user_id || tr("none"))}</td><td>${escape(date(item.created_at))}</td></tr>`);
    return `${heading(tr("logs"), tr("secureNote"))}<section class="admin-panel">${table([tr("auditAction"), tr("entity"), tr("actor"), tr("createdAt")], rows)}</section>`;
  }

  function renderPlaceholder(section) {
    const countMap = { users: state.data.counts.users, stores: state.data.counts.stores, subscriptions: state.data.counts.subscriptions, orders: state.data.counts.openProviderOrders };
    const count = countMap[section];
    const metric = count === undefined ? "" : `<div class="metric-grid"><article class="metric-card"><span>${tr(section)}</span><strong>${Number(count).toLocaleString(state.locale === "ar" ? "ar" : "en")}</strong></article></div>`;
    const detail = section === "backups" ? tr("backupHint") : section === "system" ? tr("systemHint") : tr("platformDataHint");
    const title = section === "system" ? tr("systemReady") : tr("noEndpoint");
    return `${heading(tr(section), detail)}${metric}${empty(title, detail)}`;
  }

  function renderSection() {
    if (!state.data) return;
    const title = tr(state.section);
    document.getElementById("platformPageTitle").textContent = title;
    const content = document.getElementById("platformContent");
    const renderer = { dashboard: renderDashboard, services: renderServices, serviceRequests: renderRequests, payments: renderPayments, contacts: renderContacts, banners: renderBanners, api: renderProviders, providers: renderProviders, products: renderProviderCatalog, orders: renderProviderOrders, logs: renderLogs }[state.section];
    content.innerHTML = renderer ? renderer() : renderPlaceholder(state.section);
    bindContent();
  }

  function bindContent() {
    document.querySelectorAll("[data-create]").forEach((button) => button.addEventListener("click", () => openEditor(button.dataset.create)));
    document.querySelectorAll("[data-edit-service]").forEach((button) => button.addEventListener("click", () => openEditor("service", state.data.services.find((item) => item.id === button.dataset.editService))));
    document.querySelectorAll("[data-edit-contact]").forEach((button) => button.addEventListener("click", () => openEditor("contact", state.data.contacts.find((item) => item.id === button.dataset.editContact))));
    document.querySelectorAll("[data-edit-payment]").forEach((button) => button.addEventListener("click", () => openEditor("payment", state.data.paymentMethods.find((item) => item.id === button.dataset.editPayment))));
    document.querySelectorAll("[data-edit-banner]").forEach((button) => button.addEventListener("click", () => openEditor("banner", state.data.banners.find((item) => item.id === button.dataset.editBanner))));
    document.querySelectorAll("[data-edit-provider]").forEach((button) => button.addEventListener("click", () => openEditor("provider", state.data.providers.find((item) => item.id === button.dataset.editProvider))));
    document.querySelectorAll("[data-request-status]").forEach((select) => select.addEventListener("change", async () => {
      const old = select.disabled; select.disabled = true;
      try { await api(`/api/platform/service-requests/${select.dataset.requestStatus}/status`, { method: "PUT", body: { status: select.value } }); await loadData(); notify(tr("requestStatusSaved"), true); } catch (error) { console.error(error); notify(error.message || tr("failed")); select.disabled = old; }
    }));
    document.querySelectorAll("[data-sync-provider]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try { await api(`/api/platform/providers/${button.dataset.syncProvider}/sync`, { method: "POST", body: {} }); await loadData(); notify(tr("syncDone"), true); } catch (error) { console.error(error); notify(error.message || tr("failed")); button.disabled = false; }
    }));
    document.querySelectorAll("[data-cancel-provider-order]").forEach((button) => button.addEventListener("click", async () => {
      if (!window.confirm(tr("cancelConfirm"))) return;
      button.disabled = true;
      try { await api(`/api/platform/provider-orders/${button.dataset.cancelProviderOrder}/cancel`, { method: "POST", body: {} }); await loadData(); notify(tr("cancelDone"), true); } catch (error) { console.error(error); notify(error.message || tr("failed")); button.disabled = false; }
    }));
  }

  function input(name, label, value = "", options = {}) {
    const wide = options.wide ? " wide" : "";
    const required = options.required ? " required" : "";
    if (options.type === "textarea") return `<label class="${wide.trim()}"><span>${escape(label)}</span><textarea name="${name}"${required}>${escape(value)}</textarea></label>`;
    if (options.type === "select") return `<label class="${wide.trim()}"><span>${escape(label)}</span><select name="${name}"${required}>${options.values.map((item) => `<option value="${item}" ${item === value ? "selected" : ""}>${escape(status(item))}</option>`).join("")}</select></label>`;
    if (options.type === "checkbox") return `<label class="checkbox-field ${wide.trim()}"><input name="${name}" type="checkbox" ${value ? "checked" : ""}><span>${escape(label)}</span></label>`;
    return `<label class="${wide.trim()}"><span>${escape(label)}</span><input name="${name}" type="${options.type || "text"}" value="${escape(value ?? "")}"${required}${options.dir ? ` dir="${options.dir}"` : ""}></label>`;
  }

  function assetInput(name, label, value = "") {
    return `<label class="wide asset-upload-field"><span>${escape(label)}</span><input name="${name}" type="text" value="${escape(value || "")}" dir="ltr"><small>PNG, JPEG or WebP · max 500 KB</small><input type="file" accept="image/png,image/jpeg,image/webp" data-upload-target="${name}"></label>`;
  }

  async function applyUploads(form, body) {
    for (const field of form.querySelectorAll("[data-upload-target]")) {
      const file = field.files?.[0];
      if (!file) continue;
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size < 32 || file.size > 512000) {
        throw new Error("PNG, JPEG or WebP only; maximum size is 500 KB.");
      }
      body[field.dataset.uploadTarget] = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("The image could not be read."));
        reader.readAsDataURL(file);
      });
    }
    return body;
  }

  function editorDefinition(kind, item = null) {
    if (kind === "service") return {
      title: item ? tr("editService") : tr("createService"), endpoint: item ? `/api/platform/services/${item.id}` : "/api/platform/services", method: item ? "PUT" : "POST",
      html: input("serviceKey", "Key", item?.key, { required: true, dir: "ltr" }) + input("slug", "Slug", item?.slug, { required: true, dir: "ltr" }) + input("iconKey", "Icon", item?.iconKey || "code") + input("currency", tr("currency"), item?.currency || "USD", { dir: "ltr" }) + input("nameAr", "الاسم — AR", item?.name?.ar, { required: true }) + input("nameEn", "Name — EN", item?.name?.en, { required: true }) + input("descriptionAr", "الوصف — AR", item?.description?.ar, { type: "textarea", wide: true }) + input("descriptionEn", "Description — EN", item?.description?.en, { type: "textarea", wide: true }) + input("featuresAr", "المزايا — AR (سطر لكل ميزة)", (item?.features?.ar || []).join("\n"), { type: "textarea" }) + input("featuresEn", "Features — EN (one per line)", (item?.features?.en || []).join("\n"), { type: "textarea" }) + input("startingPriceMinor", "السعر الابتدائي (minor)", item?.startingPriceMinor ?? "", { type: "number" }) + input("estimatedDurationAr", "المدة — AR", item?.estimatedDuration?.ar) + input("estimatedDurationEn", "Timeline — EN", item?.estimatedDuration?.en) + input("whatsappTemplateAr", "رسالة واتساب — AR", item?.whatsappTemplate?.ar || "", { type: "textarea", wide: true }) + input("whatsappTemplateEn", "WhatsApp message — EN", item?.whatsappTemplate?.en || "", { type: "textarea", wide: true }) + input("status", tr("status"), item?.status || "active", { type: "select", values: ["active", "hidden", "coming_soon"] }) + input("sortOrder", tr("order"), item?.sortOrder || 0, { type: "number" }),
      body: (form) => ({
        serviceKey: fieldValue(form, "serviceKey"), slug: fieldValue(form, "slug"),
        iconKey: fieldValue(form, "iconKey"), currency: fieldValue(form, "currency"),
        nameAr: fieldValue(form, "nameAr"), nameEn: fieldValue(form, "nameEn"),
        descriptionAr: fieldValue(form, "descriptionAr"), descriptionEn: fieldValue(form, "descriptionEn"),
        featuresAr: fieldValue(form, "featuresAr").split("\n").map((value) => value.trim()).filter(Boolean),
        featuresEn: fieldValue(form, "featuresEn").split("\n").map((value) => value.trim()).filter(Boolean),
        startingPriceMinor: form.elements.startingPriceMinor.value === "" ? null : Number(form.elements.startingPriceMinor.value),
        estimatedDurationAr: fieldValue(form, "estimatedDurationAr"), estimatedDurationEn: fieldValue(form, "estimatedDurationEn"),
        whatsappTemplateAr: fieldValue(form, "whatsappTemplateAr"), whatsappTemplateEn: fieldValue(form, "whatsappTemplateEn"),
        status: fieldValue(form, "status"), sortOrder: fieldValue(form, "sortOrder")
      })
    };
    if (kind === "contact") return {
      title: item ? tr("editContact") : tr("createContact"), endpoint: item ? `/api/platform/contact-methods/${item.id}` : "/api/platform/contact-methods", method: item ? "PUT" : "POST",
      html: input("type", tr("type"), item?.type || "whatsapp", { type: "select", values: ["whatsapp", "telegram", "email", "instagram", "tiktok", "facebook", "discord", "phone", "website", "custom"] }) + input("iconKey", "Icon", item?.iconKey || item?.type || "whatsapp") + assetInput("iconUrl", "Icon image", item?.iconUrl || "") + input("nameAr", "الاسم — AR", item?.name?.ar, { required: true }) + input("nameEn", "Name — EN", item?.name?.en, { required: true }) + input("descriptionAr", "الوصف — AR", item?.description?.ar, { type: "textarea" }) + input("descriptionEn", "Description — EN", item?.description?.en, { type: "textarea" }) + input("target", tr("target"), item?.target, { required: true, wide: true, dir: "ltr" }) + input("workingHoursAr", "ساعات العمل — AR", item?.workingHours?.ar) + input("workingHoursEn", "Working hours — EN", item?.workingHours?.en) + input("messageTemplateAr", "رسالة واتساب — AR", item?.messageTemplate?.ar, { type: "textarea" }) + input("messageTemplateEn", "WhatsApp message — EN", item?.messageTemplate?.en, { type: "textarea" }) + input("status", tr("status"), item?.status || "active", { type: "select", values: ["active", "hidden", "disabled"] }) + input("sortOrder", tr("order"), item?.sortOrder || 0, { type: "number" }),
      body: (form) => Object.fromEntries(["type", "iconKey", "iconUrl", "nameAr", "nameEn", "descriptionAr", "descriptionEn", "target", "workingHoursAr", "workingHoursEn", "messageTemplateAr", "messageTemplateEn", "status", "sortOrder"].map((key) => [key, fieldValue(form, key)]))
    };
    if (kind === "payment") {
      const instructionAr = item?.instructions?.find((entry) => entry.locale === "ar") || {};
      const instructionEn = item?.instructions?.find((entry) => entry.locale === "en") || {};
      return {
        title: item ? tr("editPayment") : tr("createPayment"), endpoint: item ? `/api/platform/payment-methods/${item.id}` : "/api/platform/payment-methods", method: item ? "PUT" : "POST",
        html: input("key", "Key", item?.key, { required: true, dir: "ltr" }) + input("type", tr("type"), item?.type || "manual", { required: true }) + input("nameAr", "الاسم — AR", item?.name?.ar, { required: true }) + input("nameEn", "Name — EN", item?.name?.en, { required: true }) + input("currency", tr("currency"), item?.currency || "USD", { required: true, dir: "ltr" }) + input("network", tr("network"), item?.network || "", { dir: "ltr" }) + assetInput("logoUrl", "Logo", item?.logoUrl || "/assets/payment-assets/manual-payment.svg") + input("beneficiaryName", "Beneficiary", item?.beneficiaryName || "") + input("accountIdentifier", "Account / Address", item?.accountIdentifier || "", { wide: true, dir: "ltr" }) + input("qrMode", "QR Mode", item?.qrMode || "none", { type: "select", values: ["none", "generated", "uploaded"] }) + input("qrData", "QR Data", item?.qrData || "", { wide: true, dir: "ltr" }) + assetInput("qrImageUrl", "QR image", item?.qrImageUrl || "") + input("instructionTitleAr", "عنوان التعليمات — AR", instructionAr.title || "تعليمات التحويل") + input("instructionTitleEn", "Instruction title — EN", instructionEn.title || "Transfer instructions") + input("instructionAr", "تعليمات التحويل — AR", instructionAr.body || "", { type: "textarea", wide: true }) + input("instructionEn", "Transfer instructions — EN", instructionEn.body || "", { type: "textarea", wide: true }) + input("warningAr", "تحذير الشبكة — AR", instructionAr.warning || "", { type: "textarea" }) + input("warningEn", "Network warning — EN", instructionEn.warning || "", { type: "textarea" }) + input("minimumAmountMinor", "Minimum (minor)", item?.minimumAmountMinor ?? "", { type: "number" }) + input("maximumAmountMinor", "Maximum (minor)", item?.maximumAmountMinor ?? "", { type: "number" }) + input("status", tr("status"), item?.status || "coming_soon", { type: "select", values: ["active", "coming_soon", "disabled", "hidden"] }) + input("sortOrder", tr("order"), item?.sortOrder || 0, { type: "number" }),
        body: (form) => {
          const names = ["key", "type", "nameAr", "nameEn", "currency", "network", "logoUrl", "beneficiaryName", "accountIdentifier", "qrMode", "qrData", "qrImageUrl", "instructionTitleAr", "instructionTitleEn", "instructionAr", "instructionEn", "warningAr", "warningEn", "status", "sortOrder"];
          const result = Object.fromEntries(names.map((key) => [key, fieldValue(form, key)]));
          for (const key of ["minimumAmountMinor", "maximumAmountMinor"]) {
            result[key] = form.elements[key].value === "" ? null : Number(form.elements[key].value);
          }
          return result;
        }
      };
    }
    if (kind === "provider") return {
      title: item ? tr("editProvider") : tr("createProvider"), endpoint: item ? `/api/platform/providers/${item.id}` : "/api/platform/providers", method: item ? "PUT" : "POST",
      html: input("internalName", tr("internalProviderName"), item?.internalName || "", { required: true, wide: true }) + input("adapterKey", tr("adapter"), item?.adapterKey || "mock", { type: "select", values: ["mock", "http-json-v1"] }) + input("currency", tr("currency"), item?.currency || "USD", { required: true, dir: "ltr" }) + input("baseUrl", tr("baseUrl"), item?.baseUrl || "", { wide: true, dir: "ltr" }) + input("testMode", tr("testMode"), item?.testMode ?? true, { type: "checkbox" }) + input("status", tr("status"), item?.status || "active", { type: "select", values: ["active", "disabled"] }) + input("capabilities", tr("capabilities"), (item?.capabilities || []).join("\n"), { type: "textarea", wide: true }) + input("primaryCredential", tr("primaryCredential"), "", { type: "password", wide: true, dir: "ltr" }) + input("webhookSecret", tr("webhookSecret"), "", { type: "password", wide: true, dir: "ltr" }) + `<p class="wide editor-security-note">${escape(tr("credentialHint"))}${item?.webhookUrl ? `<br><b>${escape(tr("webhookUrl"))}:</b> <code>${escape(item.webhookUrl)}</code>` : ""}</p>`,
      body: (form) => ({ internalName: fieldValue(form, "internalName"), adapterKey: fieldValue(form, "adapterKey"), currency: fieldValue(form, "currency"), baseUrl: fieldValue(form, "baseUrl"), testMode: Boolean(form.elements.testMode.checked), status: fieldValue(form, "status"), capabilities: fieldValue(form, "capabilities").split("\n").map((value) => value.trim()).filter(Boolean), primaryCredential: fieldValue(form, "primaryCredential"), webhookSecret: fieldValue(form, "webhookSecret") })
    };
    return {
      title: item ? tr("editBanner") : tr("createBanner"), endpoint: item ? `/api/platform/banners/${item.id}` : "/api/platform/banners", method: item ? "PUT" : "POST",
      html: input("titleAr", "العنوان — AR", item?.title?.ar, { required: true }) + input("titleEn", "Title — EN", item?.title?.en, { required: true }) + input("subtitleAr", "الوصف — AR", item?.subtitle?.ar, { type: "textarea" }) + input("subtitleEn", "Description — EN", item?.subtitle?.en, { type: "textarea" }) + assetInput("imageUrl", "Banner image", item?.imageUrl || "/assets/marketing-assets/slide-commerce.svg") + input("linkUrl", "Link URL", item?.linkUrl || "/services", { wide: true, dir: "ltr" }) + input("actionLabelAr", "نص الزر — AR", item?.actionLabel?.ar) + input("actionLabelEn", "Button — EN", item?.actionLabel?.en) + input("status", tr("status"), item?.status || "active", { type: "select", values: ["active", "hidden"] }) + input("sortOrder", tr("order"), item?.sortOrder || 0, { type: "number" }),
      body: (form) => Object.fromEntries(["titleAr", "titleEn", "subtitleAr", "subtitleEn", "imageUrl", "linkUrl", "actionLabelAr", "actionLabelEn", "status", "sortOrder"].map((key) => [key, fieldValue(form, key)]))
    };
  }

  function openEditor(kind, item = null) {
    state.editor = editorDefinition(kind, item);
    document.getElementById("editorKicker").textContent = tr(kind === "service" ? "services" : kind === "contact" ? "contacts" : kind === "payment" ? "payments" : kind === "provider" ? "providers" : "banners");
    document.getElementById("editorTitle").textContent = state.editor.title;
    document.getElementById("editorFields").innerHTML = state.editor.html;
    document.getElementById("editorNotice").hidden = true;
    const dialog = document.getElementById("platformEditor");
    if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
  }

  async function saveEditor(event) {
    event.preventDefault();
    if (!state.editor) return;
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const notice = document.getElementById("editorNotice");
    button.disabled = true; button.textContent = tr("working"); notice.hidden = true;
    try {
      const body = await applyUploads(form, state.editor.body(form));
      await api(state.editor.endpoint, { method: state.editor.method, body });
      document.getElementById("platformEditor").close();
      await loadData();
      notify(tr("saved"), true);
    } catch (error) {
      console.error(error); notice.textContent = error.message || tr("failed"); notice.hidden = false; button.disabled = false; button.textContent = tr("save");
    }
  }

  function notify(message, success = false) {
    const node = document.getElementById("platformNotice");
    node.textContent = message; node.classList.toggle("success", success); node.hidden = false;
    window.setTimeout(() => { node.hidden = true; }, 5000);
  }

  async function loadData() {
    state.data = await api("/api/platform/portal");
    renderSection();
  }

  async function useSession() {
    try {
      const me = await api("/api/me");
      if (!me.user?.isPlatformAdmin) throw Object.assign(new Error(tr("forbidden")), { status: 403 });
      state.me = me.user; state.csrf = me.csrfToken;
      document.getElementById("platformAdminName").textContent = me.user.displayName || me.user.email;
      document.getElementById("platformLogin").hidden = true;
      document.getElementById("platformWorkspace").hidden = false;
      await loadData();
    } catch (error) {
      document.getElementById("platformWorkspace").hidden = true;
      document.getElementById("platformLogin").hidden = false;
      if (error.status && error.status !== 401) { const notice = document.getElementById("loginNotice"); notice.textContent = error.message || tr("forbidden"); notice.hidden = false; }
    }
  }

  async function login(event) {
    event.preventDefault();
    const form = event.currentTarget; const notice = document.getElementById("loginNotice"); const button = form.querySelector('[type="submit"]');
    button.disabled = true; notice.hidden = true;
    try {
      const result = await api("/api/auth/login", { method: "POST", body: { email: form.elements.email.value, password: form.elements.password.value } });
      if (!result.user?.isPlatformAdmin) throw Object.assign(new Error(tr("forbidden")), { status: 403 });
      await useSession();
    } catch (error) { notice.textContent = error.message || tr("loginFailed"); notice.hidden = false; button.disabled = false; }
  }

  async function logout() {
    try { await api("/api/auth/logout", { method: "POST", body: {} }); } finally { location.reload(); }
  }

  function initialize() {
    document.documentElement.lang = state.locale;
    document.documentElement.dir = state.locale === "ar" ? "rtl" : "ltr";
    renderNav();
    document.getElementById("platformLoginForm").addEventListener("submit", login);
    document.getElementById("platformLogout").addEventListener("click", logout);
    document.getElementById("refreshPlatform").addEventListener("click", () => loadData().catch((error) => notify(error.message || tr("failed"))));
    document.getElementById("platformMenu").addEventListener("click", () => document.querySelector(".platform-admin-shell").classList.toggle("menu-open"));
    document.querySelectorAll("[data-language-toggle]").forEach((button) => button.addEventListener("click", () => {
      state.locale = state.locale === "ar" ? "en" : "ar";
      try { localStorage.setItem(LANGUAGE_KEY, state.locale); } catch { /* optional */ }
      applyLanguage();
    }));
    const editor = document.getElementById("platformEditor");
    document.querySelector("[data-editor-close]").addEventListener("click", () => editor.close());
    editor.addEventListener("click", (event) => { if (event.target === editor) editor.close(); });
    document.getElementById("platformEditorForm").addEventListener("submit", saveEditor);
    applyLanguage();
    useSession();
  }

  initialize();
})();
