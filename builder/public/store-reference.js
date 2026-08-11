(() => {
  "use strict";

  const RELEASE = "2026.08.11.1";
  const DEMO_STORE_ID = "00000000-0000-4000-8000-000000000102";
  const WELCOME_KEY = "uchiha-demo-welcome-dismissed";
  const isDemo = /^\/store\/demo\/?$/.test(location.pathname) || location.hostname.toLowerCase().startsWith("demo.");

  function syncAccountLink(link) {
    const profileLink = document.querySelector("#storeProfileLink");
    const sync = () => {
      const href = profileLink?.getAttribute("href");
      if (href && href !== "#") link.href = href;
    };
    sync();
    if (profileLink) {
      new MutationObserver(sync).observe(profileLink, {
        attributes: true,
        attributeFilter: ["href"]
      });
    }
  }

  function installDemoBar() {
    if (!isDemo || document.querySelector(".reference-demo-bar")) return;
    document.body.dataset.demoStore = "true";

    const bar = document.createElement("aside");
    bar.className = "reference-demo-bar";
    bar.setAttribute("role", "status");
    bar.innerHTML = `
      <span class="reference-demo-bar__dot" aria-hidden="true"></span>
      <span>متجر تجريبي للعرض فقط — الطلبات والمدفوعات الحقيقية معطّلة</span>
      <span class="reference-demo-bar__actions">
        <a data-reference-user-login href="/store/demo/account">دخول المستخدم</a>
        <span class="reference-demo-bar__admin-mode">الإدارة حاليًا عبر بوت Telegram</span>
      </span>`;

    const app = document.querySelector("#storeApp");
    if (app) app.prepend(bar);
    else document.body.prepend(bar);

    const userLink = bar.querySelector("[data-reference-user-login]");
    if (userLink) syncAccountLink(userLink);
  }

  function installDemoLogin() {
    if (!isDemo || document.querySelector(".reference-login-overlay")) return;

    try {
      if (sessionStorage.getItem(WELCOME_KEY) === "1") return;
    } catch {
      // Session storage is optional; the welcome remains functional without it.
    }

    const overlay = document.createElement("div");
    overlay.className = "reference-login-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "referenceDemoLoginTitle");
    overlay.innerHTML = `
      <section class="reference-login-card">
        <div class="reference-login-mark"><img src="/assets/brand/uchiha-mark.svg" alt=""></div>
        <h2 id="referenceDemoLoginTitle">تسجيل الدخول</h2>
        <p>سجّل الدخول بحساب المستخدم التجريبي أو تابع كزائر لمعاينة أقسام وواجهات UCHIHA STORE.</p>
        <div class="reference-login-actions">
          <a data-reference-modal-login href="/store/demo/account">دخول المستخدم التجريبي</a>
          <button data-reference-modal-close type="button">متابعة كزائر</button>
        </div>
        <small class="reference-login-note">هذه نسخة عرض فقط؛ المدفوعات والطلبات والتنفيذ الحقيقي معطّلة.</small>
      </section>`;

    const dismiss = () => {
      overlay.hidden = true;
      try {
        sessionStorage.setItem(WELCOME_KEY, "1");
      } catch {
        // The dialog still closes when storage is unavailable.
      }
    };

    overlay.querySelector("[data-reference-modal-close]")?.addEventListener("click", dismiss);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) dismiss();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !overlay.hidden) dismiss();
    });

    const loginLink = overlay.querySelector("[data-reference-modal-login]");
    if (loginLink) syncAccountLink(loginLink);
    document.body.append(overlay);
    overlay.querySelector("[data-reference-modal-close]")?.focus();
  }

  function normalizeLoader() {
    if (!isDemo) return;
    const loaderImage = document.querySelector(".store-loader-orbit img");
    if (loaderImage) loaderImage.src = "/assets/demo-assets/uchiha-transparent-mark.svg";
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
    if (!isDemo) return;
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
    if (isDemo) document.body.dataset.demoStore = "true";
    normalizeLoader();
    ensureProfessionalCopy();
    removeLegacyDevelopmentCard();
    installDemoBar();
    installDemoLogin();
    decorateDynamicContent();
    installObservers();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
