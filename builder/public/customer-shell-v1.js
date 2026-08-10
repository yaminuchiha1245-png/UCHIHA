(() => {
  "use strict";

  const RELEASE = "2026.08.10.1-customer-shell";
  const DEMO_MARK = "/assets/demo-assets/uchiha-transparent-mark.svg";
  const root = document.documentElement;
  if (root.dataset.customerShell === RELEASE) return;
  root.dataset.customerShell = RELEASE;

  function isDemoContext() {
    const host = String(location.hostname || "").toLowerCase();
    return host.startsWith("demo.") || /^\/store\/demo(?:\/|$)/.test(String(location.pathname || ""));
  }

  function accountRoute() {
    return "/store/demo/account";
  }

  function demoNotice() {
    const bar = document.createElement("aside");
    bar.className = "reference-demo-bar customer-demo-bar";
    bar.setAttribute("role", "status");
    bar.innerHTML = `
      <span class="reference-demo-bar__dot" aria-hidden="true"></span>
      <span>متجر تجريبي للعرض فقط — الطلبات والمدفوعات الحقيقية معطّلة</span>
      <span class="reference-demo-bar__actions">
        <a data-reference-user-login href="${accountRoute()}">دخول المستخدم</a>
        <span class="reference-demo-bar__admin-mode">الإدارة حاليًا عبر بوت Telegram</span>
      </span>`;
    return bar;
  }

  function ensureDemoNotice() {
    if (!isDemoContext()) return;
    document.body.dataset.demoStore = "true";
    const app = document.querySelector("#storeApp, #accountApp");
    const header = app?.querySelector(":scope > .store-header, :scope > .account-header");
    if (!app || !header) return;
    let bar = app.querySelector(":scope > .reference-demo-bar") || document.querySelector(".reference-demo-bar");
    if (!bar) bar = demoNotice();
    bar.classList.add("customer-demo-bar");
    if (bar.parentElement !== app || bar.nextElementSibling !== header) header.before(bar);
    const login = bar.querySelector("[data-reference-user-login]");
    if (login) login.href = accountRoute();
  }

  function enforceDemoMark() {
    if (!isDemoContext()) return;
    [
      ["#storeLogoImage", "#storeTextLogo"],
      ["#headerLogo", "#headerTextLogo"]
    ].forEach(([imageSelector, textSelector]) => {
      const image = document.querySelector(imageSelector);
      if (!image) return;
      const sync = () => {
        if (!image.getAttribute("src")?.endsWith("uchiha-transparent-mark.svg")) image.setAttribute("src", DEMO_MARK);
        image.hidden = false;
        const text = document.querySelector(textSelector);
        if (text) text.hidden = true;
      };
      sync();
      if (image.dataset.customerMarkObserved !== "true") {
        image.dataset.customerMarkObserved = "true";
        new MutationObserver(sync).observe(image, { attributes: true, attributeFilter: ["src", "hidden"] });
      }
    ]);
  }

  function normalizeRouteBack() {
    const button = document.querySelector("#headerBack.account-route-back");
    if (!button) return;
    const label = button.querySelector("span");
    if (label && !label.textContent.trim()) label.textContent = "العودة";
  }

  function ensureAccountPaymentProofAssets() {
    if (document.body?.dataset.page !== "account") return;
    if (!document.querySelector('link[data-payment-proof-v3-style="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/assets/account-payment-proof-v3.css?v=2026.08.10.1";
      link.dataset.paymentProofV3Style = "true";
      document.head.append(link);
    }
    if (!document.querySelector('script[data-payment-proof-v3-script="true"]')) {
      const script = document.createElement("script");
      script.src = "/assets/account-payment-proof-v3.js?v=2026.08.10.1";
      script.dataset.paymentProofV3Script = "true";
      document.body.append(script);
    }
  }

  function ensureStoreDirectBuyAsset() {
    if (document.body?.dataset.page !== "store") return;
    if (document.querySelector('script[data-store-direct-buy-v7="true"]')) return;
    const script = document.createElement("script");
    script.src = "/assets/store-direct-buy-v7.js?v=2026.08.10.1";
    script.dataset.storeDirectBuyV7 = "true";
    document.body.append(script);
  }

  function normalize() {
    ensureDemoNotice();
    enforceDemoMark();
    normalizeRouteBack();
    ensureAccountPaymentProofAssets();
    ensureStoreDirectBuyAsset();
  }

  function install() {
    normalize();
    const target = document.querySelector("#storeApp, #accountApp") || document.body;
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        normalize();
      });
    }).observe(target, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
