(() => {
  "use strict";

  const RELEASE = "2026.08.07.1";
  const DEMO_STORE_ID = "00000000-0000-4000-8000-000000000102";
  const isDemo = /^\/store\/demo\/?$/.test(location.pathname) || location.hostname.toLowerCase().startsWith("demo.");

  function installDemoBar() {
    if (!isDemo || document.querySelector(".reference-demo-bar")) return;
    document.body.dataset.demoStore = "true";

    const bar = document.createElement("aside");
    bar.className = "reference-demo-bar";
    bar.setAttribute("role", "status");
    bar.innerHTML = `
      <span class="reference-demo-bar__dot" aria-hidden="true"></span>
      <span>نسخة تجريبية للمعاينة فقط — الطلبات والمدفوعات الحقيقية معطّلة</span>
      <span class="reference-demo-bar__actions">
        <a data-reference-user-login href="/account?store=demo">دخول المستخدم</a>
        <a href="/admin/${DEMO_STORE_ID}">دخول الأدمن</a>
      </span>`;

    const app = document.querySelector("#storeApp");
    if (app) app.prepend(bar);
    else document.body.prepend(bar);

    const profileLink = document.querySelector("#storeProfileLink");
    const userLink = bar.querySelector("[data-reference-user-login]");
    const syncUserLink = () => {
      const href = profileLink?.getAttribute("href");
      if (href && href !== "#") userLink.href = href;
    };
    syncUserLink();
    if (profileLink) new MutationObserver(syncUserLink).observe(profileLink, { attributes: true, attributeFilter: ["href"] });
  }

  function normalizeLoader() {
    const loaderImage = document.querySelector(".store-loader-orbit img");
    if (loaderImage) loaderImage.src = "/assets/brand/uchiha-mark.svg";
  }

  function removeLegacyDevelopmentCard(root = document) {
    root.querySelectorAll?.(".demo-development-card,.demo-development-dialog").forEach((node) => node.remove());
  }

  function decorate(selector) {
    document.querySelectorAll(selector).forEach((node, index) => {
      if (node.dataset.referenceDecorated === "true") return;
      node.dataset.referenceDecorated = "true";
      node.style.setProperty("--reference-index", String(Math.min(index, 10)));
      node.classList.add("reference-enter");
    });
  }

  function decorateDynamicContent() {
    decorate("#storeCategories .store-category-card");
    decorate("#storeSubcategories > *");
    decorate("#storeProducts .store-product-card");
  }

  function ensureProfessionalCopy() {
    const tagline = document.querySelector("#storeTagline");
    if (tagline && (!tagline.textContent.trim() || tagline.textContent.includes("تجربة"))) {
      tagline.textContent = "متجر رقمي موثوق وسريع";
    }
    const loading = document.querySelector("#storeLoading");
    if (loading) loading.dataset.referenceRelease = RELEASE;
  }

  function installObservers() {
    const observer = new MutationObserver((records) => {
      let needsDecoration = false;
      for (const record of records) {
        if (record.addedNodes.length) needsDecoration = true;
        record.addedNodes.forEach((node) => {
          if (node.nodeType === 1) removeLegacyDevelopmentCard(node);
        });
      }
      if (needsDecoration) requestAnimationFrame(decorateDynamicContent);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function install() {
    if (document.documentElement.dataset.storeReference === RELEASE) return;
    document.documentElement.dataset.storeReference = RELEASE;
    document.body.classList.add("reference-store-ui");
    normalizeLoader();
    ensureProfessionalCopy();
    removeLegacyDevelopmentCard();
    installDemoBar();
    decorateDynamicContent();
    installObservers();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
