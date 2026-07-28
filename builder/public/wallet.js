(() => {
  const slug = decodeURIComponent(location.pathname.split("/")[2] || "");
  const state = { csrf: "", customer: null, methods: [], selectedMethod: null, proofDataUrl: "" };
  const $ = (id) => document.getElementById(id);
  const authView = $("authView");
  const walletView = $("walletView");

  function money(minor, currency = state.customer?.currency || "USD") {
    return new Intl.NumberFormat("ar", { style: "currency", currency }).format(Number(minor || 0) / 100);
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
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
    if (!response.ok) throw new Error(data.message || "تعذر إكمال الطلب");
    return data;
  }
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("uchiha-payments-theme", theme);
  }
  setTheme(localStorage.getItem("uchiha-payments-theme") || "dark");
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
    container.innerHTML = state.methods.map((method) => `
      <button type="button" class="method ${state.selectedMethod?.id === method.id ? "active" : ""}" data-id="${method.id}">
        <b>${escapeHtml(method.name)}</b><small>عمولة ${(method.commissionBps / 100).toFixed(2)}%</small>
      </button>`).join("");
    container.querySelectorAll(".method").forEach((button) => button.addEventListener("click", () => {
      state.selectedMethod = state.methods.find((method) => method.id === button.dataset.id);
      renderMethods();
      renderCalculation();
      const destination = Object.entries(state.selectedMethod.destination || {}).map(([key, value]) => `${key}: ${value}`).join(" · ");
      $("methodInstructions").textContent = [state.selectedMethod.instructions, destination].filter(Boolean).join(" — ");
    }));
  }
  function renderCalculation() {
    const amountMinor = Math.round(Number($("amount").value || 0) * 100);
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
    return ({ pending: "قيد المراجعة", approved: "تم القبول", rejected: "مرفوض", cancelled: "ملغي" })[status] || status;
  }
  function renderWallet(data) {
    $("balance").textContent = money(data.wallet.balanceMinor, data.wallet.currency);
    $("depositList").innerHTML = data.deposits.length ? data.deposits.map((deposit) => `
      <article class="item"><div class="item-head"><strong>${money(deposit.netAmountMinor, deposit.currency)}</strong><span class="status ${deposit.status}">${statusLabel(deposit.status)}</span></div>
      <p>${escapeHtml(deposit.paymentMethod?.name || "طريقة دفع")} · المحوّل ${money(deposit.requestedAmountMinor, deposit.currency)} · العمولة ${money(deposit.commissionMinor, deposit.currency)}</p>
      ${deposit.reviewReason ? `<p>${escapeHtml(deposit.reviewReason)}</p>` : ""}</article>`).join("") : '<div class="empty">لا توجد طلبات بعد</div>';
    $("ledgerList").innerHTML = data.ledger.length ? data.ledger.map((entry) => `
      <article class="item"><div class="item-head"><strong>${entry.amountMinor >= 0 ? "+" : ""}${money(entry.amountMinor, data.wallet.currency)}</strong><small>${new Date(entry.createdAt).toLocaleString("ar")}</small></div><p>${escapeHtml(entry.note || entry.type)}</p></article>`).join("") : '<div class="empty">لا توجد حركات بعد</div>';
  }
  async function refreshWallet() {
    const data = await api(`/api/public/stores/${encodeURIComponent(slug)}/wallet`);
    renderWallet(data);
  }
  async function openWallet() {
    authView.classList.add("hidden");
    walletView.classList.remove("hidden");
    const methodsData = await api(`/api/public/stores/${encodeURIComponent(slug)}/payment-methods`);
    state.methods = methodsData.methods;
    state.selectedMethod = state.methods[0] || null;
    renderMethods();
    renderCalculation();
    if (state.selectedMethod) $("methodInstructions").textContent = state.selectedMethod.instructions || "";
    await refreshWallet();
  }

  $("submitDeposit").addEventListener("click", async () => {
    const notice = $("depositNotice");
    if (!state.selectedMethod) return showNotice(notice, "اختر طريقة الدفع");
    const amountMinor = Math.round(Number($("amount").value || 0) * 100);
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
