(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const slug = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] || "");
  const state = {
    slug,
    store: null,
    design: null,
    customer: null,
    csrf: "",
    shell: null,
    wallet: null,
    methods: [],
    selectedMethod: null,
    proofDataUrl: "",
    balanceVisible: localStorage.getItem(`uchiha:balance:${slug}`) !== "hidden",
    payments: { status: "all", query: "", offset: 0, hasMore: false },
    orders: { query: "", status: "all", dateFrom: "", dateTo: "", offset: 0, hasMore: false },
    identityFiles: {},
    identityFileMaxBytes: 4_000_000,
    loginChallengeToken: "",
    loginChallengeExpiresAt: null,
    developer: { key: null, enabled: false, baseUrl: "", codeTab: "curl" },
    currentOrderId: new URLSearchParams(location.search).get("orderId") || ""
  };

  const api = async (path, options = {}) => {
    const request = { credentials: "same-origin", ...options };
    if (request.body && !(request.body instanceof FormData) && typeof request.body !== "string") {
      request.headers = { "content-type": "application/json", ...(request.headers || {}) };
      request.body = JSON.stringify(request.body);
    }
    const response = await fetch(path, request);
    const type = response.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const error = new Error(data?.message || "تعذر تنفيذ الطلب");
      error.status = response.status;
      error.code = data?.error;
      error.details = data?.details;
      throw error;
    }
    return data;
  };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const currencyMinorFactor = (currency) => {
    try {
      const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
      return 10 ** digits;
    } catch {
      return 100;
    }
  };

  const money = (minor, currency = state.customer?.currency || state.store?.currency || "USD") => {
    const factor = currencyMinorFactor(currency);
    return new Intl.NumberFormat("ar", { style: "currency", currency }).format(Number(minor || 0) / factor);
  };

  const dateTime = (value) => value ? new Date(value).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" }) : "—";
  const shortDate = (value) => value ? new Date(value).toLocaleDateString("ar", { dateStyle: "medium" }) : "—";

  function showNotice(element, message, type = "error") {
    if (!element) return;
    element.textContent = message;
    element.className = `notice ${type === "ok" ? "ok" : type === "error" ? "error" : ""}`;
    element.hidden = false;
  }

  function hideNotice(element) {
    if (!element) return;
    element.hidden = true;
    element.textContent = "";
  }

  function toast(message, type = "ok") {
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.textContent = message;
    $("toastRegion").append(item);
    setTimeout(() => item.remove(), 3600);
  }

  function setBusy(button, busy, label = "جارٍ التنفيذ") {
    if (!button) return;
    if (busy) {
      button.dataset.previousText = button.textContent;
      button.disabled = true;
      button.textContent = label;
    } else {
      button.disabled = false;
      if (button.dataset.previousText) button.textContent = button.dataset.previousText;
    }
  }

  function copyText(value) {
    if (!value) return;
    navigator.clipboard?.writeText(value).then(() => toast("تم النسخ")).catch(() => {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      toast("تم النسخ");
    });
  }

  function methodIcon(method) {
    if (method.logoUrl) return method.logoUrl;
    return ({
      binance_pay: "/assets/payment-assets/instant-pay.svg",
      usdt_trc20: "/assets/payment-assets/crypto-transfer.svg",
      sham_cash: "/assets/payment-assets/cash-wallet.svg",
      bank_transfer: "/assets/payment-assets/bank-transfer.svg",
      manual: "/assets/payment-assets/manual-payment.svg"
    })[method.type] || "/assets/payment-assets/manual-payment.svg";
  }

  function statusInfo(status) {
    const map = {
      pending: ["قيد المراجعة", "warning"],
      approved: ["مكتملة", "success"],
      rejected: ["مرفوضة", "danger"],
      cancelled: ["ملغية", "danger"],
      new: ["قيد المراجعة", "warning"],
      awaiting_payment: ["بانتظار الدفع", "warning"],
      paid: ["مقبول", "info"],
      processing: ["قيد التنفيذ", "warning"],
      completed: ["مكتمل", "success"],
      partial: ["مكتمل جزئيًا", "info"],
      failed: ["مرفوض", "danger"],
      requires_review: ["يحتاج مراجعة", "warning"],
      draft: ["مسودة", "warning"],
      pending_review: ["قيد المراجعة", "warning"],
      changes_required: ["يحتاج تعديل", "warning"],
      verified: ["موثق", "success"]
    };
    return map[status] || [status || "غير معروف", "info"];
  }

  function statusPill(status) {
    const [label, style] = statusInfo(status);
    return `<span class="status-pill ${style}">${escapeHtml(label)}</span>`;
  }

  function applyDesign(store) {
    const design = store?.design || {};
    const root = document.documentElement;
    const values = {
      "--store-primary": design.primaryColor || "#d91f32",
      "--store-secondary": design.secondaryColor || "#6f111b",
      "--store-background": design.backgroundColor || "#08090d",
      "--store-surface": design.surfaceColor || "#111218",
      "--store-text": design.textColor || "#f6f6f8",
      "--store-muted": design.mutedTextColor || "#9698a3",
      "--store-border": design.borderColor || "#262832",
      "--store-success": design.successColor || "#24c768",
      "--store-warning": design.warningColor || "#f0a51c",
      "--store-danger": design.dangerColor || "#e3404d",
      "--store-radius": design.borderRadius || "18px",
      "--store-font": `${design.fontFamily || "Tajawal"}, Cairo, system-ui, sans-serif`
    };
    Object.entries(values).forEach(([key, value]) => root.style.setProperty(key, value));
    document.title = `${store.name} | حسابي`;
    ["headerStoreName", "authStoreName", "aboutStoreName"].forEach((id) => { if ($(id)) $(id).textContent = store.name; });
    $("aboutDescription").textContent = store.description || "متجر رقمي يقدم منتجات وخدمات واضحة وسريعة.";
    $("drawerRights").textContent = `© ${new Date().getFullYear()} ${store.name}`;
    const letter = store.name.trim().slice(0, 1) || "U";
    ["headerTextLogo", "authLogo", "aboutLogo"].forEach((id) => { if ($(id)) $(id).textContent = letter; });
    if (design.logoUrl) {
      $("headerLogo").src = design.logoUrl;
      $("headerLogo").alt = `شعار ${store.name}`;
      $("headerLogo").hidden = false;
      $("headerTextLogo").hidden = true;
    }
  }

  function hydrateCustomer() {
    const customer = state.customer;
    if (!customer) return;
    const initial = customer.displayName?.trim().slice(0, 1) || "ح";
    ["avatarInitial", "profileInitial", "drawerAvatar"].forEach((id) => { if ($(id)) $(id).textContent = initial; });
    $("profileName").textContent = customer.displayName;
    $("profileEmail").textContent = customer.email;
    $("profileId").textContent = `ID: ${customer.id}`;
    $("drawerName").textContent = customer.displayName;
    $("drawerId").textContent = `ID: ${customer.id.slice(0, 12)}`;
    if (customer.avatarUrl) {
      ["avatarImage", "profileAvatarImage"].forEach((id) => {
        $(id).src = customer.avatarUrl;
        $(id).hidden = false;
      });
      $("avatarInitial").hidden = true;
      $("profileInitial").hidden = true;
    }
    renderBalance();
  }

  function renderBalance() {
    const customer = state.customer;
    if (!customer) return;
    const hidden = !state.balanceVisible;
    const value = hidden ? "••••" : money(customer.balanceMinor, customer.currency);
    $("headerBalanceValue").textContent = value;
    $("drawerBalanceValue").textContent = value;
    $("headerCurrency").textContent = customer.currency;
    $("drawerCurrency").textContent = customer.currency;
    if ($("walletBalance")) $("walletBalance").textContent = value;
    if ($("walletCurrencyLabel")) $("walletCurrencyLabel").textContent = customer.currency;
  }

  function routeFor(section) {
    const routes = {
      account: `/store/${encodeURIComponent(slug)}/account`,
      wallet: `/store/${encodeURIComponent(slug)}/wallet`,
      "add-funds": `/store/${encodeURIComponent(slug)}/wallet#add-funds`,
      payments: `/store/${encodeURIComponent(slug)}/payments`,
      orders: `/store/${encodeURIComponent(slug)}/orders`,
      support: `/store/${encodeURIComponent(slug)}/support`,
      telegram: `/store/${encodeURIComponent(slug)}/telegram`,
      security: `/store/${encodeURIComponent(slug)}/security`,
      identity: `/store/${encodeURIComponent(slug)}/identity`,
      developer: `/store/${encodeURIComponent(slug)}/developer`,
      about: `/store/${encodeURIComponent(slug)}/about`,
      notifications: `/store/${encodeURIComponent(slug)}/account#notifications`
    };
    return routes[section] || routes.account;
  }

  function sectionFromLocation() {
    const path = location.pathname.split("/").filter(Boolean)[2] || "account";
    if (location.hash === "#add-funds") return "add-funds";
    if (location.hash === "#notifications") return "notifications";
    return ({ wallet: "wallet", payments: "payments", orders: "orders", support: "support", telegram: "telegram", security: "security", identity: "identity", developer: "developer", about: "about", account: "account" })[path] || "account";
  }

  async function navigate(section, { push = true, orderId = "" } = {}) {
    document.querySelectorAll("[data-section]").forEach((element) => { element.hidden = element.dataset.section !== section; });
    document.querySelectorAll(".account-bottom-nav [data-go]").forEach((button) => button.classList.toggle("active", button.dataset.go === section));
    if (push) {
      let target = routeFor(section);
      if (section === "support" && orderId) target += `?orderId=${encodeURIComponent(orderId)}&context=${encodeURIComponent("مشكلة في الطلب")}`;
      history.pushState({ section }, "", target);
    }
    $("accountDrawer")?.close();
    window.scrollTo({ top: 0, behavior: "auto" });
    try {
      if (section === "wallet") await loadWallet();
      if (section === "add-funds") await loadPaymentMethods();
      if (section === "payments") await loadPayments(true);
      if (section === "orders") await loadOrders(true);
      if (section === "support") await loadSupport(orderId || new URLSearchParams(location.search).get("orderId") || "");
      if (section === "telegram") await loadTelegram();
      if (section === "security") await loadSecurity();
      if (section === "identity") await loadIdentity();
      if (section === "developer") renderDeveloper();
      if (section === "about") renderAbout();
      if (section === "notifications") renderNotifications();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function bindNavigation() {
    document.querySelectorAll("[data-go]").forEach((element) => {
      element.addEventListener("click", () => navigate(element.dataset.go));
    });
    $("headerProfile").addEventListener("click", () => navigate("account"));
    $("headerNotifications").addEventListener("click", () => navigate("notifications"));
    $("headerBack").addEventListener("click", () => {
      if (history.length > 1) history.back();
      else location.href = `/store/${encodeURIComponent(slug)}`;
    });
    ["headerBrand", "bottomHome", "drawerHome"].forEach((id) => { $(id).href = `/store/${encodeURIComponent(slug)}`; });
    $("bottomCart").href = `/store/${encodeURIComponent(slug)}#cart`;
    $("drawerOpen").addEventListener("click", () => $("accountDrawer").showModal());
    $("drawerClose").addEventListener("click", () => $("accountDrawer").close());
    $("accountDrawer").addEventListener("click", (event) => { if (event.target === $("accountDrawer")) $("accountDrawer").close(); });
    window.addEventListener("popstate", () => navigate(sectionFromLocation(), { push: false }));
    document.querySelectorAll("[data-dialog-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  }

  function showTotpLogin() {
    $("authTabs").hidden = true;
    $("loginForm").hidden = true;
    $("registerForm").hidden = true;
    $("totpLoginForm").hidden = false;
    const expiry = state.loginChallengeExpiresAt ? new Date(state.loginChallengeExpiresAt) : null;
    $("totpChallengeExpiry").textContent = expiry
      ? `تنتهي جلسة التحقق الساعة ${expiry.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}`
      : "جلسة التحقق قصيرة العمر";
    $("totpLoginForm").elements.code.focus();
  }

  function showPasswordLogin() {
    state.loginChallengeToken = "";
    state.loginChallengeExpiresAt = null;
    $("authTabs").hidden = false;
    $("totpLoginForm").hidden = true;
    $("loginForm").hidden = false;
    $("registerForm").hidden = true;
    document.querySelectorAll("[data-auth-tab]").forEach((item) => item.classList.toggle("active", item.dataset.authTab === "login"));
    hideNotice($("authNotice"));
  }

  function bindAuth() {
    document.querySelectorAll("[data-auth-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-auth-tab]").forEach((item) => item.classList.toggle("active", item === button));
        $("loginForm").hidden = button.dataset.authTab !== "login";
        $("registerForm").hidden = button.dataset.authTab !== "register";
        hideNotice($("authNotice"));
      });
    });
    $("loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice($("authNotice"));
      const button = event.currentTarget.querySelector("button[type=submit]");
      setBusy(button, true, "جارٍ الدخول");
      try {
        const body = Object.fromEntries(new FormData(event.currentTarget));
        const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/customers/login`, { method: "POST", body });
        if (data.totpRequired) {
          state.loginChallengeToken = data.challengeToken;
          state.loginChallengeExpiresAt = data.expiresAt;
          showTotpLogin();
          return;
        }
        state.customer = data.customer;
        state.csrf = data.csrfToken;
        await afterAuthentication();
      } catch (error) {
        showNotice($("authNotice"), error.message);
      } finally {
        setBusy(button, false);
      }
    });
    $("registerForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice($("authNotice"));
      const button = event.currentTarget.querySelector("button[type=submit]");
      setBusy(button, true, "جارٍ إنشاء الحساب");
      try {
        const body = Object.fromEntries(new FormData(event.currentTarget));
        const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/customers/register`, { method: "POST", body });
        state.customer = data.customer;
        state.csrf = data.csrfToken;
        await afterAuthentication();
      } catch (error) {
        showNotice($("authNotice"), error.message);
      } finally {
        setBusy(button, false);
      }
    });
    $("totpLoginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice($("authNotice"));
      const button = event.currentTarget.querySelector("button[type=submit]");
      setBusy(button, true, "جارٍ التحقق");
      try {
        if (!state.loginChallengeToken) throw new Error("انتهت جلسة التحقق، أعد إدخال كلمة المرور");
        const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/customers/login/totp`, {
          method: "POST",
          body: {
            challengeToken: state.loginChallengeToken,
            code: new FormData(event.currentTarget).get("code")
          }
        });
        state.loginChallengeToken = "";
        state.loginChallengeExpiresAt = null;
        state.customer = data.customer;
        state.csrf = data.csrfToken;
        await afterAuthentication();
      } catch (error) {
        showNotice($("authNotice"), error.message);
      } finally {
        setBusy(button, false);
      }
    });
    $("cancelTotpLogin").addEventListener("click", showPasswordLogin);
    $("logoutButton").addEventListener("click", async () => {
      try {
        await api(`/api/public/stores/${encodeURIComponent(slug)}/customers/logout`, { method: "POST", headers: { "x-customer-csrf-token": state.csrf } });
      } catch {}
      location.reload();
    });
  }

  async function afterAuthentication() {
    $("authSection").hidden = true;
    $("accountContent").hidden = false;
    document.querySelector(".account-bottom-nav").hidden = false;
    hydrateCustomer();
    state.shell = await api(`/api/public/stores/${encodeURIComponent(slug)}/account-shell`);
    const experience = state.shell.experience || {};
    document.querySelectorAll('[data-go="identity"]').forEach((item) => { item.hidden = !experience.identityVerificationEnabled; });
    document.querySelectorAll("[data-theme-toggle]").forEach((item) => { item.hidden = !experience.lightModeEnabled; });
    const platformLink = experience.builderPromoUrl || state.store.contacts?.builderUrl || location.origin;
    $("drawerBuilderLink").href = platformLink;
    await navigate(sectionFromLocation(), { push: false });
  }

  async function loadWallet() {
    const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/wallet`);
    state.wallet = data;
    state.customer.balanceMinor = data.wallet.balanceMinor;
    state.customer.currency = data.wallet.currency;
    renderBalance();
    const incoming = data.ledger.filter((entry) => Number(entry.amountMinor) > 0).reduce((sum, entry) => sum + Number(entry.amountMinor), 0);
    const purchases = Math.abs(data.ledger.filter((entry) => entry.type === "purchase" || Number(entry.amountMinor) < 0).reduce((sum, entry) => sum + Number(entry.amountMinor), 0));
    $("totalIncoming").textContent = money(incoming, data.wallet.currency);
    $("totalPurchases").textContent = money(purchases, data.wallet.currency);
    const entries = data.ledger.slice(0, 8);
    $("ledgerList").innerHTML = entries.length ? entries.map((entry) => `
      <article class="timeline-item">
        <span class="timeline-dot">${entry.amountMinor >= 0 ? "+" : "−"}</span>
        <div><h3>${escapeHtml(entry.note || ledgerLabel(entry.type))}</h3><p>${dateTime(entry.createdAt)} · الرصيد بعد العملية ${money(entry.balanceAfterMinor, data.wallet.currency)}</p></div>
        <strong>${entry.amountMinor >= 0 ? "+" : ""}${money(entry.amountMinor, data.wallet.currency)}</strong>
      </article>`).join("") : '<div class="empty-state">لا توجد عمليات في المحفظة بعد.</div>';
    state.wallet.notifications = data.notifications || [];
    renderNotifications();
    updateUnread();
  }

  function ledgerLabel(type) {
    return ({ deposit: "إضافة رصيد", purchase: "شراء", refund: "استرداد", adjustment: "تعديل إداري", fee: "عمولة", hold: "حجز مبلغ", unhold: "إلغاء حجز" })[type] || "حركة مالية";
  }

  function updateUnread() {
    const notifications = state.wallet?.notifications || [];
    const count = notifications.filter((item) => !item.readAt).length;
    $("unreadBadge").hidden = count === 0;
    $("unreadBadge").textContent = String(Math.min(count, 99));
  }

  function renderNotifications() {
    const notifications = state.wallet?.notifications || [];
    $("notificationsList").innerHTML = notifications.length ? notifications.map((item) => `
      <article class="record-card">
        <div class="record-card-header"><span class="record-icon">●</span><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.message)}</p></div>${item.readAt ? "" : '<span class="status-pill info">جديد</span>'}</div>
        <div class="record-meta"><div><span>النوع</span><b>${escapeHtml(item.type)}</b></div><div><span>التاريخ</span><b>${shortDate(item.createdAt)}</b></div></div>
      </article>`).join("") : '<div class="empty-state">لا توجد إشعارات بعد.</div>';
  }

  async function loadPaymentMethods() {
    if (!state.methods.length) {
      const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/payment-methods`);
      state.methods = data.methods || [];
    }
    $("paymentMethodsStep").hidden = false;
    $("paymentTransferStep").hidden = true;
    $("fundsSubtitle").textContent = "اختر طريقة الدفع المناسبة.";
    $("paymentMethods").innerHTML = state.methods.length ? state.methods.map((method) => `
      <button class="payment-method-card" data-method-id="${escapeHtml(method.id)}" type="button">
        <img src="${escapeHtml(methodIcon(method))}" alt="${escapeHtml(method.name)}">
        <b>${escapeHtml(method.name)}</b>
      </button>`).join("") : '<div class="empty-state">لا توجد طرق دفع مفعلة حاليًا.</div>';
    document.querySelectorAll("[data-method-id]").forEach((button) => button.addEventListener("click", () => openTransfer(state.methods.find((method) => method.id === button.dataset.methodId))));
  }

  function destinationText(destination = {}) {
    return destination.address || destination.account || destination.payId || destination.wallet || destination.number || destination.value || Object.values(destination).find((value) => typeof value === "string") || "—";
  }

  function openTransfer(method) {
    state.selectedMethod = method;
    state.proofDataUrl = "";
    $("paymentMethodsStep").hidden = true;
    $("paymentTransferStep").hidden = false;
    $("fundsSubtitle").textContent = "أدخل المبلغ وارفع صورة الإثبات في الصفحة نفسها.";
    $("transferMethodLogo").src = methodIcon(method);
    $("transferMethodName").textContent = method.name;
    $("transferMethodNetwork").textContent = method.network || "";
    $("transferMinimum").textContent = money(method.minimumAmountMinor, method.currency || state.customer.currency);
    $("transferMaximumRow").hidden = method.maximumAmountMinor === null || method.maximumAmountMinor === undefined;
    $("transferMaximum").textContent = method.maximumAmountMinor === null ? "—" : money(method.maximumAmountMinor, method.currency || state.customer.currency);
    $("transferDestination").textContent = destinationText(method.destination);
    $("transferInstructions").textContent = method.instructions || "اتبع تعليمات التحويل ثم ارفع صورة واضحة للإثبات.";
    $("transferQr").hidden = !method.qrUrl;
    if (method.qrUrl) $("transferQr").src = method.qrUrl;
    const factor = currencyMinorFactor(method.currency || state.customer.currency);
    $("depositAmount").min = String(Number(method.minimumAmountMinor || 1) / factor);
    $("depositAmount").step = String(1 / factor);
    if (method.maximumAmountMinor !== null) $("depositAmount").max = String(Number(method.maximumAmountMinor) / factor);
    else $("depositAmount").removeAttribute("max");
    $("depositAmount").value = "";
    $("depositProof").value = "";
    $("proofPreview").hidden = true;
    $("proofPrompt").hidden = false;
    hideNotice($("depositNotice"));
    calculateDeposit();
  }

  function calculateDeposit() {
    const method = state.selectedMethod;
    if (!method) return;
    const currency = method.currency || state.customer.currency;
    const amountMinor = Math.round(Number($("depositAmount").value || 0) * currencyMinorFactor(currency));
    const percent = Math.round(amountMinor * (Number(method.commissionBps || 0) / 10000));
    const variable = Math.max(percent, Number(method.commissionMinimumMinor || 0));
    const commission = variable + Number(method.fixedFeeMinor || 0);
    $("commissionAmount").textContent = amountMinor ? money(commission, currency) : "—";
    $("netAmount").textContent = amountMinor ? money(Math.max(0, amountMinor - commission), currency) : "—";
  }

  function bindDeposits() {
    $("backToMethods").addEventListener("click", () => loadPaymentMethods());
    $("copyDestination").addEventListener("click", () => copyText($("transferDestination").textContent));
    $("depositAmount").addEventListener("input", calculateDeposit);
    $("depositProof").addEventListener("change", () => {
      const file = $("depositProof").files[0];
      if (!file) return;
      const max = state.selectedMethod?.proofMaxBytes || 1_500_000;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > max) {
        showNotice($("depositNotice"), `اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز ${(max / 1_000_000).toFixed(1)} MB`);
        $("depositProof").value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        state.proofDataUrl = String(reader.result);
        $("proofPreview").src = state.proofDataUrl;
        $("proofPreview").hidden = false;
        $("proofPrompt").hidden = true;
      };
      reader.readAsDataURL(file);
    });
    $("depositForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice($("depositNotice"));
      const method = state.selectedMethod;
      if (!method) return showNotice($("depositNotice"), "اختر طريقة الدفع");
      const currency = method.currency || state.customer.currency;
      const amountMinor = Math.round(Number($("depositAmount").value || 0) * currencyMinorFactor(currency));
      if (!amountMinor) return showNotice($("depositNotice"), "أدخل المبلغ الذي قمت بتحويله");
      if (!state.proofDataUrl) return showNotice($("depositNotice"), "ارفع صورة إثبات التحويل");
      const button = $("submitDeposit");
      setBusy(button, true, "جارٍ تقديم الطلب");
      try {
        const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/deposits`, {
          method: "POST",
          headers: { "x-customer-csrf-token": state.csrf, "idempotency-key": crypto.randomUUID() },
          body: { paymentMethodId: method.id, amountMinor, proofDataUrl: state.proofDataUrl }
        });
        showNotice($("depositNotice"), `تم إنشاء الطلب ${data.deposit.id.slice(0, 8)} وهو الآن قيد المراجعة.`, "ok");
        toast("تم تقديم طلب الشحن");
        state.methods = [];
        setTimeout(() => navigate("payments"), 700);
      } catch (error) {
        showNotice($("depositNotice"), error.message);
      } finally {
        setBusy(button, false);
      }
    });
  }

  async function loadPayments(reset = true) {
    if (reset) state.payments.offset = 0;
    const params = new URLSearchParams({ status: state.payments.status, query: state.payments.query, limit: "20", offset: String(state.payments.offset) });
    const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/deposits?${params}`);
    const html = data.payments.length ? data.payments.map(paymentCard).join("") : '<div class="empty-state">لا توجد دفعات مطابقة.</div>';
    if (reset) $("paymentsList").innerHTML = html;
    else $("paymentsList").insertAdjacentHTML("beforeend", html);
    state.payments.hasMore = data.pagination.hasMore;
    $("loadMorePayments").hidden = !data.pagination.hasMore;
    $("loadMorePayments").onclick = () => { state.payments.offset += data.pagination.limit; loadPayments(false); };
    document.querySelectorAll("[data-payment-id]").forEach((button) => button.addEventListener("click", () => {
      const payment = data.payments.find((item) => item.id === button.dataset.paymentId);
      if (payment) openPaymentDetails(payment);
    }));
  }

  function paymentCard(payment) {
    return `<button class="record-card" data-payment-id="${escapeHtml(payment.id)}" type="button">
      <div class="record-card-header"><img src="${escapeHtml(payment.method.logoUrl || methodIcon(payment.method))}" alt=""><div><h3>${escapeHtml(payment.method.name)}</h3><p>#${escapeHtml(payment.id.slice(0, 8).toUpperCase())} · ${dateTime(payment.createdAt)}</p></div>${statusPill(payment.status)}</div>
      <div class="record-meta"><div><span>المحوّل</span><b>${money(payment.requestedAmountMinor, payment.currency)}</b></div><div><span>العمولة</span><b>${money(payment.commissionMinor, payment.currency)}</b></div><div><span>الصافي</span><b>${money(payment.netAmountMinor, payment.currency)}</b></div></div>
    </button>`;
  }

  async function openPaymentDetails(payment) {
    $("paymentDetailsTitle").textContent = `#${payment.id.slice(0, 8).toUpperCase()}`;
    $("paymentDetailsBody").innerHTML = '<div class="skeleton-list"></div>';
    $("paymentDetailsDialog").showModal();
    try {
      const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/deposits/${encodeURIComponent(payment.id)}`);
      const detail = data.payment;
      $("paymentDetailsBody").innerHTML = `
        <div class="details-block"><div class="details-row"><span>طريقة الدفع</span><b>${escapeHtml(detail.method.name)}</b></div><div class="details-row"><span>الحالة</span><b>${statusInfo(detail.status)[0]}</b></div><div class="details-row"><span>المبلغ المحول</span><b>${money(detail.requestedAmountMinor, detail.currency)}</b></div><div class="details-row"><span>العمولة</span><b>${money(detail.commissionMinor, detail.currency)}</b></div><div class="details-row"><span>الصافي</span><b>${money(detail.netAmountMinor, detail.currency)}</b></div><div class="details-row"><span>تاريخ الإنشاء</span><b>${dateTime(detail.createdAt)}</b></div><div class="details-row"><span>تاريخ المراجعة</span><b>${dateTime(detail.reviewedAt)}</b></div></div>
        ${detail.reviewNote ? `<div class="notice error">${escapeHtml(detail.reviewNote)}</div>` : ""}
        <div class="details-block"><h3>صورة الإثبات</h3><img class="proof-detail" src="${detail.proof.data}" alt="صورة إثبات التحويل"></div>`;
    } catch (error) {
      $("paymentDetailsBody").innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
    }
    $("paymentSupportButton").onclick = () => { $("paymentDetailsDialog").close(); navigate("support", { orderId: "" }); };
  }

  function bindPaymentFilters() {
    let timer;
    $("paymentsSearch").addEventListener("input", (event) => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.payments.query = event.target.value.trim(); loadPayments(true); }, 300);
    });
    document.querySelectorAll("[data-payment-status]").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll("[data-payment-status]").forEach((item) => item.classList.toggle("active", item === button));
      state.payments.status = button.dataset.paymentStatus;
      loadPayments(true);
    }));
  }

  async function loadOrders(reset = true) {
    if (reset) state.orders.offset = 0;
    const params = new URLSearchParams({ query: state.orders.query, status: state.orders.status, dateFrom: state.orders.dateFrom, dateTo: state.orders.dateTo, limit: "20", offset: String(state.orders.offset) });
    const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/customer/orders?${params}`);
    const html = data.orders.length ? data.orders.map(orderCard).join("") : '<div class="empty-state">لا توجد طلبات مطابقة.</div>';
    if (reset) $("ordersList").innerHTML = html;
    else $("ordersList").insertAdjacentHTML("beforeend", html);
    $("ordersCount").textContent = String(data.summary?.count || 0);
    $("ordersSpend").textContent = money(data.summary?.spendMinor || 0, data.summary?.currency || state.customer.currency);
    state.orders.hasMore = data.pagination?.hasMore;
    $("loadMoreOrders").hidden = !data.pagination?.hasMore;
    $("loadMoreOrders").onclick = () => { state.orders.offset += data.pagination.limit; loadOrders(false); };
    document.querySelectorAll("[data-order-id]").forEach((button) => button.addEventListener("click", () => openOrderDetails(button.dataset.orderId)));
  }

  function orderCard(order) {
    return `<button class="record-card" data-order-id="${escapeHtml(order.id)}" type="button">
      <div class="record-card-header"><img src="${escapeHtml(order.productImageUrl || "/assets/catalog-assets/digital-card.svg")}" alt=""><div><h3>${escapeHtml(order.productName)}</h3><p>#${escapeHtml(order.orderNumber)} · ${dateTime(order.createdAt)}</p></div>${statusPill(order.status)}</div>
      <div class="record-meta"><div><span>النوع</span><b>${escapeHtml(order.productType || "طلب")}</b></div><div><span>الكمية</span><b>${order.quantity || order.itemCount || 1}</b></div><div><span>الإجمالي</span><b>${money(order.totalMinor, order.currency)}</b></div></div>
    </button>`;
  }

  function orderProgress(status) {
    const index = ({ new: 1, awaiting_payment: 0, paid: 1, processing: 2, requires_review: 1, completed: 3, partial: 3, failed: 1, cancelled: 0 })[status] ?? 0;
    const steps = [
      ["تم استلام الطلب", "تم تسجيل الطلب داخل النظام."],
      ["جاري التحقق", "يتم التحقق من الدفع والبيانات."],
      ["قيد التنفيذ", "بدأ تنفيذ المنتج أو الخدمة."],
      ["مكتمل", "تم تسليم المنتج أو إنهاء الخدمة."]
    ];
    return `<div class="progress-steps">${steps.map(([title, text], step) => `<div class="progress-step ${step < index ? "completed" : step === index ? "active" : ""}"><span class="progress-dot">${step < index ? "✓" : step + 1}</span><div><h4>${title}</h4><p>${text}</p></div></div>`).join("")}</div>`;
  }

  async function openOrderDetails(orderId) {
    const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/customer/orders/${encodeURIComponent(orderId)}`);
    const order = data.order;
    $("orderDetailsTitle").textContent = order.orderNumber;
    $("orderDetailsBody").innerHTML = `
      <div class="details-block"><div class="details-row"><span>الحالة</span><b>${statusInfo(order.status)[0]}</b></div><div class="details-row"><span>طريقة الدفع</span><b>${escapeHtml(order.paymentSource || "غير محددة")}</b></div><div class="details-row"><span>المبلغ</span><b>${money(order.totalMinor, order.currency)}</b></div><div class="details-row"><span>تاريخ الطلب</span><b>${dateTime(order.createdAt)}</b></div></div>
      <div class="details-block"><h3>المنتجات والخدمات</h3>${order.items.map((item) => `<div class="details-row"><span>${escapeHtml(item.name)} × ${item.quantity}</span><b>${money(item.totalMinor, order.currency)}</b></div>${Object.keys(item.inputData || {}).length ? `<div class="details-row"><span>البيانات المدخلة</span><b>${escapeHtml(Object.entries(item.inputData).map(([key,value]) => `${key}: ${value}`).join(" · "))}</b></div>` : ""}`).join("")}</div>
      <div class="details-block"><h3>مراحل الطلب</h3>${orderProgress(order.status)}</div>
      ${Object.keys(order.delivery || {}).length ? `<div class="details-block"><h3>بيانات التسليم</h3>${Object.entries(order.delivery).map(([key,value]) => `<div class="details-row"><span>${escapeHtml(key)}</span><b>${escapeHtml(value)}</b></div>`).join("")}</div>` : ""}
      ${order.rejectionReason ? `<div class="notice error">${escapeHtml(order.rejectionReason)}</div>` : ""}`;
    $("orderSupportButton").onclick = () => { $("orderDetailsDialog").close(); navigate("support", { orderId: order.id }); };
    $("orderDetailsDialog").showModal();
  }

  function bindOrderFilters() {
    let timer;
    $("ordersSearch").addEventListener("input", (event) => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.orders.query = event.target.value.trim(); loadOrders(true); }, 300);
    });
    $("ordersStatus").addEventListener("change", (event) => { state.orders.status = event.target.value; loadOrders(true); });
    $("ordersDateFrom").addEventListener("change", (event) => { state.orders.dateFrom = event.target.value; loadOrders(true); });
    $("ordersDateTo").addEventListener("change", (event) => { state.orders.dateTo = event.target.value; loadOrders(true); });
  }

  async function loadSupport(orderId = "") {
    const params = new URLSearchParams();
    if (orderId) { params.set("orderId", orderId); params.set("context", "مشكلة أو استفسار عن الطلب"); }
    const shell = await api(`/api/public/stores/${encodeURIComponent(slug)}/account-shell?${params}`);
    const icons = { whatsapp: "◉", telegram: "↗", instagram: "◎", email: "✉", tiktok: "♪", discord: "◌", phone: "☎", custom: "●" };
    $("supportChannels").innerHTML = shell.supportChannels.length ? shell.supportChannels.map((channel) => `
      <article class="support-channel"><span class="channel-icon">${channel.iconUrl ? `<img src="${escapeHtml(channel.iconUrl)}" alt="">` : icons[channel.type] || "●"}</span><div><h3>${escapeHtml(channel.name)}</h3><p>${escapeHtml(channel.description || channel.workingHours || "تواصل مع فريق الدعم")}</p></div>${channel.url ? `<a href="${escapeHtml(channel.url)}" target="_blank" rel="noopener">تواصل الآن</a>` : '<span class="status-pill warning">غير متاح</span>'}</article>`).join("") : '<div class="empty-state">لم يضف المتجر وسائل تواصل بعد.</div>';
  }

  async function loadTelegram() {
    const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/telegram-link`);
    $("telegramUnlinked").hidden = data.linked;
    $("telegramLinked").hidden = !data.linked;
    ["openStoreBot", "openLinkedBot"].forEach((id) => {
      $(id).href = data.botUrl || "#";
      $(id).setAttribute("aria-disabled", data.botUrl ? "false" : "true");
    });
    if (data.linked) {
      $("linkedBotUsername").textContent = data.botUsername ? `@${data.botUsername}` : "بوت المتجر";
      $("linkedTelegramUsername").textContent = data.telegramUsername ? `@${data.telegramUsername}` : data.telegramUserId;
      $("linkedAt").textContent = dateTime(data.linkedAt);
    }
  }

  function bindTelegram() {
    $("telegramLinkForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice($("telegramNotice"));
      const button = event.currentTarget.querySelector("button[type=submit]");
      setBusy(button, true, "جارٍ التحقق");
      try {
        await api(`/api/public/stores/${encodeURIComponent(slug)}/telegram-link`, { method: "POST", headers: { "x-customer-csrf-token": state.csrf }, body: Object.fromEntries(new FormData(event.currentTarget)) });
        toast("تم ربط حساب تيليجرام");
        await loadTelegram();
      } catch (error) {
        showNotice($("telegramNotice"), error.message);
      } finally {
        setBusy(button, false);
      }
    });
    $("unlinkTelegram").addEventListener("click", async () => {
      if (!(await confirmAction("فك ربط تيليجرام", "سيتم إيقاف مزامنة الحساب مع البوت حتى تعيد الربط."))) return;
      await api(`/api/public/stores/${encodeURIComponent(slug)}/telegram-link`, { method: "DELETE", headers: { "x-customer-csrf-token": state.csrf } });
      toast("تم فك الربط");
      await loadTelegram();
    });
  }

  async function loadSecurity() {
    const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/security`);
    $("securityLevel").textContent = data.level === "strong" ? "قوية" : "تحتاج تحسين";
    $("securityLevelText").textContent = data.totpEnabled ? "التحقق بخطوتين مفعّل وجلساتك تحت السيطرة." : "فعّل التحقق بخطوتين لإضافة طبقة أمان إضافية.";
    $("totpAction").textContent = data.totpEnabled ? "إيقاف" : "تفعيل";
    $("totpAction").dataset.enabled = String(data.totpEnabled);
    $("sessionsList").innerHTML = data.sessions.length ? data.sessions.filter((session) => !session.revokedAt).map((session) => `
      <article class="record-card"><div class="record-card-header"><span class="record-icon">▣</span><div><h3>${session.current ? "هذا الجهاز" : "جلسة نشطة"}</h3><p>${escapeHtml(session.userAgent)} · ${dateTime(session.lastActivityAt)}</p></div>${session.current ? '<span class="status-pill success">الحالية</span>' : `<button class="text-button" data-session-id="${escapeHtml(session.id)}" type="button">إنهاء</button>`}</div><div class="record-meta"><div><span>IP تقريبي</span><b>${escapeHtml(session.ipAddress || "غير متاح")}</b></div><div><span>بدأت</span><b>${shortDate(session.createdAt)}</b></div></div></article>`).join("") : '<div class="empty-state">لا توجد جلسات نشطة.</div>';
    document.querySelectorAll("[data-session-id]").forEach((button) => button.addEventListener("click", async () => {
      if (!(await confirmAction("إنهاء الجلسة", "لن يستطيع هذا الجهاز استخدام الحساب بعد الآن."))) return;
      await api(`/api/public/stores/${encodeURIComponent(slug)}/security/sessions/${encodeURIComponent(button.dataset.sessionId)}`, { method: "DELETE", headers: { "x-customer-csrf-token": state.csrf } });
      toast("تم إنهاء الجلسة");
      await loadSecurity();
    }));
    $("securityEvents").innerHTML = data.events.length ? data.events.map((event) => `<article class="timeline-item"><span class="timeline-dot">✓</span><div><h3>${escapeHtml(event.summary)}</h3><p>${dateTime(event.createdAt)} · ${escapeHtml(event.userAgent || "")}</p></div></article>`).join("") : '<div class="empty-state">لا توجد أحداث أمان مسجلة بعد.</div>';
  }

  function bindSecurity() {
    $("passwordForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice($("passwordNotice"));
      const body = Object.fromEntries(new FormData(event.currentTarget));
      if (body.newPassword !== body.confirmPassword) return showNotice($("passwordNotice"), "تأكيد كلمة المرور غير مطابق");
      const button = event.currentTarget.querySelector("button[type=submit]");
      setBusy(button, true, "جارٍ التغيير");
      try {
        await api(`/api/public/stores/${encodeURIComponent(slug)}/security/password`, { method: "POST", headers: { "x-customer-csrf-token": state.csrf }, body: { currentPassword: body.currentPassword, newPassword: body.newPassword, logoutOthers: body.logoutOthers === "on" } });
        event.currentTarget.reset();
        showNotice($("passwordNotice"), "تم تغيير كلمة المرور بنجاح", "ok");
        await loadSecurity();
      } catch (error) {
        showNotice($("passwordNotice"), error.message);
      } finally {
        setBusy(button, false);
      }
    });
    $("logoutOtherSessions").addEventListener("click", async () => {
      if (!(await confirmAction("إنهاء الجلسات الأخرى", "ستبقى الجلسة الحالية فقط."))) return;
      await api(`/api/public/stores/${encodeURIComponent(slug)}/security/sessions/logout-others`, { method: "POST", headers: { "x-customer-csrf-token": state.csrf } });
      toast("تم إنهاء الجلسات الأخرى");
      await loadSecurity();
    });
    $("totpAction").addEventListener("click", () => openTotpDialog($("totpAction").dataset.enabled === "true"));
  }

  function openTotpDialog(enabled) {
    if (enabled) {
      $("totpDialogBody").innerHTML = `<form id="totpDisableForm" class="stack-form"><p class="security-note">يتطلب الإيقاف كلمة المرور ورمزًا من تطبيق المصادقة أو أحد رموز الاسترداد.</p><label><span>كلمة المرور</span><input name="password" type="password" required></label><label><span>رمز التحقق أو الاسترداد</span><input name="code" required autocomplete="one-time-code"></label><div id="totpNotice" class="notice" hidden></div><button class="danger-button" type="submit">إيقاف التحقق بخطوتين</button></form>`;
      $("totpDisableForm").addEventListener("submit", disableTotp);
    } else {
      $("totpDialogBody").innerHTML = `<form id="totpSetupForm" class="stack-form"><p class="security-note">أدخل كلمة المرور لبدء الإعداد. سيظهر Secret يدوي ورابط متوافق مع تطبيقات المصادقة.</p><label><span>كلمة المرور</span><input name="password" type="password" required></label><div id="totpNotice" class="notice" hidden></div><button class="primary-button" type="submit">بدء الإعداد</button></form>`;
      $("totpSetupForm").addEventListener("submit", setupTotp);
    }
    $("totpDialog").showModal();
  }

  async function setupTotp(event) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/security/totp/setup`, { method: "POST", headers: { "x-customer-csrf-token": state.csrf }, body });
      $("totpDialogBody").innerHTML = `<div class="stack-form"><p>أضف الحساب يدويًا في Google Authenticator أو أي تطبيق متوافق.</p><div class="totp-secret">${escapeHtml(data.secret)}</div><button id="copyTotpSecret" class="secondary-button" type="button">نسخ Secret</button><details><summary>رابط الإعداد</summary><div class="totp-secret">${escapeHtml(data.otpauthUri)}</div></details><form id="totpEnableForm" class="stack-form"><input type="hidden" name="password" value="${escapeHtml(body.password)}"><label><span>رمز من 6 أرقام</span><input name="code" inputmode="numeric" maxlength="6" required autocomplete="one-time-code"></label><div id="totpNotice" class="notice" hidden></div><button class="primary-button" type="submit">تأكيد التفعيل</button></form></div>`;
      $("copyTotpSecret").addEventListener("click", () => copyText(data.secret));
      $("totpEnableForm").addEventListener("submit", enableTotp);
    } catch (error) {
      showNotice($("totpNotice"), error.message);
    }
  }

  async function enableTotp(event) {
    event.preventDefault();
    try {
      const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/security/totp/enable`, { method: "POST", headers: { "x-customer-csrf-token": state.csrf }, body: Object.fromEntries(new FormData(event.currentTarget)) });
      $("totpDialogBody").innerHTML = `<div class="success-panel"><span>✓</span><h2>تم التفعيل</h2><p>احفظ رموز الاسترداد في مكان آمن. لن تظهر مرة أخرى.</p></div><div class="recovery-codes">${data.recoveryCodes.map((code) => `<code>${escapeHtml(code)}</code>`).join("")}</div><button id="copyRecoveryCodes" class="secondary-button" type="button">نسخ الرموز</button>`;
      $("copyRecoveryCodes").addEventListener("click", () => copyText(data.recoveryCodes.join("\n")));
      toast("تم تفعيل التحقق بخطوتين");
      await loadSecurity();
    } catch (error) {
      showNotice($("totpNotice"), error.message);
    }
  }

  async function disableTotp(event) {
    event.preventDefault();
    try {
      await api(`/api/public/stores/${encodeURIComponent(slug)}/security/totp/disable`, { method: "POST", headers: { "x-customer-csrf-token": state.csrf }, body: Object.fromEntries(new FormData(event.currentTarget)) });
      $("totpDialog").close();
      toast("تم إيقاف التحقق بخطوتين");
      await loadSecurity();
    } catch (error) {
      showNotice($("totpNotice"), error.message);
    }
  }

  async function loadIdentity() {
    const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/identity`);
    state.identityFileMaxBytes = Number(data.maximumFileBytes || 4_000_000);
    $("identityRetentionText").textContent = `مدة الاحتفاظ المحددة من المتجر: ${Number(data.retentionDays || 365)} يومًا.`;
    $("identityDisabled").hidden = data.enabled;
    $("identityStatusCard").hidden = !data.enabled;
    $("identityForm").hidden = !data.enabled;
    $("identityReviewNote").hidden = true;
    if (!data.enabled) return;
    const request = data.request;
    const form = $("identityForm");
    const status = request?.status || "draft";
    const [label, style] = statusInfo(status);
    $("identityStatusTitle").textContent = label;
    $("identityStatusText").textContent = ({ draft: "أدخل البيانات وارفع الصور المطلوبة.", pending_review: "طلبك لدى فريق المراجعة.", changes_required: "عدّل البيانات المطلوبة ثم أعد الإرسال.", verified: "تم توثيق هويتك بنجاح.", rejected: "راجع ملاحظة الإدارة وعدّل البيانات." })[status] || "";
    $("identityStatusPill").className = `status-pill ${style}`;
    $("identityStatusPill").textContent = label;
    $("identityReviewNote").hidden = !request?.reviewNote;
    if (request?.reviewNote) $("identityReviewNote").textContent = request.reviewNote;
    if (request) {
      ["fullName", "documentType", "documentNumber", "birthDate", "nationality", "additionalDetails"].forEach((name) => {
        if (form.elements[name]) form.elements[name].value = request[name] || "";
      });
      for (const file of request.files || []) {
        const preview = document.querySelector(`[data-identity-preview="${file.kind}"]`);
        preview.src = `/api/public/stores/${encodeURIComponent(slug)}/identity/files/${file.kind}?v=${encodeURIComponent(file.updatedAt || "")}`;
        preview.hidden = false;
        preview.parentElement.querySelector("span").hidden = true;
      }
    }
    const locked = ["pending_review", "verified"].includes(status);
    form.querySelectorAll("input,select,textarea,button").forEach((element) => { element.disabled = locked; });
    $("submitIdentity").hidden = locked || status === "verified";
  }

  function bindIdentity() {
    document.querySelectorAll("[data-identity-file]").forEach((input) => input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > state.identityFileMaxBytes) {
        const maximumMb = Math.max(0.1, state.identityFileMaxBytes / 1_000_000).toFixed(1);
        toast(`اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز ${maximumMb} MB`, "error");
        input.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        state.identityFiles[input.dataset.identityFile] = String(reader.result);
        const preview = document.querySelector(`[data-identity-preview="${input.dataset.identityFile}"]`);
        preview.src = String(reader.result);
        preview.hidden = false;
        preview.parentElement.querySelector("span").hidden = true;
      };
      reader.readAsDataURL(file);
    }));
    $("identityForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveIdentityDraft();
    });
    $("submitIdentity").addEventListener("click", async () => {
      try {
        await saveIdentityDraft();
        if (!(await confirmAction("إرسال طلب التوثيق", "بعد الإرسال لن تتمكن من التعديل حتى تنتهي المراجعة أو يطلب منك تعديل."))) return;
        await api(`/api/public/stores/${encodeURIComponent(slug)}/identity/submit`, { method: "POST", headers: { "x-customer-csrf-token": state.csrf } });
        toast("تم إرسال طلب التوثيق");
        await loadIdentity();
      } catch (error) {
        showNotice($("identityNotice"), error.message);
      }
    });
  }

  async function saveIdentityDraft() {
    hideNotice($("identityNotice"));
    const form = $("identityForm");
    const body = Object.fromEntries(new FormData(form));
    body.files = state.identityFiles;
    const button = $("saveIdentity");
    setBusy(button, true, "جارٍ الحفظ");
    try {
      await api(`/api/public/stores/${encodeURIComponent(slug)}/identity`, { method: "PUT", headers: { "x-customer-csrf-token": state.csrf }, body });
      showNotice($("identityNotice"), "تم حفظ المسودة بأمان", "ok");
      return true;
    } catch (error) {
      showNotice($("identityNotice"), error.message);
      throw error;
    } finally {
      setBusy(button, false);
    }
  }

  function developerExamples() {
    const base = state.developer.baseUrl || $("apiBaseUrl").textContent;
    const endpoint = `${base}categories`;
    const token = "YOUR_API_TOKEN";
    return {
      curl: `curl -H "Authorization: Bearer ${token}" \
  "${endpoint}"`,
      javascript: `const response = await fetch("${endpoint}", {
  headers: { Authorization: "Bearer ${token}" }
});
const data = await response.json();
console.log(data);`,
      python: `import requests

response = requests.get(
    "${endpoint}",
    headers={"Authorization": "Bearer ${token}"},
    timeout=20,
)
response.raise_for_status()
print(response.json())`,
      php: `<?php
$ch = curl_init("${endpoint}");
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer ${token}"]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$result = curl_exec($ch);
curl_close($ch);
echo $result;`
    };
  }

  function renderDeveloperExample() {
    const examples = developerExamples();
    $("apiCodeExample").textContent = examples[state.developer.codeTab] || examples.curl;
    document.querySelectorAll("[data-code-tab]").forEach((button) => button.classList.toggle("active", button.dataset.codeTab === state.developer.codeTab));
  }

  async function renderDeveloper() {
    const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/developer-key`);
    state.developer.enabled = data.enabled;
    state.developer.baseUrl = data.baseUrl;
    state.developer.key = data.key;
    $("developerDisabled").hidden = data.enabled;
    $("developerContent").hidden = !data.enabled;
    $("apiBaseUrl").textContent = data.baseUrl;
    if (data.key) {
      $("apiKeyStatus").className = "status-pill success";
      $("apiKeyStatus").textContent = "نشط";
      $("apiKeyPrefix").textContent = `${data.key.tokenPrefix}••••••••`;
      $("apiKeyLastUsed").textContent = dateTime(data.key.lastUsedAt);
      $("apiKeyRate").textContent = `${data.key.rateLimitPerMinute} طلب/دقيقة`;
      $("apiKeyForm").elements.rateLimitPerMinute.value = data.key.rateLimitPerMinute;
      $("apiKeyForm").elements.ipAllowlist.value = (data.key.ipAllowlist || []).join("\n");
      $("generateApiKey").textContent = "إعادة توليد المفتاح";
      $("revokeApiKey").hidden = false;
    } else {
      $("apiKeyStatus").className = "status-pill warning";
      $("apiKeyStatus").textContent = "غير موجود";
      $("apiKeyPrefix").textContent = "—";
      $("apiKeyLastUsed").textContent = "—";
      $("apiKeyRate").textContent = "—";
      $("generateApiKey").textContent = "توليد مفتاح جديد";
      $("revokeApiKey").hidden = true;
    }
    const platformLink = state.shell?.experience?.builderPromoUrl || state.store.contacts?.builderUrl || location.origin;
    $("builderPlatformLink").href = platformLink;
    $("drawerBuilderLink").href = platformLink;
    renderDeveloperExample();
  }

  function renderAbout() {
    const contacts = state.store.contacts || {};
    const links = [
      ["البريد الإلكتروني", contacts.email ? `mailto:${contacts.email}` : "", contacts.email],
      ["الهاتف", contacts.phone ? `tel:${contacts.phone}` : "", contacts.phone],
      ["واتساب", contacts.whatsapp ? `https://wa.me/${String(contacts.whatsapp).replace(/\D/g, "")}` : "", contacts.whatsapp],
      ["تيليجرام", contacts.telegram ? `https://t.me/${String(contacts.telegram).replace(/^@/, "")}` : "", contacts.telegram]
    ].filter((item) => item[1]);
    $("aboutContacts").innerHTML = links.length ? links.map(([label, href, value]) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></a>`).join("") : '<div class="empty-state">لا توجد معلومات تواصل مضافة.</div>';
  }

  function confirmAction(title, text) {
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    $("confirmDialog").showModal();
    return new Promise((resolve) => {
      $("confirmDialog").addEventListener("close", () => resolve($("confirmDialog").returnValue === "confirm"), { once: true });
    });
  }

  function bindGeneral() {
    $("toggleBalance").addEventListener("click", () => {
      state.balanceVisible = !state.balanceVisible;
      localStorage.setItem(`uchiha:balance:${slug}`, state.balanceVisible ? "visible" : "hidden");
      renderBalance();
    });
    $("headerBalance").addEventListener("click", () => $("toggleBalance").click());
    $("copyApiUrl").addEventListener("click", () => copyText($("apiBaseUrl").textContent));
    $("copyApiSecret").addEventListener("click", () => copyText($("apiSecretValue").textContent));
    $("copyApiExample").addEventListener("click", () => copyText($("apiCodeExample").textContent));
    document.querySelectorAll("[data-code-tab]").forEach((button) => button.addEventListener("click", () => {
      state.developer.codeTab = button.dataset.codeTab;
      renderDeveloperExample();
    }));
    $("apiKeyForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice($("apiKeyNotice"));
      if (state.developer.key && !(await confirmAction("إعادة توليد المفتاح", "سيُلغى المفتاح الحالي فورًا ولن يعمل بعد الآن."))) return;
      const button = $("generateApiKey");
      setBusy(button, true, "جارٍ التوليد");
      try {
        const form = new FormData(event.currentTarget);
        const ipAllowlist = String(form.get("ipAllowlist") || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
        const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/developer-key`, {
          method: "POST",
          headers: { "x-customer-csrf-token": state.csrf },
          body: { ipAllowlist, rateLimitPerMinute: Number(form.get("rateLimitPerMinute") || 60) }
        });
        state.developer.key = data.key;
        $("apiSecretValue").textContent = data.token;
        $("apiSecretOnce").hidden = false;
        showNotice($("apiKeyNotice"), "تم إنشاء المفتاح. انسخه الآن واحفظه بأمان.", "ok");
        await renderDeveloper();
      } catch (error) {
        showNotice($("apiKeyNotice"), error.message);
      } finally {
        setBusy(button, false);
      }
    });
    $("revokeApiKey").addEventListener("click", async () => {
      if (!(await confirmAction("إلغاء API Token", "سيتوقف المفتاح الحالي فورًا ولن يمكن استعادته."))) return;
      try {
        await api(`/api/public/stores/${encodeURIComponent(slug)}/developer-key`, { method: "DELETE", headers: { "x-customer-csrf-token": state.csrf } });
        $("apiSecretOnce").hidden = true;
        toast("تم إلغاء المفتاح");
        await renderDeveloper();
      } catch (error) { toast(error.message, "error"); }
    });
  }

  async function bootstrap() {
    if (!slug) {
      $("accountLoading").querySelector("strong").textContent = "رابط المتجر غير صالح";
      return;
    }
    bindNavigation();
    bindAuth();
    bindDeposits();
    bindPaymentFilters();
    bindOrderFilters();
    bindTelegram();
    bindSecurity();
    bindIdentity();
    bindGeneral();
    try {
      const [storeData, shell] = await Promise.all([
        api(`/api/storefront/${encodeURIComponent(slug)}?catalogOnly=1&limit=1&offset=0`),
        api(`/api/public/stores/${encodeURIComponent(slug)}/account-shell`)
      ]);
      state.store = storeData.store;
      state.shell = shell;
      applyDesign(storeData.store);
      $("headerBrand").href = `/store/${encodeURIComponent(slug)}`;
      $("accountLoading").hidden = true;
      $("accountApp").hidden = false;
      try {
        const me = await api(`/api/public/stores/${encodeURIComponent(slug)}/customer/me`);
        state.customer = me.customer;
        state.csrf = me.csrfToken;
        await afterAuthentication();
        try { await loadWallet(); } catch {}
      } catch (error) {
        if (error.status !== 401) throw error;
        $("authSection").hidden = false;
        $("accountContent").hidden = true;
        document.querySelector(".account-bottom-nav").hidden = true;
      }
    } catch (error) {
      $("accountLoading").querySelector("strong").textContent = error.message;
    }
  }

  bootstrap();
})();
