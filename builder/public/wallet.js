(() => {
  const slug = decodeURIComponent(location.pathname.split("/")[2] || "");
  const state = {
    csrf: "",
    customer: null,
    methods: [],
    selectedMethod: null,
    proofDataUrl: "",
    notifications: [],
    notificationFilter: "all"
  };
  const requestedNext = new URLSearchParams(location.search).get("next");
  const safeNext = requestedNext && requestedNext.startsWith("/store/") && !requestedNext.startsWith("//") ? requestedNext : `/store/${encodeURIComponent(slug)}`;
  const $ = (id) => document.getElementById(id);
  const authView = $("authView");
  const walletView = $("walletView");

  function currencyMinorFactor(currency) {
    try {
      const digits = new Intl.NumberFormat("en", {
        style: "currency",
        currency: currency || "USD"
      }).resolvedOptions().maximumFractionDigits;
      return 10 ** digits;
    } catch {
      return 100;
    }
  }
  function money(minor, currency = state.customer?.currency || "USD") {
    return new Intl.NumberFormat("ar-EG", { style: "currency", currency })
      .format(Number(minor || 0) / currencyMinorFactor(currency));
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }
  function destinationText(destination = {}) {
    const labels = {
      payId: "معرّف الدفع",
      binanceId: "معرّف Binance",
      iban: "IBAN",
      accountNumber: "رقم الحساب",
      account: "الحساب",
      accountName: "اسم المستفيد",
      bankName: "البنك",
      address: "عنوان المحفظة",
      walletAddress: "عنوان المحفظة",
      walletNumber: "رقم المحفظة",
      phone: "رقم المحفظة",
      network: "الشبكة",
      recipient: "بيانات التحويل",
      details: "تفاصيل"
    };
    return Object.entries(destination)
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
      .map(([key, value]) => `${labels[key] || "بيانات إضافية"}: ${String(value)}`)
      .join(" · ");
  }
  function showNotice(element, message, type = "bad") {
    element.textContent = message;
    element.className = `notice show ${type}`;
  }
  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && typeof options.body !== "string") {
      headers["content-type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, { credentials: "same-origin", ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || "تعذر إكمال الطلب");
      error.status = response.status;
      error.code = data.error;
      error.details = data.details;
      throw error;
    }
    return data;
  }
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("uchiha-payments-theme", theme);
    const button = $("themeButton");
    if (button) button.setAttribute("aria-label", theme === "dark" ? "استخدام الوضع الفاتح" : "استخدام الوضع الداكن");
  }
  setTheme(localStorage.getItem("uchiha-payments-theme") || "dark");
  $("returnStore").href = safeNext;
  $("supportLink").href = `/store/${encodeURIComponent(slug)}/support`;
  $("themeButton").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

  document.querySelectorAll("[data-auth]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-auth]").forEach((item) => item.classList.toggle("active", item === button));
      $("loginForm").classList.toggle("hidden", button.dataset.auth !== "login");
      $("registerForm").classList.toggle("hidden", button.dataset.auth !== "register");
    });
  });

  async function authenticate(endpoint, form) {
    const payload = Object.fromEntries(new FormData(form));
    const button = form.querySelector("button[type=submit]");
    const original = button.textContent;
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> جارٍ الدخول';
    try {
      const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/customers/${endpoint}`, { method: "POST", body: payload });
      state.customer = data.customer;
      state.csrf = data.csrfToken;
      await openWallet();
    } catch (error) {
      showNotice($("authNotice"), error.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }
  $("loginForm").addEventListener("submit", (event) => { event.preventDefault(); authenticate("login", event.currentTarget); });
  $("registerForm").addEventListener("submit", (event) => { event.preventDefault(); authenticate("register", event.currentTarget); });

  function renderMethods() {
    const container = $("methods");
    if (!state.methods.length) {
      container.innerHTML = '<div class="empty">لا توجد طرق دفع مفعلة حاليًا</div>';
      return;
    }
    const icons = {
      bank_transfer: "/assets/payment-assets/bank-transfer.svg",
      usdt_trc20: "/assets/payment-assets/crypto-transfer.svg",
      binance_pay: "/assets/payment-assets/instant-pay.svg",
      sham_cash: "/assets/payment-assets/cash-wallet.svg",
      manual: "/assets/payment-assets/manual-payment.svg"
    };
    container.innerHTML = state.methods.map((method) => `
      <button type="button" class="method ${state.selectedMethod?.id === method.id ? "active" : ""}" data-id="${method.id}">
        <img src="${icons[method.type] || icons.manual}" alt="">
        <span><b>${escapeHtml(method.name)}</b><small>عمولة ${(method.commissionBps / 100).toFixed(2)}%</small></span>
      </button>`).join("");
    container.querySelectorAll(".method").forEach((button) => button.addEventListener("click", () => {
      state.selectedMethod = state.methods.find((method) => method.id === button.dataset.id);
      renderMethods();
      updateAmountConstraints();
      renderCalculation();
      const destination = destinationText(state.selectedMethod.destination);
      $("methodInstructions").textContent = [state.selectedMethod.instructions, destination].filter(Boolean).join(" — ");
    }));
  }
  function updateAmountConstraints() {
    const input = $("amount");
    const currency = state.customer?.currency || "USD";
    const factor = currencyMinorFactor(currency);
    const method = state.selectedMethod;
    input.step = String(1 / factor);
    input.min = String((method?.minimumAmountMinor || 1) / factor);
    if (method?.maximumAmountMinor === null || method?.maximumAmountMinor === undefined) {
      input.removeAttribute("max");
    } else {
      input.max = String(method.maximumAmountMinor / factor);
    }
  }
  function renderCalculation() {
    const amountMinor = Math.round(
      Number($("amount").value || 0) *
      currencyMinorFactor(state.customer?.currency || "USD")
    );
    const method = state.selectedMethod;
    if (!method || !amountMinor) { $("netAmount").textContent = "—"; return; }
    const commission = Math.round(amountMinor * (method.commissionBps / 10000)) + method.fixedFeeMinor;
    $("netAmount").textContent = money(Math.max(0, amountMinor - commission));
  }
  $("amount").addEventListener("input", renderCalculation);

  $("proof").addEventListener("change", () => {
    const file = $("proof").files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 1_500_000) {
      showNotice($("depositNotice"), "اختر صورة JPG أو PNG أو WEBP بحجم لا يتجاوز 1.5 ميجابايت");
      $("proof").value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.proofDataUrl = reader.result;
      $("proofPreview").src = reader.result;
      $("proofPreview").classList.remove("hidden");
      $("uploadText").classList.add("hidden");
    };
    reader.readAsDataURL(file);
  });

  function statusLabel(status) {
    return ({
      pending: "قيد المراجعة",
      approved: "تم القبول",
      rejected: "مرفوض",
      cancelled: "ملغي",
      new: "جديد",
      awaiting_payment: "بانتظار الدفع",
      paid: "مدفوع",
      processing: "قيد التنفيذ",
      completed: "مكتمل",
      partial: "منفذ جزئيًا",
      failed: "تعذر التنفيذ",
      requires_review: "يحتاج مراجعة"
    })[status] || status;
  }
  function notificationGroup(type) {
    if (String(type || "").startsWith("order_")) return "orders";
    if (
      String(type || "").startsWith("deposit_") ||
      String(type || "").startsWith("wallet_")
    ) {
      return "payments";
    }
    return "general";
  }
  function renderNotifications() {
    const entries =
      state.notificationFilter === "all"
        ? state.notifications
        : state.notifications.filter(
            (entry) => notificationGroup(entry.type) === state.notificationFilter
          );
    $("notificationList").innerHTML = entries.length
      ? entries.map((entry) => `
        <article class="item"><div class="item-head"><strong>${escapeHtml(entry.title)}</strong><small>${new Date(entry.createdAt).toLocaleString("ar-EG")}</small></div><p>${escapeHtml(entry.message)}</p></article>`).join("")
      : '<div class="empty">لا توجد إشعارات في هذا القسم</div>';
  }
  function renderWallet(data, orders = []) {
    $("balance").textContent = money(data.wallet.balanceMinor, data.wallet.currency);
    const loyalty = data.loyalty || { name: "مستكشف", level: 1, points: 0, nextLevel: null, completedOrders: 0 };
    $("loyaltyName").textContent = loyalty.name;
    $("loyaltyLevel").textContent = loyalty.level;
    $("loyaltyPoints").textContent = `${loyalty.points.toLocaleString("ar-EG")} نقطة`;
    $("loyaltyProgress").style.width = `${loyalty.nextLevel?.progressPercent ?? 100}%`;
    $("loyaltySummary").textContent = loyalty.nextLevel
      ? `${loyalty.nextLevel.ordersRemaining} طلب متبقٍ للوصول إلى مستوى ${loyalty.nextLevel.name}.`
      : `وصلت إلى أعلى مستوى بعد ${loyalty.completedOrders} طلب مكتمل.`;
    $("depositList").innerHTML = data.deposits.length ? data.deposits.map((deposit) => `
      <article class="item"><div class="item-head"><strong>${money(deposit.netAmountMinor, deposit.currency)}</strong><span class="status ${deposit.status}">${statusLabel(deposit.status)}</span></div>
      <p>${escapeHtml(deposit.paymentMethod?.name || "طريقة دفع")} · المحوّل ${money(deposit.requestedAmountMinor, deposit.currency)} · العمولة ${money(deposit.commissionMinor, deposit.currency)}</p>
      ${deposit.reviewReason ? `<p>${escapeHtml(deposit.reviewReason)}</p>` : ""}</article>`).join("") : '<div class="empty">لا توجد طلبات بعد</div>';
    state.notifications = data.notifications || [];
    renderNotifications();
    $("orderList").innerHTML = orders.length ? orders.map((order) => `
      <article class="item"><div class="item-head"><strong>${escapeHtml(order.orderNumber)}</strong><span class="status ${escapeHtml(order.status)}">${statusLabel(order.status)}</span></div>
      <p>${money(order.totalMinor, order.currency)} · ${order.paymentStatus === "paid" ? "مدفوع" : "الدفع غير مكتمل"} · ${new Date(order.createdAt).toLocaleString("ar-EG")}</p></article>`).join("") : '<div class="empty">لا توجد طلبات بعد</div>';
    $("ledgerList").innerHTML = data.ledger.length ? data.ledger.map((entry) => `
      <article class="item"><div class="item-head"><strong>${entry.amountMinor >= 0 ? "+" : ""}${money(entry.amountMinor, data.wallet.currency)}</strong><small>${new Date(entry.createdAt).toLocaleString("ar-EG")}</small></div><p>${escapeHtml(entry.note || entry.type)}</p></article>`).join("") : '<div class="empty">لا توجد حركات بعد</div>';
  }
  document.querySelectorAll("[data-notification-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.notificationFilter = button.dataset.notificationFilter;
      document.querySelectorAll("[data-notification-filter]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      renderNotifications();
    });
  });
  async function refreshWallet() {
    const [data, orderData] = await Promise.all([
      api(`/api/public/stores/${encodeURIComponent(slug)}/wallet`),
      api(`/api/public/stores/${encodeURIComponent(slug)}/customer/orders`)
    ]);
    renderWallet(data, orderData.orders || []);
  }
  async function openWallet() {
    authView.classList.add("hidden");
    walletView.classList.remove("hidden");
    const methodsData = await api(`/api/public/stores/${encodeURIComponent(slug)}/payment-methods`);
    state.methods = methodsData.methods;
    state.selectedMethod = state.methods[0] || null;
    renderMethods();
    updateAmountConstraints();
    renderCalculation();
    if (state.selectedMethod) $("methodInstructions").textContent = state.selectedMethod.instructions || "";
    await refreshWallet();
    if (location.hash) {
      requestAnimationFrame(() => document.querySelector(location.hash)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  $("submitDeposit").addEventListener("click", async () => {
    const notice = $("depositNotice");
    if (!state.selectedMethod) return showNotice(notice, "اختر طريقة الدفع");
    const amountMinor = Math.round(
      Number($("amount").value || 0) *
      currencyMinorFactor(state.customer?.currency || "USD")
    );
    if (!amountMinor) return showNotice(notice, "أدخل المبلغ الذي حوّلته");
    if (!state.proofDataUrl) return showNotice(notice, "اختر صورة إثبات التحويل");
    const button = $("submitDeposit");
    const original = button.textContent;
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> جارٍ رفع الطلب';
    try {
      const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/deposits`, {
        method: "POST",
        headers: { "x-customer-csrf-token": state.csrf, "idempotency-key": crypto.randomUUID() },
        body: { paymentMethodId: state.selectedMethod.id, amountMinor, proofDataUrl: state.proofDataUrl, referenceText: $("reference").value }
      });
      showNotice(notice, `تم رفع الطلب وأصبح ${statusLabel(data.deposit.status)}.`, "ok");
      $("amount").value = "";
      $("reference").value = "";
      $("proof").value = "";
      state.proofDataUrl = "";
      $("proofPreview").classList.add("hidden");
      $("uploadText").classList.remove("hidden");
      renderCalculation();
      await refreshWallet();
    } catch (error) {
      showNotice(notice, error.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });

  $("logoutButton").addEventListener("click", async () => {
    try {
      await api(`/api/public/stores/${encodeURIComponent(slug)}/customers/logout`, { method: "POST", headers: { "x-customer-csrf-token": state.csrf } });
    } catch {}
    location.reload();
  });

  (async () => {
    if (!slug) return showNotice($("authNotice"), "رابط المتجر غير صالح");
    try {
      const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/customer/me`);
      state.customer = data.customer;
      state.csrf = data.csrfToken;
      await openWallet();
    } catch {
      authView.classList.remove("hidden");
    }
  })();
})();
