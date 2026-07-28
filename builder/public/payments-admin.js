(() => {
  const storeId = decodeURIComponent(location.pathname.split("/")[2] || "");
  const state = { csrf: "", status: "pending" };
  const $ = (id) => document.getElementById(id);
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
  }
  function money(minor, currency) {
    return new Intl.NumberFormat("ar-EG", { style: "currency", currency }).format(Number(minor || 0) / 100);
  }
  function notice(message, type = "bad") {
    const el = $("adminNotice");
    el.textContent = message;
    el.className = `notice show ${type}`;
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
  const statusLabel = (value) => ({ pending: "قيد المراجعة", approved: "تم القبول", rejected: "مرفوض", cancelled: "ملغي" })[value] || value;

  async function loadMethods() {
    const data = await api(`/api/stores/${storeId}/payment-methods`);
    $("methodList").innerHTML = data.methods.length
      ? data.methods.map((method) => `<article class="item"><div class="item-head"><strong>${escapeHtml(method.name)}</strong><span class="status ${method.status === "active" ? "approved" : "rejected"}">${escapeHtml(method.status)}</span></div><p>${escapeHtml(method.type)} · عمولة ${(method.commissionBps / 100).toFixed(2)}% · حد أدنى ${method.minimumAmountMinor}</p></article>`).join("")
      : '<div class="empty">لم تضف طرق دفع بعد</div>';
  }

  async function loadDeposits() {
    const data = await api(`/api/stores/${storeId}/deposits?status=${state.status}`);
    $("depositList").innerHTML = data.deposits.length
      ? data.deposits.map((deposit) => `
        <article class="item review-row" data-id="${deposit.id}">
          <img class="proof-thumb" src="${deposit.proof.data}" alt="إثبات التحويل">
          <div>
            <div class="item-head"><strong>${escapeHtml(deposit.customer.displayName)} — ${money(deposit.netAmountMinor, deposit.currency)}</strong><span class="status ${deposit.status}">${statusLabel(deposit.status)}</span></div>
            <p>${escapeHtml(deposit.customer.email)} · ${escapeHtml(deposit.paymentMethod.name)} · المحوّل ${money(deposit.requestedAmountMinor, deposit.currency)} · العمولة ${money(deposit.commissionMinor, deposit.currency)}</p>
            ${deposit.referenceText ? `<p>المرجع: ${escapeHtml(deposit.referenceText)}</p>` : ""}
            ${deposit.reviewReason ? `<p>السبب: ${escapeHtml(deposit.reviewReason)}</p>` : ""}
          </div>
          ${deposit.status === "pending" ? '<div class="actions"><button class="success" data-decision="approve">قبول وإضافة الرصيد</button><button class="danger" data-decision="reject">رفض</button></div>' : ""}
        </article>`).join("")
      : '<div class="empty">لا توجد طلبات في هذه الحالة</div>';
    document.querySelectorAll("[data-decision]").forEach((button) => {
      button.addEventListener("click", () => review(button.closest("[data-id]").dataset.id, button.dataset.decision));
    });
  }

  async function review(id, decision) {
    const reason = decision === "reject" ? prompt("سبب الرفض الذي سيظهر للعميل:", "صورة التحويل غير واضحة") : "";
    if (decision === "reject" && reason === null) return;
    try {
      await api(`/api/stores/${storeId}/deposits/${id}/review`, {
        method: "POST",
        headers: { "x-csrf-token": state.csrf },
        body: { decision, reason }
      });
      notice(decision === "approve" ? "تم اعتماد الطلب وإضافة الرصيد مرة واحدة." : "تم رفض الطلب وإرسال السبب للعميل.", "ok");
      await loadDeposits();
    } catch (error) {
      notice(error.message);
    }
  }

  $("statusTabs").querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.status = button.dataset.status;
      $("statusTabs").querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === button));
      await loadDeposits();
    });
  });

  $("methodForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    let destination = {};
    try {
      destination = values.destination.trim() ? JSON.parse(values.destination) : {};
    } catch {
      return notice("بيانات التحويل يجب أن تكون JSON صالحًا");
    }
    try {
      await api(`/api/stores/${storeId}/payment-methods`, {
        method: "POST",
        headers: { "x-csrf-token": state.csrf },
        body: {
          name: values.name,
          type: values.type,
          commissionBps: Math.round(Number(values.commissionPercent || 0) * 100),
          fixedFeeMinor: Number(values.fixedFeeMinor || 0),
          minimumAmountMinor: Number(values.minimumAmountMinor || 0),
          sortOrder: Number(values.sortOrder || 0),
          destination,
          instructions: values.instructions
        }
      });
      event.currentTarget.reset();
      notice("تمت إضافة طريقة الدفع.", "ok");
      await loadMethods();
    } catch (error) {
      notice(error.message);
    }
  });

  (async () => {
    try {
      const me = await api("/api/me");
      state.csrf = me.csrfToken;
      await Promise.all([loadMethods(), loadDeposits()]);
    } catch (error) {
      notice(`${error.message} — افتح لوحة المتجر وسجّل الدخول أولًا.`);
    }
  })();
})();
