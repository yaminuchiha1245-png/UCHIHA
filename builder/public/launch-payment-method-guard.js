(() => {
  "use strict";

  if (location.pathname !== "/create-store") return;

  let portalMethods = null;
  let checking = false;

  const amountFits = (method, amountMinor) => {
    const amount = Number(amountMinor || 0);
    const minimum = method.minimumAmountMinor == null ? null : Number(method.minimumAmountMinor);
    const maximum = method.maximumAmountMinor == null ? null : Number(method.maximumAmountMinor);
    return amount > 0
      && (minimum == null || amount >= minimum)
      && (maximum == null || amount <= maximum);
  };

  const compatible = (method, offer) => Boolean(
    method
      && method.status === "active"
      && method.configured
      && String(method.currency || "").toUpperCase() === String(offer.currency || "").toUpperCase()
      && amountFits(method, offer.priceMinor)
  );

  async function getJson(path) {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || "تعذر تحميل بيانات الدفع");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function warningNode(form) {
    let warning = document.getElementById("launchPaymentRangeWarning");
    if (!warning) {
      warning = document.createElement("div");
      warning.id = "launchPaymentRangeWarning";
      warning.className = "launch-status error";
      warning.setAttribute("role", "alert");
      warning.hidden = true;
      form.parentElement?.insertBefore(warning, form);
    }
    return warning;
  }

  async function apply() {
    if (checking) return;
    const step = document.getElementById("subscriptionStep");
    const form = document.getElementById("launchSubscriptionForm");
    const select = form?.querySelector('select[name="paymentMethodId"]');
    if (!step || step.hidden || !form || !select) return;

    checking = true;
    try {
      const [portal, state] = await Promise.all([
        portalMethods ? Promise.resolve({ paymentMethods: portalMethods }) : getJson("/api/public/portal"),
        getJson("/api/subscription-status")
      ]);
      portalMethods = Array.isArray(portal.paymentMethods) ? portal.paymentMethods : [];
      const offer = state.offer;
      if (!offer || state.subscription) return;

      const byId = new Map(portalMethods.map((method) => [method.id, method]));
      const allowed = [];
      for (const option of select.options) {
        const method = byId.get(option.value);
        option.disabled = !compatible(method, offer);
        if (!option.disabled) allowed.push(option);
      }

      const warning = warningNode(form);
      if (!allowed.length) {
        select.disabled = true;
        form.style.setProperty("display", "none", "important");
        warning.hidden = false;
        warning.textContent = "لا توجد طريقة دفع تقبل قيمة الاشتراك وعملته حاليًا. لا ترسل أي مبلغ قبل تعديل طريقة الدفع من الإدارة أو التواصل مع الدعم.";
        return;
      }

      select.disabled = false;
      form.style.removeProperty("display");
      warning.hidden = true;
      const selected = select.selectedOptions[0];
      if (!selected || selected.disabled) {
        select.value = allowed[0].value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } catch (error) {
      if (error.status !== 401) console.warn("UCHIHA payment method compatibility check failed", error.message);
    } finally {
      checking = false;
    }
  }

  const step = document.getElementById("subscriptionStep");
  if (step) {
    new MutationObserver(() => window.setTimeout(apply, 50))
      .observe(step, { attributes: true, childList: true, subtree: true, attributeFilter: ["hidden", "disabled"] });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") apply();
  });
  window.addEventListener("focus", apply);
  window.setTimeout(apply, 250);
})();
