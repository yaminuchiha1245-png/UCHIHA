(() => {
  "use strict";

  if (location.pathname !== "/account") return;

  const state = {
    csrf: "",
    subscriptions: [],
    requests: [],
    paymentMethods: [],
    loading: false
  };

  const money = (minor, currency = "USD") => {
    try {
      return new Intl.NumberFormat("ar-SY", { style: "currency", currency }).format(Number(minor || 0) / 100);
    } catch {
      return `${(Number(minor || 0) / 100).toFixed(2)} ${currency}`;
    }
  };

  const date = (value) => {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat("ar-SY", { dateStyle: "medium" }).format(new Date(value));
    } catch {
      return "—";
    }
  };

  async function json(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.message || "تعذر إكمال العملية");
        error.status = response.status;
        error.code = payload.error;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function currentRequest(tenantId) {
    return state.requests.find((item) => {
      const metadata = item.metadata || {};
      return metadata.tenantId === tenantId && !["completed", "cancelled", "rejected"].includes(item.status);
    });
  }

  function configuredPaymentMethods(currency) {
    return state.paymentMethods.filter(
      (method) => method.status === "active" && method.configured && (!method.currency || method.currency === currency)
    );
  }

  function notice(container, message, isError = false) {
    const node = container.querySelector("[data-renewal-notice]");
    if (!node) return;
    node.hidden = false;
    node.classList.toggle("error", isError);
    node.textContent = message;
  }

  function paymentDetails(method) {
    const wrap = el("div", "account-renewal-payment-details");
    if (!method) return wrap;
    const title = el("b", "", method.name?.ar || method.name?.en || method.key || "طريقة الدفع");
    wrap.append(title);
    if (method.network) wrap.append(el("small", "", `الشبكة: ${method.network}`));
    if (method.accountIdentifier) {
      const row = el("div", "account-renewal-copy-row");
      const code = el("code", "", method.accountIdentifier);
      const copy = el("button", "account-unified-small-button", "نسخ");
      copy.type = "button";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(method.accountIdentifier);
          copy.textContent = "تم النسخ";
          setTimeout(() => { copy.textContent = "نسخ"; }, 1200);
        } catch {
          copy.textContent = "انسخ يدويًا";
        }
      });
      row.append(code, copy);
      wrap.append(row);
    }
    if (method.qrUrl || method.qrImageUrl) {
      const image = new Image();
      image.className = "account-renewal-qr";
      image.alt = `QR ${method.name?.ar || "الدفع"}`;
      image.loading = "lazy";
      image.src = method.qrUrl || method.qrImageUrl;
      wrap.append(image);
    }
    for (const instruction of (method.instructions || []).filter((item) => item.locale === "ar")) {
      if (instruction.title) wrap.append(el("strong", "", instruction.title));
      if (instruction.body) wrap.append(el("p", "", instruction.body));
      if (instruction.warning) wrap.append(el("p", "account-renewal-warning", instruction.warning));
    }
    return wrap;
  }

  function openRenewalDialog(subscription) {
    let dialog = document.getElementById("accountRenewalDialog");
    if (dialog) dialog.remove();
    dialog = document.createElement("dialog");
    dialog.id = "accountRenewalDialog";
    dialog.className = "account-renewal-dialog";

    const form = document.createElement("form");
    form.method = "dialog";
    form.className = "account-renewal-form";
    const header = el("div", "account-renewal-dialog-head");
    const copy = el("div");
    copy.append(el("span", "account-unified-kicker", "تجديد الاشتراك"));
    copy.append(el("h2", "", subscription.storeName || subscription.tenantName || "المتجر"));
    copy.append(el("p", "", `قيمة التجديد: ${money(subscription.renewalPriceMinor, subscription.currency)} • المدة ${subscription.durationCount} ${subscription.durationUnit === "year" ? "سنة" : subscription.durationUnit === "month" ? "شهر" : "يوم"}`));
    const close = el("button", "account-renewal-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "إغلاق");
    close.addEventListener("click", () => dialog.close());
    header.append(copy, close);

    const methods = configuredPaymentMethods(subscription.currency);
    const methodLabel = el("label", "account-unified-field", "طريقة الدفع");
    const select = document.createElement("select");
    select.name = "paymentMethodId";
    select.required = true;
    if (!methods.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "لا توجد طريقة دفع متاحة لهذه العملة";
      select.append(option);
      select.disabled = true;
    } else {
      for (const method of methods) {
        const option = document.createElement("option");
        option.value = method.id;
        option.textContent = `${method.name?.ar || method.name?.en || method.key}${method.network ? ` — ${method.network}` : ""}`;
        select.append(option);
      }
    }
    methodLabel.append(select);
    const details = el("div", "account-renewal-payment-box");
    const renderDetails = () => {
      details.replaceChildren(paymentDetails(methods.find((item) => item.id === select.value)));
    };
    select.addEventListener("change", renderDetails);
    renderDetails();

    const referenceLabel = el("label", "account-unified-field", "رقم العملية / مرجع التحويل");
    const reference = document.createElement("input");
    reference.name = "reference";
    reference.required = true;
    reference.maxLength = 240;
    reference.autocomplete = "off";
    reference.placeholder = "أدخل المرجع بعد التحويل";
    referenceLabel.append(reference);

    const noteLabel = el("label", "account-unified-field", "ملاحظة (اختياري)");
    const note = document.createElement("textarea");
    note.name = "note";
    note.maxLength = 1200;
    note.rows = 3;
    noteLabel.append(note);

    const message = el("div", "account-unified-notice");
    message.dataset.renewalNotice = "";
    message.hidden = true;

    const actions = el("div", "account-renewal-actions");
    const cancel = el("button", "account-unified-button-secondary", "إلغاء");
    cancel.type = "button";
    cancel.addEventListener("click", () => dialog.close());
    const submit = el("button", "account-unified-button", "أرسلت التحويل — إرسال للمراجعة");
    submit.type = "submit";
    submit.disabled = !methods.length;
    actions.append(cancel, submit);

    form.append(header, methodLabel, details, referenceLabel, noteLabel, message, actions);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      submit.textContent = "جارٍ إرسال الطلب...";
      try {
        await json(`/api/subscription-renewals/${encodeURIComponent(subscription.tenantId)}/requests`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": state.csrf,
            "idempotency-key": crypto.randomUUID()
          },
          body: JSON.stringify({
            paymentMethodId: select.value,
            reference: reference.value.trim(),
            note: note.value.trim()
          })
        });
        notice(form, "تم إرسال طلب التجديد للمراجعة. لن يُطلب منك التحويل مرة ثانية لنفس الطلب.");
        submit.textContent = "تم إرسال الطلب";
        await loadData();
        setTimeout(() => dialog.close(), 900);
      } catch (error) {
        notice(form, error.message, true);
        submit.disabled = false;
        submit.textContent = "أرسلت التحويل — إرسال للمراجعة";
      }
    });
    dialog.append(form);
    document.body.append(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function subscriptionCard(subscription) {
    const card = el("article", "account-renewal-store");
    const head = el("div", "account-renewal-store-head");
    const copy = el("div");
    copy.append(el("strong", "", subscription.storeName || subscription.tenantName || "متجر UCHIHA"));
    copy.append(el("small", "", `ينتهي: ${date(subscription.endsAt)}`));
    const badge = el("span", `account-renewal-status ${subscription.status || ""}`, subscription.status === "expired" ? "منتهي" : subscription.status === "past_due" ? "متأخر" : "فعّال");
    head.append(copy, badge);
    const price = el("div", "account-renewal-price");
    price.append(el("span", "", "سعر التجديد"), el("b", "", money(subscription.renewalPriceMinor, subscription.currency)));
    const request = currentRequest(subscription.tenantId);
    const action = el("button", "account-unified-small-button", request ? "طلب التجديد قيد المراجعة" : "تجديد الاشتراك");
    action.type = "button";
    action.disabled = Boolean(request) || !subscription.renewalEnabled || Number(subscription.renewalPriceMinor || 0) <= 0;
    if (!request && !action.disabled) action.addEventListener("click", () => openRenewalDialog(subscription));
    card.append(head, price, action);
    return card;
  }

  function inject() {
    if (document.querySelector("[data-account-renewals-card]")) return;
    const overview = document.querySelector('[data-account-panel="overview"] .account-unified-grid');
    if (!overview) return;
    const card = el("article", "account-unified-card account-renewals-card");
    card.dataset.accountRenewalsCard = "";
    const head = el("div", "account-unified-card-head");
    const heading = el("div");
    heading.append(el("h2", "", "اشتراكات المتاجر"), el("p", "", "تابع الانتهاء وجدّد من نفس حساب UCHIHA."));
    head.append(heading);
    const body = el("div", "account-renewal-list");
    if (state.loading) {
      body.append(el("p", "account-unified-empty", "جارٍ تحميل الاشتراكات..."));
    } else if (!state.subscriptions.length) {
      body.append(el("div", "account-unified-empty", "لا يوجد اشتراك متجر مرتبط بهذا الحساب بعد."));
    } else {
      for (const subscription of state.subscriptions) body.append(subscriptionCard(subscription));
    }
    card.append(head, body);
    overview.append(card);
  }

  async function loadData() {
    if (state.loading) return;
    state.loading = true;
    try {
      const [me, renewals, portal] = await Promise.all([
        json("/api/me"),
        json("/api/subscription-renewals"),
        json("/api/public/portal")
      ]);
      state.csrf = me.csrfToken || "";
      state.subscriptions = Array.isArray(renewals.subscriptions) ? renewals.subscriptions : [];
      state.requests = Array.isArray(renewals.requests) ? renewals.requests : [];
      state.paymentMethods = Array.isArray(portal.paymentMethods) ? portal.paymentMethods : [];
    } catch (error) {
      if (error.status !== 401) console.warn("UCHIHA renewal account load failed", error.code || error.message);
    } finally {
      state.loading = false;
      document.querySelector("[data-account-renewals-card]")?.remove();
      inject();
    }
  }

  let observerTimer = 0;
  const observer = new MutationObserver(() => {
    clearTimeout(observerTimer);
    observerTimer = setTimeout(inject, 50);
  });
  observer.observe(document.getElementById("accountApp") || document.body, { childList: true, subtree: true });
  loadData();
})();
