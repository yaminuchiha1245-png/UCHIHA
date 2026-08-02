(() => {
  "use strict";

  const BUILDER_CSRF_KEY = "uchihaBuilderCsrf";
  const money = (minor, currency = "USD") => {
    let digits = 2;
    try {
      digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    } catch {
      digits = 2;
    }
    return new Intl.NumberFormat("ar", { style: "currency", currency }).format(Number(minor || 0) / (10 ** digits));
  };

  async function api(path, { method = "GET", body, headers = {}, csrf } = {}) {
    const requestHeaders = { accept: "application/json", ...headers };
    if (body !== undefined) requestHeaders["content-type"] = "application/json";
    const token = csrf || sessionStorage.getItem(BUILDER_CSRF_KEY) || "";
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && token) requestHeaders["x-csrf-token"] = token;
    const response = await fetch(path, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store"
    });
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.message || "تعذر إكمال العملية");
      error.status = response.status;
      error.code = data?.error;
      throw error;
    }
    if (data?.csrfToken) sessionStorage.setItem(BUILDER_CSRF_KEY, data.csrfToken);
    return data;
  }

  function node(tag, { className, text, attrs = {} } = {}, children = []) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    for (const [name, value] of Object.entries(attrs)) {
      if (value !== null && value !== undefined) item.setAttribute(name, String(value));
    }
    for (const child of children) if (child) item.append(child);
    return item;
  }

  function installStyles() {
    if (document.querySelector("style[data-launch-sales]")) return;
    const style = document.createElement("style");
    style.dataset.launchSales = "true";
    style.textContent = `
      body.launch-builder-route>.topbar nav,
      body.launch-builder-route>.topbar .pwa-install,
      body.launch-builder-route main>.hero,
      body.launch-builder-route main>#services,
      body.launch-builder-route main>#how,
      body.launch-builder-route main>#templates,
      body.launch-builder-route>footer{display:none!important}
      body.launch-builder-route .builder-shell{margin-block:1rem 2rem;min-height:calc(100dvh - 96px)}
      .launch-subscription-box{display:grid;gap:14px;margin-top:18px;padding:16px;border:1px solid var(--border,#d9dde5);border-radius:16px;background:var(--surface,#fff)}
      .launch-subscription-box[hidden],.launch-subscription-form[hidden]{display:none!important}
      .launch-subscription-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .launch-subscription-form label{display:grid;gap:7px;min-width:0;font-weight:700}
      .launch-subscription-form .wide{grid-column:1/-1}
      .launch-subscription-form input,.launch-subscription-form select,.launch-subscription-form textarea{width:100%;min-width:0;min-height:44px;padding:10px 12px;border:1px solid var(--border,#cfd5de);border-radius:11px;background:var(--surface,#fff);color:var(--text,#20242d);font:inherit}
      .launch-payment-details{display:grid;gap:8px;padding:12px;border:1px dashed var(--border,#cfd5de);border-radius:12px;overflow-wrap:anywhere}
      .launch-payment-details img{width:170px;height:170px;object-fit:contain;max-width:100%;border-radius:12px;background:#fff}
      .launch-actions{display:flex;flex-wrap:wrap;gap:9px;align-items:center}
      .launch-status{padding:12px 14px;border-radius:12px;line-height:1.8;background:#eef4ff;color:#1f3c70}
      .launch-status.error{background:#fff0f2;color:#8c263a}.launch-status.success{background:#eaf8f0;color:#16633a}
      .launch-copy{min-height:38px;padding:7px 11px;border:1px solid var(--border,#cfd5de);border-radius:9px;background:transparent;color:inherit;font:inherit;font-weight:700}
      @media(max-width:720px){body.launch-builder-route .builder-shell{padding:12px;margin-block-start:.5rem}.launch-subscription-form{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function activateProgress(key) {
    const order = ["account", "subscription", "identity", "publish"];
    const current = order.indexOf(key);
    document.querySelectorAll("[data-progress]").forEach((item) => {
      const index = order.indexOf(item.dataset.progress);
      item.classList.toggle("active", index === current);
      item.classList.toggle("done", index < current);
    });
  }

  function showBuilderStoreStep() {
    const store = document.querySelector("#storeStep");
    if (!store) return;
    for (const id of ["authStep", "subscriptionStep", "resultStep"]) {
      const section = document.getElementById(id);
      if (section) section.hidden = true;
    }
    store.hidden = false;
    activateProgress("identity");
    requestAnimationFrame(() => store.scrollIntoView({ block: "start" }));
  }

  function setStatus(container, message, type = "") {
    container.textContent = message;
    container.className = `launch-status ${type}`.trim();
    container.hidden = false;
  }

  function paymentLabel(method) {
    return method?.name?.ar || method?.name?.en || method?.key || "طريقة دفع";
  }

  function renderPaymentDetails(method, target) {
    target.replaceChildren();
    if (!method) {
      target.hidden = true;
      return;
    }
    target.hidden = false;
    target.append(node("b", { text: `${paymentLabel(method)} — ${method.currency || ""}` }));
    if (method.network) target.append(node("p", { text: `الشبكة: ${method.network}` }));
    if (method.beneficiaryName) target.append(node("p", { text: `اسم المستفيد: ${method.beneficiaryName}` }));
    if (method.accountIdentifier) {
      const row = node("div", { className: "launch-actions" });
      row.append(node("span", { text: `بيانات التحويل: ${method.accountIdentifier}`, attrs: { dir: "ltr" } }));
      const copy = node("button", { className: "launch-copy", text: "نسخ", attrs: { type: "button" } });
      copy.addEventListener("click", async () => {
        await navigator.clipboard?.writeText(method.accountIdentifier).catch(() => undefined);
        copy.textContent = "تم النسخ";
      });
      row.append(copy);
      target.append(row);
    }
    for (const instruction of (method.instructions || []).filter((item) => item.locale === "ar")) {
      target.append(node("p", { text: `${instruction.title}: ${instruction.body}` }));
      if (instruction.warning) target.append(node("small", { text: instruction.warning }));
    }
    const qr = method.qrUrl || method.qrImageUrl;
    if (qr) target.append(node("img", { attrs: { src: qr, alt: `QR ${paymentLabel(method)}`, loading: "lazy" } }));
  }

  async function installBuilderSales() {
    if (document.body?.dataset.page !== "builder" || location.pathname !== "/create-store") return;
    document.body.classList.add("launch-builder-route");
    const subscriptionStep = document.querySelector("#subscriptionStep");
    if (!subscriptionStep || document.querySelector("#launchSubscriptionBox")) return;

    const box = node("div", { className: "launch-subscription-box", attrs: { id: "launchSubscriptionBox" } });
    const status = node("div", { className: "launch-status", attrs: { role: "status", "aria-live": "polite", hidden: "" } });
    const form = node("form", { className: "launch-subscription-form", attrs: { id: "launchSubscriptionForm" } });
    const methodSelect = node("select", { attrs: { name: "paymentMethodId", required: "" } });
    const methodLabel = node("label", { className: "wide", text: "طريقة الدفع" }, [methodSelect]);
    const details = node("div", { className: "launch-payment-details wide", attrs: { hidden: "" } });
    const reference = node("input", { attrs: { name: "reference", required: "", maxlength: "240", dir: "ltr", autocomplete: "off", placeholder: "Transaction ID / Reference" } });
    const referenceLabel = node("label", { className: "wide", text: "رقم العملية أو مرجع التحويل" }, [reference]);
    const note = node("textarea", { attrs: { name: "note", maxlength: "1200", rows: "2", placeholder: "اسم المحوّل أو ملاحظة تساعد على التحقق" } });
    const noteLabel = node("label", { className: "wide", text: "ملاحظة اختيارية" }, [note]);
    const submit = node("button", { className: "button", text: "إرسال طلب التفعيل", attrs: { type: "submit" } });
    const support = node("a", { className: "button button-secondary", text: "التواصل مع الدعم", attrs: { href: "/contact" } });
    const actions = node("div", { className: "launch-actions wide" }, [submit, support]);
    form.append(methodLabel, details, referenceLabel, noteLabel, actions);
    box.append(status, form);
    subscriptionStep.append(box);

    let methods = [];
    try {
      const portal = await api("/api/public/portal");
      methods = (portal.paymentMethods || []).filter((item) => item.status === "active" && item.configured);
      methodSelect.replaceChildren(...methods.map((method) => node("option", {
        text: `${paymentLabel(method)} — ${method.currency || ""}${method.network ? ` — ${method.network}` : ""}`,
        attrs: { value: method.id }
      })));
      const whatsapp = (portal.contacts || []).find((item) => item.type === "whatsapp" && item.status === "active");
      if (whatsapp?.target) support.href = whatsapp.target;
      if (!methods.length) {
        form.hidden = true;
        setStatus(status, "لا توجد طريقة دفع مهيأة حاليًا. تواصل مع الدعم قبل إرسال أي مبلغ.", "error");
      }
      renderPaymentDetails(methods[0], details);
    } catch (error) {
      form.hidden = true;
      setStatus(status, error.message, "error");
    }

    methodSelect.addEventListener("change", () => {
      renderPaymentDetails(methods.find((item) => item.id === methodSelect.value), details);
    });

    let syncing = false;
    let pollTimer = null;
    function scheduleSync(delay = 5000) {
      window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(() => {
        if (document.visibilityState === "visible") syncState();
        else scheduleSync(delay);
      }, delay);
    }

    async function syncState() {
      if (syncing) return;
      syncing = true;
      try {
        const state = await api("/api/subscription-status");
        if (state.subscription) {
          window.clearTimeout(pollTimer);
          box.hidden = true;
          showBuilderStoreStep();
          return;
        }
        box.hidden = false;
        const request = state.request;
        if (!request || ["rejected", "cancelled"].includes(request.status)) {
          form.hidden = methods.length === 0;
          if (request?.status === "rejected") {
            setStatus(status, "تم رفض طلب التفعيل السابق. راجع مرجع التحويل أو تواصل مع الدعم ثم أرسل طلبًا جديدًا.", "error");
          } else if (methods.length) {
            status.hidden = true;
          }
          return;
        }
        if (request.status === "completed") {
          setStatus(status, "تم اعتماد الدفع. جارٍ فتح معالج إنشاء المتجر…", "success");
          scheduleSync(900);
          return;
        }
        form.hidden = true;
        setStatus(status, "طلب التفعيل قيد المراجعة. بعد اعتماد التحويل سيُفتح إنشاء المتجر تلقائيًا.", "success");
        scheduleSync(5000);
      } catch (error) {
        if (error.status !== 401) {
          setStatus(status, error.message, "error");
          scheduleSync(8000);
        }
      } finally {
        syncing = false;
      }
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      status.hidden = true;
      try {
        const values = Object.fromEntries(new FormData(form).entries());
        const result = await api("/api/subscription-requests", {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: values
        });
        if (result.subscriptionActive) showBuilderStoreStep();
        else {
          form.hidden = true;
          setStatus(status, "تم إرسال طلب التفعيل بنجاح وهو الآن قيد المراجعة.", "success");
          scheduleSync(5000);
        }
      } catch (error) {
        setStatus(status, error.message, "error");
      } finally {
        submit.disabled = false;
      }
    });

    const nativeFetch = window.fetch.bind(window);
    if (!window.__uchihaLaunchSalesFetchWatch) {
      window.__uchihaLaunchSalesFetchWatch = true;
      window.fetch = async (...args) => {
        const response = await nativeFetch(...args);
        let pathname = "";
        try { pathname = new URL(typeof args[0] === "string" ? args[0] : args[0].url, location.href).pathname; } catch { pathname = ""; }
        if (response.ok && ["/api/auth/login", "/api/auth/register"].includes(pathname)) {
          window.setTimeout(syncState, 100);
          window.setTimeout(syncState, 700);
        }
        return response;
      };
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !subscriptionStep.hidden) syncState();
    });

    new MutationObserver(() => {
      if (!subscriptionStep.hidden) window.setTimeout(syncState, 30);
    }).observe(subscriptionStep, { attributes: true, attributeFilter: ["hidden"] });
    await syncState();
    window.setTimeout(syncState, 900);
  }

  installStyles();
  const install = () => installBuilderSales();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
