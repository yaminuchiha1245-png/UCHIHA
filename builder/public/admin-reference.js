(() => {
  "use strict";

  const RELEASE = "2026.08.07.1";
  const DEMO_STORE_ID = "00000000-0000-4000-8000-000000000102";

  function isDemoAdmin() {
    return location.pathname.replace(/\/+$/, "").endsWith(`/admin/${DEMO_STORE_ID}`);
  }

  function installDemoNotice() {
    if (!isDemoAdmin() || document.querySelector(".reference-admin-demo")) return;
    const notice = document.createElement("aside");
    notice.className = "reference-admin-demo";
    notice.textContent = "لوحة الإدارة التجريبية — البيانات للمعاينة والعمليات المالية الحقيقية معطّلة";
    const main = document.querySelector(".dashboard-main");
    const header = document.querySelector(".dashboard-header");
    if (main && header) header.insertAdjacentElement("afterend", notice);
  }

  function decorate(selector) {
    document.querySelectorAll(selector).forEach((node, index) => {
      if (node.dataset.adminReferenceDecorated === "true") return;
      node.dataset.adminReferenceDecorated = "true";
      node.style.setProperty("--admin-reference-index", String(Math.min(index, 10)));
      node.classList.add("reference-admin-enter");
    });
  }

  function decorateContent() {
    decorate(".stat-grid > article");
    decorate(".settings-hub > *");
    decorate(".data-list > *");
    decorate(".service-grid > *");
    decorate(".connection-grid > *");
  }

  function normalizeLabels() {
    const storeName = document.querySelector("#adminStoreName");
    if (storeName && isDemoAdmin() && /تحميل|Nova/i.test(storeName.textContent)) {
      storeName.textContent = "UCHIHA STORE — لوحة الإدارة";
    }
    document.querySelectorAll(".dashboard-sidebar .nav-item").forEach((item) => {
      item.setAttribute("title", item.textContent.trim());
    });
  }

  function installObserver() {
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.addedNodes.length)) {
        requestAnimationFrame(() => {
          decorateContent();
          normalizeLabels();
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function install() {
    if (document.documentElement.dataset.adminReference === RELEASE) return;
    document.documentElement.dataset.adminReference = RELEASE;
    document.body.classList.add("reference-admin-ui");
    installDemoNotice();
    normalizeLabels();
    decorateContent();
    installObserver();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
