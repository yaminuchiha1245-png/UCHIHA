(() => {
  "use strict";

  if (document.body?.dataset.page !== "account") return;
  const RELEASE = "2026.08.10.4-payment-placeholders";
  if (document.documentElement.dataset.paymentPlaceholders === RELEASE) return;
  document.documentElement.dataset.paymentPlaceholders = RELEASE;

  const primary = [
    { key: "sham_cash", name: "شام كاش", logo: "/assets/payment-assets/sham-cash.svg" },
    { key: "binance_pay", name: "Binance Pay", logo: "/assets/payment-assets/binance-pay.svg" },
    { key: "usdt_trc20", name: "USDT", logo: "/assets/payment-assets/usdt.svg" }
  ];

  function configuredKeys(container) {
    const keys = new Set();
    container.querySelectorAll(".payment-proof-method-card:not(.payment-proof-method-card-placeholder) img").forEach((image) => {
      const source = String(image.getAttribute("src") || "");
      if (source.includes("sham-cash.svg")) keys.add("sham_cash");
      if (source.includes("binance-pay.svg")) keys.add("binance_pay");
      if (source.includes("usdt.svg")) keys.add("usdt_trc20");
    });
    return keys;
  }

  function placeholder(method) {
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = true;
    button.className = "payment-proof-method-card payment-proof-method-card-placeholder";
    button.dataset.paymentPlaceholder = method.key;
    button.setAttribute("aria-label", `${method.name} — قيد الإعداد`);
    button.innerHTML = `
      <span class="payment-proof-method-logo"><img src="${method.logo}" alt=""></span>
      <b>${method.name}</b>
      <small>قيد الإعداد</small>`;
    return button;
  }

  function sync() {
    const section = document.querySelector('[data-section="add-funds"]');
    const container = document.getElementById("paymentMethods");
    if (!section || section.hidden || !container || container.dataset.proofLaunch !== "true") return;

    container.querySelectorAll("[data-payment-placeholder]").forEach((item) => item.remove());
    const error = container.querySelector(".payment-proof-empty");
    const errorText = String(error?.textContent || "");
    if (/سجّل الدخول|تعذر|خطأ/.test(errorText)) return;

    const configured = configuredKeys(container);
    const missing = primary.filter((method) => !configured.has(method.key));
    if (!missing.length) return;

    if (!container.querySelector(".payment-proof-method-card:not(.payment-proof-method-card-placeholder)")) {
      error?.remove();
    }
    missing.forEach((method) => container.append(placeholder(method)));
  }

  function install() {
    sync();
    const root = document.getElementById("accountApp") || document.body;
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        sync();
      });
    }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "data-proof-launch"] });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
