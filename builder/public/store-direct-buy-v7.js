(() => {
  "use strict";

  if (document.body?.dataset.page !== "store") return;
  const RELEASE = "2026.08.11.2-direct-buy";
  if (document.documentElement.dataset.storeDirectBuy === RELEASE) return;
  document.documentElement.dataset.storeDirectBuy = RELEASE;

  function normalizeProductCards() {
    document.querySelectorAll(".store-product-card").forEach((card) => {
      const kind = card.querySelector(".product-kind")?.textContent?.trim() || "";
      const actions = card.querySelector(".product-actions");
      const cartButton = card.querySelector(".store-add-cart");
      const buyButton = actions?.querySelector("button:not(.store-add-cart)");
      const directOnly = /خدمة/.test(kind);
      card.dataset.directPurchase = String(directOnly);
      if (cartButton) cartButton.hidden = directOnly;
      if (actions) actions.classList.toggle("direct-purchase-only", directOnly);
      if (buyButton) buyButton.textContent = "شراء الآن";
    });
  }

  function normalizeOrderDialog() {
    const form = document.querySelector("#orderForm");
    if (!form) return;
    const submit = form.querySelector('button[value="submit"]');
    if (!submit) return;
    submit.textContent = form.dataset.mode === "cart" ? "إضافة إلى السلة" : "شراء الآن";
  }

  function install() {
    normalizeProductCards();
    normalizeOrderDialog();
    const form = document.querySelector("#orderForm");
    if (form && form.dataset.directBuyBound !== "true") {
      form.dataset.directBuyBound = "true";
      form.addEventListener("uchiha:order-opened", normalizeOrderDialog);
    }
    const products = document.querySelector("#storeProducts") || document.body;
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        normalizeProductCards();
      });
    }).observe(products, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
