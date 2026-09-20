(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  let csrf = "";
  let productCurrency = "USD";

  function notice(message, error = false) {
    const node = $("#notice");
    node.textContent = message;
    node.classList.toggle("error", error);
    node.hidden = false;
  }

  function currencyDigits(currency) {
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    } catch {
      return 2;
    }
  }

  function minorToMajor(minor, currency) {
    if (minor === null || minor === undefined) return "";
    const factor = 10 ** currencyDigits(currency);
    return String(Number(minor) / factor);
  }

  function majorToMinor(value, currency) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("أدخل سعرًا أكبر من صفر");
    const factor = 10 ** currencyDigits(currency);
    const minor = Math.round(amount * factor);
    if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error("السعر غير صالح");
    return minor;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: {
        accept: "application/json",
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.method && options.method !== "GET" && csrf ? { "x-csrf-token": csrf } : {}),
        ...(options.headers || {})
      },
      body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || "تعذر إكمال العملية");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function load() {
    try {
      const me = await api("/api/me");
      csrf = me.csrfToken || sessionStorage.getItem("uchihaBuilderCsrf") || "";
      if (csrf) sessionStorage.setItem("uchihaBuilderCsrf", csrf);

      const payload = await api("/api/platform/admin/ai-product");
      const product = payload.product || {};
      productCurrency = product.currency || "USD";
      const form = $("#productForm");
      form.elements.currency.value = productCurrency;
      form.elements.price.value = minorToMajor(product.priceMinor, productCurrency);
      form.elements.status.value = product.status || "hidden";
      form.hidden = false;
      $("#adminLogin").hidden = true;

      $("#totalBots").textContent = String(payload.instances?.total ?? 0);
      $("#activeBots").textContent = String(payload.instances?.active ?? 0);
      $("#awaitingBots").textContent = String(payload.instances?.awaitingToken ?? 0);
      $("#usageRequests").textContent = String(payload.usage?.requests ?? 0);
      $("#stats").hidden = false;

      if (!product.priceConfigured) notice("حدد سعر المنتج ثم احفظه قبل فتح البيع.");
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        $("#adminLogin").hidden = false;
        $("#productForm").hidden = true;
        notice("هذه الصفحة مخصصة لمدير منصة UCHIHA. سجل الدخول من لوحة إدارة المنصة.", true);
        return;
      }
      notice(error.message, true);
    }
  }

  $("#productForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    const currency = String(values.currency || productCurrency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      notice("رمز العملة يجب أن يكون 3 أحرف مثل USD.", true);
      return;
    }
    button.disabled = true;
    try {
      const result = await api("/api/platform/admin/ai-product", {
        method: "PATCH",
        body: {
          priceMinor: majorToMinor(values.price, currency),
          currency,
          status: values.status
        }
      });
      productCurrency = result.product?.currency || currency;
      form.elements.price.value = minorToMajor(result.product?.priceMinor, productCurrency);
      form.elements.currency.value = productCurrency;
      form.elements.status.value = result.product?.status || values.status;
      notice(result.product?.status === "active" ? "تم حفظ السعر والمنتج مفتوح للبيع." : "تم حفظ إعدادات المنتج.");
    } catch (error) {
      notice(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  load();
})();
