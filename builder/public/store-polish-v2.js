(() => {
  "use strict";

  const RELEASE = "2026.08.07.7";
  const root = document.documentElement;
  if (root.dataset.storePolishRuntime === RELEASE) return;
  root.dataset.storePolishRuntime = RELEASE;

  function installSearchClear() {
    const input = document.querySelector("#storeSearch");
    const shell = input?.closest(".store-main-search");
    if (!input || !shell || shell.querySelector(".store-search-clear")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "store-search-clear";
    button.hidden = !input.value;
    button.setAttribute("aria-label", "مسح البحث");
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';

    const sync = () => {
      button.hidden = !input.value.trim();
    };

    input.addEventListener("input", sync);
    button.addEventListener("click", () => {
      if (!input.value) return;
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus({ preventScroll: true });
    });

    shell.append(button);
    sync();
  }

  function fallbackFor(image) {
    if (image.closest(".store-brand,.drawer-brand,.store-loader-orbit,.reference-login-mark")) {
      return "/assets/brand/uchiha-mark.svg";
    }
    if (image.closest(".category-card-visual,.subcategory-visual")) {
      return "/assets/brand/uchiha-mark.svg";
    }
    return "/assets/catalog-assets/digital-card.svg";
  }

  function handleImageFailure(event) {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.closest('.store-app,[data-page="store"]')) return;
    if (image.dataset.storeFallback === "true") return;
    image.dataset.storeFallback = "true";
    image.removeAttribute("srcset");
    image.src = fallbackFor(image);
  }

  function installImageRecovery() {
    document.addEventListener("error", handleImageFailure, true);
  }

  function installProductState() {
    const products = document.querySelector("#storeProducts");
    const summary = document.querySelector("#productsSummary");
    if (!products) return;

    const status = document.createElement("span");
    status.className = "store-runtime-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");
    products.after(status);

    let lastMessage = "";
    const sync = () => {
      const busy = Boolean(products.querySelector(".store-product-skeleton"));
      products.setAttribute("aria-busy", String(busy));
      if (busy) return;
      const count = products.querySelectorAll(".store-product-card").length;
      const message = summary?.textContent?.trim() || (count ? `تم عرض ${count} منتجات` : "تم تحديث النتائج");
      if (!message || message === lastMessage) return;
      lastMessage = message;
      status.textContent = message;
    };

    const observer = new MutationObserver(sync);
    observer.observe(products, { childList: true });
    if (summary) observer.observe(summary, { childList: true, characterData: true, subtree: true });
    sync();
  }

  function install() {
    installSearchClear();
    installImageRecovery();
    installProductState();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
