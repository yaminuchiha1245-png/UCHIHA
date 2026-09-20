(() => {
  "use strict";

  const DESIGN_RELEASE = "2026.08.02.3";
  const page = document.body?.dataset.page || "";
  const one = (selector, root = document) => root.querySelector(selector);
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];

  function node(tag, options = {}, children = []) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.id) element.id = options.id;
    if (options.text !== undefined) element.textContent = options.text;
    if (options.html !== undefined) element.innerHTML = options.html;
    if (options.type) element.type = options.type;
    if (options.href) element.href = options.href;
    if (options.hidden) element.hidden = true;
    if (options.attributes) {
      for (const [name, value] of Object.entries(options.attributes)) element.setAttribute(name, String(value));
    }
    for (const child of children) if (child) element.append(child);
    return element;
  }

  function isEnglish() {
    return document.documentElement.lang?.toLowerCase().startsWith("en");
  }

  function setTrailingLabel(target, label) {
    if (!target) return;
    const textNode = [...target.childNodes].find((item) => item.nodeType === Node.TEXT_NODE && item.textContent.trim());
    if (textNode) textNode.textContent = label;
  }

  function money(value, currency) {
    const amountMinor = Number(value || 0);
    const code = currency || "USD";
    const fraction = (() => {
      try { return new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits; }
      catch { return 2; }
    })();
    try {
      return new Intl.NumberFormat(isEnglish() ? "en" : "ar", { style: "currency", currency: code }).format(amountMinor / (10 ** fraction));
    } catch {
      return `${amountMinor / (10 ** fraction)} ${code}`;
    }
  }

  function buildAuthSheet() {
    let backdrop = one("#fdAuthBackdrop");
    if (backdrop) return backdrop;
    backdrop = node("div", { className: "fd-auth-backdrop", id: "fdAuthBackdrop", hidden: true });
    backdrop.innerHTML = `
      <section class="fd-auth-sheet" role="dialog" aria-modal="true" aria-labelledby="fdAuthTitle">
        <button class="fd-auth-close" type="button" aria-label="إغلاق">×</button>
        <span class="section-kicker">UCHIHA Builder</span>
        <h2 id="fdAuthTitle">ابدأ إنشاء متجرك</h2>
        <p id="fdAuthDescription">حساب واحد لإدارة المتجر والبوتات ولوحة التحكم.</p>
        <div class="fd-auth-tabs" role="tablist">
          <button type="button" role="tab" data-fd-auth-tab="register" class="active" aria-selected="true">إنشاء حساب</button>
          <button type="button" role="tab" data-fd-auth-tab="login" aria-selected="false">تسجيل الدخول</button>
        </div>
        <div id="fdAuthNotice" class="fd-auth-notice" role="alert" hidden></div>
        <form class="fd-auth-form" data-fd-auth-form="register">
          <label>الاسم الكامل<input name="displayName" autocomplete="name" maxlength="120" required></label>
          <label>البريد الإلكتروني<input name="email" type="email" autocomplete="email" required></label>
          <label>كلمة المرور<div class="fd-password-wrap"><input name="password" type="password" autocomplete="new-password" minlength="10" required><button class="fd-password-toggle" type="button" aria-label="إظهار كلمة المرور">إظهار</button></div></label>
          <button type="submit">إنشاء الحساب والمتابعة</button>
        </form>
        <form class="fd-auth-form" data-fd-auth-form="login" hidden>
          <label>البريد الإلكتروني<input name="email" type="email" autocomplete="email" required></label>
          <label>كلمة المرور<div class="fd-password-wrap"><input name="password" type="password" autocomplete="current-password" required><button class="fd-password-toggle" type="button" aria-label="إظهار كلمة المرور">إظهار</button></div></label>
          <button type="submit">الدخول والمتابعة</button>
        </form>
      </section>`;
    document.body.append(backdrop);

    const close = () => {
      backdrop.hidden = true;
      document.body.classList.remove("fd-lock-scroll");
    };
    one(".fd-auth-close", backdrop).addEventListener("click", close);
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !backdrop.hidden) close(); });

    all("[data-fd-auth-tab]", backdrop).forEach((button) => {
      button.addEventListener("click", () => setAuthMode(button.dataset.fdAuthTab));
    });
    all(".fd-password-toggle", backdrop).forEach((button) => {
      button.addEventListener("click", () => {
        const input = one("input", button.parentElement);
        const reveal = input.type === "password";
        input.type = reveal ? "text" : "password";
        button.textContent = reveal ? "إخفاء" : "إظهار";
        button.setAttribute("aria-label", reveal ? "إخفاء كلمة المرور" : "إظهار كلمة المرور");
      });
    });
    all("[data-fd-auth-form]", backdrop).forEach((form) => form.addEventListener("submit", submitAuth));
    return backdrop;
  }

  function setAuthMode(mode) {
    const backdrop = buildAuthSheet();
    all("[data-fd-auth-tab]", backdrop).forEach((button) => {
      const active = button.dataset.fdAuthTab === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    all("[data-fd-auth-form]", backdrop).forEach((form) => { form.hidden = form.dataset.fdAuthForm !== mode; });
    const title = one("#fdAuthTitle", backdrop);
    const description = one("#fdAuthDescription", backdrop);
    title.textContent = mode === "login" ? "تسجيل الدخول" : "ابدأ إنشاء متجرك";
    description.textContent = mode === "login"
      ? "ادخل إلى حسابك وتابع متجرك من مكان واحد."
      : "أنشئ حسابًا واحدًا للمتجر والبوتات ولوحة التحكم.";
    const notice = one("#fdAuthNotice", backdrop);
    notice.hidden = true;
    const target = one(`[data-fd-auth-form="${mode}"] input`, backdrop);
    window.setTimeout(() => target?.focus(), 40);
  }

  async function openAuth(mode) {
    const backdrop = buildAuthSheet();
    setAuthMode(mode);
    backdrop.hidden = false;
    document.body.classList.add("fd-lock-scroll");
    try {
      const response = await fetch("/api/me", { credentials: "same-origin", headers: { accept: "application/json" } });
      if (response.ok) location.assign("/create-store?source=home");
    } catch {
      // The form remains usable if the session probe is unavailable.
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const mode = form.dataset.fdAuthForm;
    const submit = one('button[type="submit"]', form);
    const notice = one("#fdAuthNotice");
    if (submit.disabled) return;
    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = mode === "login" ? "جارٍ تسجيل الدخول..." : "جارٍ إنشاء الحساب...";
    notice.hidden = true;
    try {
      const body = Object.fromEntries(new FormData(form).entries());
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "تعذر إكمال العملية. تحقق من البيانات وحاول مجددًا.");
      if (result.csrfToken) sessionStorage.setItem("uchihaBuilderCsrf", result.csrfToken);
      location.assign("/create-store?source=home");
    } catch (error) {
      notice.textContent = error.message || "تعذر إكمال العملية.";
      notice.hidden = false;
      submit.disabled = false;
      submit.textContent = original;
    }
  }

  function homeFeatures(languageEnglish) {
    const features = languageEnglish
      ? [
          ["01", "Store website", "A fast storefront connected to the same products, customers and orders."],
          ["02", "Store bot", "A Telegram sales channel that uses the same catalog and customer account."],
          ["03", "Admin bot", "Essential order and payment actions without opening a complex panel."],
          ["04", "Control panel", "Products, categories, payments and design in one clear workspace."],
          ["05", "Android", "A mobile-ready experience with safe areas and touch-friendly controls."],
          ["06", "iOS later", "The same shared backend is ready for an iOS client when activated."]
        ]
      : [
          ["01", "موقع متجر", "واجهة سريعة مرتبطة بنفس المنتجات والعملاء والطلبات."],
          ["02", "بوت متجر", "قناة بيع عبر تيليجرام تستخدم نفس الكتالوج وحساب العميل."],
          ["03", "بوت إدارة", "إدارة الطلبات والمدفوعات الأساسية دون لوحة معقدة."],
          ["04", "لوحة تحكم", "المنتجات والأقسام والمدفوعات والتصميم في مساحة واحدة."],
          ["05", "Android", "تجربة مهيأة للهاتف ومساحات اللمس والـSafe Area."],
          ["06", "iOS مستقبلًا", "نفس الخادم وقاعدة البيانات جاهزان لتطبيق iOS عند تفعيله."]
        ];
    const section = node("section", { className: "marketing-section fd-platform-features", id: "fdPlatformFeatures" });
    section.innerHTML = `
      <div class="marketing-container">
        <div class="section-heading">
          <span class="section-kicker">${languageEnglish ? "One connected platform" : "منصة واحدة مترابطة"}</span>
          <h2>${languageEnglish ? "Choose only what your project needs" : "اختر ما يحتاجه مشروعك فقط"}</h2>
          <p>${languageEnglish ? "Every channel reads from the same backend instead of creating duplicated systems." : "كل قناة تعمل على نفس قاعدة البيانات بدل إنشاء أنظمة منفصلة ومكررة."}</p>
        </div>
        <ul class="fd-feature-list">${features.map(([number, title, description]) => `<li><span>${number}</span><b>${title}</b><p>${description}</p></li>`).join("")}</ul>
      </div>`;
    return section;
  }

  function pricingFaq(languageEnglish) {
    const section = node("section", { className: "marketing-section soft-section", id: "fdPricingFaq" });
    const faqs = languageEnglish
      ? [
          ["Do I need programming experience?", "No. The creation flow and owner panel are designed for non-technical store owners."],
          ["Can I add bots later?", "Yes. Store and admin bots can be connected when your project needs them."],
          ["Is the demo store real?", "It reads from PostgreSQL, while real orders and payments are blocked for safety."],
          ["Can I change the design?", "Yes. The template, colors, logo, banner and store content remain editable."]
        ]
      : [
          ["هل أحتاج خبرة برمجية؟", "لا. معالج الإنشاء ولوحة صاحب المتجر مصممان للمستخدم غير التقني."],
          ["هل يمكن إضافة البوتات لاحقًا؟", "نعم. تستطيع ربط بوت المتجر وبوت الإدارة عندما يحتاجهما مشروعك."],
          ["هل المتجر التجريبي حقيقي؟", "يعرض بيانات PostgreSQL حقيقية، مع تعطيل الطلبات والمدفوعات الفعلية للحماية."],
          ["هل أستطيع تغيير التصميم؟", "نعم. القالب والألوان والشعار والبانر ومحتوى المتجر قابلة للتعديل."]
        ];
    section.innerHTML = `
      <div class="marketing-container fd-pricing-layout">
        <article class="fd-price-card">
          <span class="section-kicker">${languageEnglish ? "Subscription" : "الاشتراك"}</span>
          <h3 id="fdOfferName">UCHIHA Full</h3>
          <strong id="fdOfferPrice" class="fd-price-value">${languageEnglish ? "Configured by platform admin" : "يُحدد من لوحة المنصة"}</strong>
          <small>${languageEnglish ? "One subscription for one store" : "اشتراك واحد لمتجر واحد"}</small>
          <ul>
            <li>${languageEnglish ? "Store website and owner dashboard" : "موقع المتجر ولوحة الإدارة"}</li>
            <li>${languageEnglish ? "Products, categories, payments and support" : "المنتجات والأقسام والمدفوعات والدعم"}</li>
            <li>${languageEnglish ? "Optional bots and mobile apps" : "إمكانية إضافة البوتات والتطبيقات"}</li>
          </ul>
          <a class="primary-button" href="/create-store">${languageEnglish ? "Start creating your store" : "ابدأ إنشاء متجرك"}</a>
        </article>
        <div>
          <div class="section-heading"><span class="section-kicker">FAQ</span><h2>${languageEnglish ? "Clear answers before you start" : "إجابات واضحة قبل أن تبدأ"}</h2></div>
          <div class="fd-faq">${faqs.map(([question, answer]) => `<details><summary>${question}</summary><p>${answer}</p></details>`).join("")}</div>
        </div>
      </div>`;
    return section;
  }

  async function loadOffer() {
    try {
      const response = await fetch("/api/subscription-offer", { headers: { accept: "application/json" } });
      if (!response.ok) return;
      const data = await response.json();
      if (!data.offer) return;
      const name = one("#fdOfferName");
      const price = one("#fdOfferPrice");
      if (name) name.textContent = data.offer.name || "UCHIHA Full";
      if (price) price.textContent = money(data.offer.priceMinor, data.offer.currency);
    } catch {
      // The UI intentionally keeps a non-fictional fallback when pricing is unavailable.
    }
  }

  function renderHomeEnhancements() {
    if (!document.body.classList.contains("fd-home")) return;
    one("#fdPlatformFeatures")?.remove();
    one("#fdPricingFaq")?.remove();
    const services = one("#services");
    const how = one("#how");
    const contact = one("#contact");
    const cta = one(".marketing-cta");
    const featureSection = homeFeatures(isEnglish());
    const pricingSection = pricingFaq(isEnglish());
    if (how) how.before(featureSection);
    else services?.after(featureSection);
    if (contact) contact.before(pricingSection);
    else cta?.before(pricingSection);
    loadOffer();
  }

  function installHome() {
    document.body.classList.add("fd-home");
    ["#showcase", "#payments", ".api-highlight"].forEach((selector) => one(selector)?.classList.add("fd-home-hidden"));
    const servicesGrid = one("#servicesGrid");
    if (servicesGrid) servicesGrid.dataset.limit = "6";
    const heroActions = one(".marketing-hero .hero-actions");
    if (heroActions) {
      const buttons = all("a", heroActions);
      if (buttons[0]) buttons[0].textContent = isEnglish() ? "Start creating your store" : "ابدأ إنشاء متجرك";
      if (buttons[1]) {
        buttons[1].href = "/store/demo";
        buttons[1].textContent = isEnglish() ? "View demo store" : "شاهد متجرًا تجريبيًا";
      }
    }
    const finalCtaLinks = all(".marketing-cta a");
    if (finalCtaLinks[1]) {
      finalCtaLinks[1].href = "/store/demo";
      finalCtaLinks[1].textContent = isEnglish() ? "View demo" : "شاهد المتجر التجريبي";
    }
    renderHomeEnhancements();

    document.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target.closest("a[href]");
      if (!anchor || anchor.target === "_blank") return;
      let url;
      try { url = new URL(anchor.href, location.origin); } catch { return; }
      if (url.origin !== location.origin) return;
      if (url.pathname === "/login") {
        event.preventDefault();
        openAuth("login");
      } else if (url.pathname === "/create-store") {
        event.preventDefault();
        openAuth("register");
      }
    }, true);

    new MutationObserver(() => renderHomeEnhancements()).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }

  function installBuilder() {
    document.body.classList.add("fd-builder");
    if (location.pathname === "/login") {
      window.setTimeout(() => one('[data-auth-tab="login"]')?.click(), 0);
    }
  }

  function installOwner() {
    document.body.classList.add("fd-owner");
    setTrailingLabel(one('[data-panel="overview"]'), "الرئيسية");
    setTrailingLabel(one('[data-panel="catalog"]'), "المنتجات والأقسام");
    setTrailingLabel(one('[data-panel="settings"]'), "الإعدادات");

    const quick = one(".admin-quick-actions");
    if (quick && !one(".fd-quick-more", quick)) {
      const extras = [...quick.children].slice(2);
      if (extras.length) {
        const details = node("details", { className: "fd-quick-more" });
        const summary = node("summary", { text: "المزيد من الإجراءات" });
        const content = node("div");
        extras.forEach((item) => content.append(item));
        details.append(summary, content);
        quick.append(details);
      }
    }

    const settingsPanel = one('[data-panel-view="settings"]');
    if (settingsPanel && !one(".fd-advanced-settings", settingsPanel)) {
      const advanced = node("details", { className: "fd-advanced-settings" });
      const summary = node("summary", { text: "الإعدادات المتقدمة" });
      const content = node("div");
      const hub = one(".settings-hub", settingsPanel);
      if (hub) {
        [...hub.children].filter((item) => /(API|تحليل|المطور|الحماية|Logs|Webhooks|Integrations)/i.test(item.textContent)).forEach((item) => content.append(item));
      }
      const currencies = one(".currency-settings", settingsPanel);
      if (currencies) content.append(currencies);
      advanced.append(summary, content);
      settingsPanel.append(advanced);
    }
  }

  const platformGroups = [
    ["الأساسيات", ["dashboard", "stores", "users", "subscriptions", "payments"]],
    ["التشغيل", ["services", "serviceRequests", "products", "orders"]],
    ["المزودون", ["api", "providers"]],
    ["المحتوى", ["contacts", "banners", "templates", "identity"]],
    ["النظام", ["settings", "logs", "backups", "system"]]
  ];

  function groupPlatformNav() {
    const nav = one("#platformNav");
    if (!nav) return;
    const directButtons = [...nav.children].filter((item) => item.matches("button,[data-section]"));
    if (!directButtons.length) return;
    const bySection = new Map(directButtons.map((button) => [button.dataset.section || button.dataset.nav || "", button]));
    const fragment = document.createDocumentFragment();
    for (const [label, keys] of platformGroups) {
      const group = node("div", { className: "fd-nav-group" });
      group.append(node("strong", { text: label }));
      let count = 0;
      keys.forEach((key) => {
        const button = bySection.get(key);
        if (button) { group.append(button); bySection.delete(key); count += 1; }
      });
      if (count) fragment.append(group);
    }
    if (bySection.size) {
      const group = node("div", { className: "fd-nav-group" });
      group.append(node("strong", { text: "أخرى" }));
      bySection.forEach((button) => group.append(button));
      fragment.append(group);
    }
    nav.replaceChildren(fragment);
  }

  function installPlatform() {
    document.body.classList.add("fd-platform");
    const nav = one("#platformNav");
    if (!nav) return;
    const observer = new MutationObserver(() => groupPlatformNav());
    observer.observe(nav, { childList: true });
    groupPlatformNav();
  }

  function installStore() {
    document.body.classList.add("fd-store");
    const isDemo = location.pathname.replace(/\/$/, "") === "/store/demo" || location.hostname.startsWith("demo.");
    if (!isDemo || one(".fd-demo-banner")) return;
    const app = one("#storeApp");
    if (!app) return;
    const banner = node("div", {
      className: "fd-demo-banner",
      text: isEnglish()
        ? "Demo store for browsing only — real orders and payments are disabled"
        : "متجر تجريبي للعرض فقط — الطلبات والمدفوعات الحقيقية معطلة",
      attributes: { role: "status" }
    });
    app.prepend(banner);
  }

  function installAccountLikePages() {
    if (document.body.classList.contains("marketing-page")) return;
    if (/account|payments|support/.test(page)) document.body.classList.add("fd-account");
  }

  function boot() {
    document.body.classList.add("fd-ready");
    document.documentElement.dataset.finalDesignRelease = DESIGN_RELEASE;
    if (document.body.classList.contains("marketing-page") && page === "home") installHome();
    if (page === "builder") installBuilder();
    if (page === "admin") installOwner();
    if (document.body.classList.contains("platform-admin-page")) installPlatform();
    if (page === "store") installStore();
    installAccountLikePages();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
