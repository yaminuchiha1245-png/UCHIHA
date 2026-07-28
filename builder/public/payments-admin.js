(() => {
  const storeId = decodeURIComponent(location.pathname.split("/")[2] || "");
  const state = { csrf: "", depositStatus: "pending", methods: [], activeView: "deposits" };
  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }
  function money(minor, currency) {
    return new Intl.NumberFormat("ar-EG", { style: "currency", currency }).format(Number(minor || 0) / 100);
  }
  function dateTime(value) {
    return value ? new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
  }
  function notice(message, type = "bad") {
    const element = $("adminNotice");
    element.textContent = message;
    element.className = `notice show ${type}`;
    window.setTimeout(() => { if (element.textContent === message) element.classList.remove("show"); }, 6000);
  }
  function loading(id) {
    $(id).innerHTML = '<div class="empty"><span class="spinner"></span> جارٍ التحميل...</div>';
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
      throw error;
    }
    return data;
  }
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("uchiha-payments-theme", theme);
  }
  const statusLabel = (value) => ({ pending: "قيد المراجعة", approved: "تم القبول", rejected: "مرفوض", cancelled: "ملغي", active: "نشط", blocked: "محظور", hidden: "مخفية", disabled: "معطلة", processing: "قيد التنفيذ", completed: "مكتمل", partial: "جزئي", failed: "فشل", requires_review: "يحتاج مراجعة", paid: "مدفوع", unpaid: "غير مدفوع" })[value] || value;
  const statusClass = (value) => (["approved", "active", "completed", "paid"].includes(value) ? "approved" : ["pending", "processing", "requires_review", "partial"].includes(value) ? "pending" : "rejected");

  setTheme(localStorage.getItem("uchiha-payments-theme") || "dark");
  $("themeButton").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

  async function loadNotifications() {
    const data = await api(`/api/stores/${storeId}/admin-notifications`);
    $("notificationList").innerHTML = data.notifications.length ? data.notifications.slice(0, 8).map((entry) => `
      <article class="notification-item ${entry.readAt ? "" : "unread"}">
        <div><strong>${escapeHtml(entry.title)}</strong><p>${escapeHtml(entry.message)}</p></div><time>${dateTime(entry.createdAt)}</time>
      </article>`).join("") : '<div class="empty">لا توجد تنبيهات بعد</div>';
  }

  async function loadMethods() {
    loading("methodList");
    const data = await api(`/api/stores/${storeId}/payment-methods`);
    state.methods = data.methods;
    $("methodList").innerHTML = data.methods.length ? data.methods.map((method) => `
      <article class="item method-row" data-method-id="${escapeHtml(method.id)}">
        <div><div class="item-head"><strong>${escapeHtml(method.name)}</strong><span class="status ${statusClass(method.status)}">${statusLabel(method.status)}</span></div>
        <p>${escapeHtml(method.type)} · عمولة ${(method.commissionBps / 100).toFixed(2)}% + ${method.fixedFeeMinor} · من ${method.minimumAmountMinor}${method.maximumAmountMinor === null ? " دون حد أعلى" : ` إلى ${method.maximumAmountMinor}`} · ترتيب ${method.sortOrder}</p></div>
        <div class="actions"><button class="secondary" data-action="edit-method" type="button">تعديل</button><button class="${method.status === "active" ? "danger" : "success"}" data-action="toggle-method" type="button">${method.status === "active" ? "تعطيل" : "تفعيل"}</button></div>
      </article>`).join("") : '<div class="empty">لم تضف طرق دفع بعد</div>';
  }

  async function loadDeposits() {
    loading("depositList");
    const data = await api(`/api/stores/${storeId}/deposits?status=${encodeURIComponent(state.depositStatus)}`);
    $("depositList").innerHTML = data.deposits.length ? data.deposits.map((deposit) => `
      <article class="item review-row" data-deposit-id="${escapeHtml(deposit.id)}">
        <a href="${escapeHtml(deposit.proof.data)}" target="_blank" rel="noreferrer"><img class="proof-thumb" src="${escapeHtml(deposit.proof.data)}" alt="إثبات التحويل"></a>
        <div><div class="item-head"><strong>${escapeHtml(deposit.customer.displayName)} — ${money(deposit.netAmountMinor, deposit.currency)}</strong><span class="status ${statusClass(deposit.status)}">${statusLabel(deposit.status)}</span></div>
        <p>${escapeHtml(deposit.customer.email)} · ${escapeHtml(deposit.paymentMethod.name)} · المحوّل ${money(deposit.requestedAmountMinor, deposit.currency)} · العمولة ${money(deposit.commissionMinor, deposit.currency)} · ${dateTime(deposit.createdAt)}</p>
        ${deposit.referenceText ? `<p>المرجع: ${escapeHtml(deposit.referenceText)}</p>` : ""}${deposit.reviewReason ? `<p>السبب: ${escapeHtml(deposit.reviewReason)}</p>` : ""}</div>
        ${deposit.status === "pending" ? '<div class="actions"><button class="success" data-action="approve-deposit" type="button">قبول وإضافة الرصيد</button><button class="danger" data-action="reject-deposit" type="button">رفض</button></div>' : ""}
      </article>`).join("") : '<div class="empty">لا توجد طلبات في هذه الحالة</div>';
  }

  async function loadCustomers() {
    loading("customerList");
    const query = $("customerSearch").value.trim();
    const status = $("customerStatus").value;
    const data = await api(`/api/stores/${storeId}/customers?status=${encodeURIComponent(status)}&query=${encodeURIComponent(query)}&limit=100`);
    $("customerList").innerHTML = data.customers.length ? data.customers.map((customer) => `
      <article class="item customer-row" data-customer-id="${escapeHtml(customer.id)}" data-customer-name="${escapeHtml(customer.displayName)}">
        <div><div class="item-head"><strong>${escapeHtml(customer.displayName)}</strong><span class="status ${statusClass(customer.status)}">${statusLabel(customer.status)}</span></div>
        <p>${escapeHtml(customer.email)}${customer.phone ? ` · ${escapeHtml(customer.phone)}` : ""} · ${customer.orderCount} طلب · ${customer.depositCount} شحنة</p></div>
        <strong class="balance-inline">${money(customer.balanceMinor, customer.currency)}</strong>
        <div class="actions"><button class="secondary" data-action="adjust-wallet" type="button">تعديل الرصيد</button><button class="${customer.status === "active" ? "danger" : "success"}" data-action="toggle-customer" type="button">${customer.status === "active" ? "حظر" : "إلغاء الحظر"}</button></div>
      </article>`).join("") : '<div class="empty">لا يوجد عملاء مطابقون</div>';
  }

  async function loadOrders() {
    loading("orderList");
    const query = $("orderSearch").value.trim();
    const status = $("orderStatus").value;
    const data = await api(`/api/stores/${storeId}/orders?status=${encodeURIComponent(status)}&query=${encodeURIComponent(query)}&limit=100`);
    $("orderList").innerHTML = data.orders.length ? data.orders.map((order) => `
      <article class="item order-row" data-order-id="${escapeHtml(order.id)}">
        <div><div class="item-head"><strong>${escapeHtml(order.orderNumber)} — ${money(order.totalMinor, order.currency)}</strong><span class="status ${statusClass(order.status)}">${statusLabel(order.status)}</span></div>
        <p>${escapeHtml(order.customerName)}${order.customerEmail ? ` · ${escapeHtml(order.customerEmail)}` : ""} · ${order.itemCount} عنصر · ${statusLabel(order.paymentStatus)} · ${escapeHtml(order.paymentSource || "external")} · ${dateTime(order.createdAt)}</p></div>
        <div class="actions order-actions"><select data-role="order-status"><option value="processing">قيد التنفيذ</option><option value="completed">مكتمل</option><option value="partial">جزئي</option><option value="requires_review">يحتاج مراجعة</option><option value="failed">فشل</option></select><button class="secondary" data-action="update-order" type="button">حفظ الحالة</button></div>
      </article>`).join("") : '<div class="empty">لا توجد طلبات مطابقة</div>';
    document.querySelectorAll("[data-order-id]").forEach((row) => { const order = data.orders.find((entry) => entry.id === row.dataset.orderId); const select = row.querySelector('[data-role="order-status"]'); if ([...select.options].some((option) => option.value === order.status)) select.value = order.status; });
  }

  async function loadAudit() {
    loading("auditList");
    const data = await api(`/api/stores/${storeId}/audit-logs?limit=100`);
    $("auditList").innerHTML = data.logs.length ? data.logs.map((entry) => `
      <details class="item audit-row"><summary><strong>${escapeHtml(entry.action)}</strong><span>${escapeHtml(entry.actor)} · ${dateTime(entry.createdAt)}</span></summary>
      <p>الكيان: ${escapeHtml(entry.entityType)}${entry.entityId ? ` · ${escapeHtml(entry.entityId)}` : ""}</p>
      <pre>${escapeHtml(JSON.stringify({ before: entry.before, after: entry.after }, null, 2))}</pre></details>`).join("") : '<div class="empty">لا توجد عمليات مسجلة</div>';
  }

  async function reviewDeposit(id, decision) {
    const reason = decision === "reject" ? prompt("سبب الرفض الذي سيظهر للعميل:", "إثبات التحويل غير واضح") : "";
    if (decision === "reject" && reason === null) return;
    await api(`/api/stores/${storeId}/deposits/${id}/review`, { method: "POST", headers: { "x-csrf-token": state.csrf }, body: { decision, reason } });
    notice(decision === "approve" ? "تم اعتماد الطلب وإضافة الرصيد مرة واحدة." : "تم رفض الطلب وإرسال السبب للعميل.", "ok");
    await Promise.all([loadDeposits(), loadNotifications(), loadCustomers()]);
  }

  function resetMethodForm() {
    $("methodForm").reset();
    $("methodForm").elements.methodId.value = "";
    $("methodFormTitle").textContent = "إضافة طريقة دفع";
    $("cancelMethodEdit").classList.add("hidden");
  }
  function editMethod(method) {
    const form = $("methodForm");
    form.elements.methodId.value = method.id;
    form.elements.name.value = method.name;
    form.elements.type.value = method.type;
    form.elements.status.value = method.status;
    form.elements.commissionPercent.value = method.commissionBps / 100;
    form.elements.fixedFeeMinor.value = method.fixedFeeMinor;
    form.elements.minimumAmountMinor.value = method.minimumAmountMinor;
    form.elements.maximumAmountMinor.value = method.maximumAmountMinor ?? "";
    form.elements.sortOrder.value = method.sortOrder;
    form.elements.destination.value = JSON.stringify(method.destination || {}, null, 2);
    form.elements.instructions.value = method.instructions || "";
    $("methodFormTitle").textContent = `تعديل ${method.name}`;
    $("cancelMethodEdit").classList.remove("hidden");
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function saveMethod(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    let destination;
    try { destination = values.destination.trim() ? JSON.parse(values.destination) : {}; } catch { return notice("بيانات التحويل يجب أن تكون JSON صالحًا"); }
    const payload = { name: values.name, type: values.type, status: values.status, commissionBps: Math.round(Number(values.commissionPercent || 0) * 100), fixedFeeMinor: Number(values.fixedFeeMinor || 0), minimumAmountMinor: Number(values.minimumAmountMinor || 0), maximumAmountMinor: values.maximumAmountMinor === "" ? null : Number(values.maximumAmountMinor), sortOrder: Number(values.sortOrder || 0), destination, instructions: values.instructions };
    await api(values.methodId ? `/api/stores/${storeId}/payment-methods/${values.methodId}` : `/api/stores/${storeId}/payment-methods`, { method: values.methodId ? "PUT" : "POST", headers: { "x-csrf-token": state.csrf }, body: payload });
    resetMethodForm(); notice("تم حفظ طريقة الدفع.", "ok"); await Promise.all([loadMethods(), loadAudit()]);
  }

  async function toggleMethod(id) {
    const method = state.methods.find((entry) => entry.id === id);
    await api(`/api/stores/${storeId}/payment-methods/${id}`, { method: "PUT", headers: { "x-csrf-token": state.csrf }, body: { status: method.status === "active" ? "disabled" : "active" } });
    notice("تم تحديث حالة طريقة الدفع.", "ok"); await Promise.all([loadMethods(), loadAudit()]);
  }

  function openAdjustment(row) {
    const form = $("adjustmentForm"); form.reset(); form.elements.customerId.value = row.dataset.customerId; $("adjustmentCustomer").textContent = row.dataset.customerName; $("adjustmentDialog").showModal();
  }
  async function submitAdjustment(event) {
    event.preventDefault();
    if (event.submitter?.value === "cancel") return $("adjustmentDialog").close();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await api(`/api/stores/${storeId}/customers/${values.customerId}/wallet-adjustments`, { method: "POST", headers: { "x-csrf-token": state.csrf, "idempotency-key": crypto.randomUUID() }, body: { amountMinor: Number(values.amountMinor), reason: values.reason } });
    $("adjustmentDialog").close(); notice("تم تعديل الرصيد وتسجيل الحركة وإشعار العميل.", "ok"); await Promise.all([loadCustomers(), loadAudit(), loadNotifications()]);
  }
  async function toggleCustomer(row) {
    const current = row.querySelector(".status").textContent === "نشط" ? "active" : "blocked";
    await api(`/api/stores/${storeId}/customers/${row.dataset.customerId}`, { method: "PUT", headers: { "x-csrf-token": state.csrf }, body: { status: current === "active" ? "blocked" : "active" } });
    notice(current === "active" ? "تم حظر العميل وإلغاء جلساته." : "تم تفعيل حساب العميل.", "ok"); await Promise.all([loadCustomers(), loadAudit()]);
  }
  async function updateOrder(row) {
    const status = row.querySelector('[data-role="order-status"]').value;
    await api(`/api/stores/${storeId}/orders/${row.dataset.orderId}/status`, { method: "PUT", headers: { "x-csrf-token": state.csrf }, body: { status } });
    notice("تم تحديث حالة الطلب دون تغيير حالة الدفع.", "ok"); await Promise.all([loadOrders(), loadAudit()]);
  }

  async function refreshActiveView() {
    const loaders = { deposits: loadDeposits, methods: loadMethods, customers: loadCustomers, orders: loadOrders, audit: loadAudit };
    await Promise.all([loaders[state.activeView](), loadNotifications()]);
  }

  $("adminTabs").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-view]"); if (!button) return;
    state.activeView = button.dataset.view;
    document.querySelectorAll(".admin-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
    document.querySelectorAll("[data-view-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.viewPanel !== state.activeView));
    try { await refreshActiveView(); } catch (error) { notice(error.message); }
  });
  $("statusTabs").addEventListener("click", async (event) => { const button = event.target.closest("[data-status]"); if (!button) return; state.depositStatus = button.dataset.status; document.querySelectorAll("#statusTabs .tab").forEach((tab) => tab.classList.toggle("active", tab === button)); try { await loadDeposits(); } catch (error) { notice(error.message); } });
  document.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]"); if (!action) return;
    try {
      const depositRow = action.closest("[data-deposit-id]"); const methodRow = action.closest("[data-method-id]"); const customerRow = action.closest("[data-customer-id]"); const orderRow = action.closest("[data-order-id]");
      if (action.dataset.action === "approve-deposit") await reviewDeposit(depositRow.dataset.depositId, "approve");
      if (action.dataset.action === "reject-deposit") await reviewDeposit(depositRow.dataset.depositId, "reject");
      if (action.dataset.action === "edit-method") editMethod(state.methods.find((entry) => entry.id === methodRow.dataset.methodId));
      if (action.dataset.action === "toggle-method") await toggleMethod(methodRow.dataset.methodId);
      if (action.dataset.action === "adjust-wallet") openAdjustment(customerRow);
      if (action.dataset.action === "toggle-customer") await toggleCustomer(customerRow);
      if (action.dataset.action === "update-order") await updateOrder(orderRow);
    } catch (error) { notice(error.message); }
  });
  $("methodForm").addEventListener("submit", (event) => saveMethod(event).catch((error) => notice(error.message)));
  $("cancelMethodEdit").addEventListener("click", resetMethodForm);
  $("adjustmentForm").addEventListener("submit", (event) => submitAdjustment(event).catch((error) => notice(error.message)));
  $("customerSearchButton").addEventListener("click", () => loadCustomers().catch((error) => notice(error.message)));
  $("orderSearchButton").addEventListener("click", () => loadOrders().catch((error) => notice(error.message)));
  $("auditRefresh").addEventListener("click", () => loadAudit().catch((error) => notice(error.message)));
  $("refreshButton").addEventListener("click", () => refreshActiveView().catch((error) => notice(error.message)));
  $("markNotificationsRead").addEventListener("click", async () => { try { await api(`/api/stores/${storeId}/admin-notifications/read`, { method: "POST", headers: { "x-csrf-token": state.csrf }, body: {} }); await loadNotifications(); } catch (error) { notice(error.message); } });

  (async () => {
    try {
      const me = await api("/api/me"); state.csrf = me.csrfToken;
      await Promise.all([loadDeposits(), loadNotifications()]);
    } catch (error) { notice(`${error.message} — افتح لوحة المتجر وسجّل الدخول أولًا.`); }
  })();
})();
