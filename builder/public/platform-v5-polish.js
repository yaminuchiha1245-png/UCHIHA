(() => {
  "use strict";

  const root = document.documentElement;
  const body = document.body;
  const header = document.getElementById("siteHeader");
  const drawerRoot = document.getElementById("appDrawerRoot");
  const bottomNav = document.getElementById("bottomNav");
  const pageMount = document.getElementById("platformPage");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ICON_STROKE = 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';

  const ICONS = Object.freeze({
    menu: `<svg viewBox="0 0 24 24" aria-hidden="true" ${ICON_STROKE}><path d="M5 7.2h14M5 12h14M5 16.8h14"/></svg>`,
    language: `<svg viewBox="0 0 24 24" aria-hidden="true" ${ICON_STROKE}><circle cx="12" cy="12" r="8.5"/><path d="M3.8 12h16.4M12 3.5c2.1 2.2 3.2 5 3.2 8.5S14.1 18.3 12 20.5M12 3.5c-2.1 2.2-3.2 5-3.2 8.5s1.1 6.3 3.2 8.5"/></svg>`,
    home: `<svg viewBox="0 0 24 24" aria-hidden="true" ${ICON_STROKE}><path d="M3.8 10.8 12 4l8.2 6.8"/><path d="M5.8 9.8v9.3h12.4V9.8M9.2 19.1v-5.6h5.6v5.6"/></svg>`,
    deposit: `<svg viewBox="0 0 24 24" aria-hidden="true" ${ICON_STROKE}><rect x="3.2" y="5.5" width="17.6" height="13" rx="2.4"/><path d="M3.2 9.5h17.6M8.2 14h5.6M11 11.2v5.6"/></svg>`,
    categories: `<svg viewBox="0 0 24 24" aria-hidden="true" ${ICON_STROKE}><rect x="3.4" y="3.4" width="7" height="7" rx="1.7"/><rect x="13.6" y="3.4" width="7" height="7" rx="1.7"/><rect x="3.4" y="13.6" width="7" height="7" rx="1.7"/><rect x="13.6" y="13.6" width="7" height="7" rx="1.7"/></svg>`,
    wallet: `<svg viewBox="0 0 24 24" aria-hidden="true" ${ICON_STROKE}><path d="M4 6.3h14.3a2.2 2.2 0 0 1 2.2 2.2v9.2H5.2A2.7 2.7 0 0 1 2.5 15V6.6A2.6 2.6 0 0 1 5.1 4h11.4"/><path d="M15.7 10.5h4.8v4h-4.8a2 2 0 0 1 0-4Z"/><circle cx="16.4" cy="12.5" r=".4" fill="currentColor" stroke="none"/></svg>`,
    orders: `<svg viewBox="0 0 24 24" aria-hidden="true" ${ICON_STROKE}><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/><path d="m8 5 8 4"/></svg>`,
    user: `<svg viewBox="0 0 24 24" aria-hidden="true" ${ICON_STROKE}><circle cx="12" cy="8" r="3.6"/><path d="M4.7 20.2c.7-4 3.4-6.2 7.3-6.2s6.6 2.2 7.3 6.2"/></svg>`,
    shield: `<svg viewBox="0 0 24 24" aria-hidden="true" ${ICON_STROKE}><path d="M12 3.2 19 6v5.4c0 4.2-2.5 7.5-7 9.4-4.5-1.9-7-5.2-7-9.4V6l7-2.8Z"/><path d="m8.8 12 2.1 2.1 4.4-4.5"/></svg>`,
    api: `<svg viewBox="0 0 24 24" aria-hidden="true" ${ICON_STROKE}><circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="m8 11 7.8-4M8 13l7.8 4"/></svg>`,
    support: `<svg viewBox="0 0 24 24" aria-hidden="true" ${ICON_STROKE}><path d="M4.2 13v-2a7.8 7.8 0 0 1 15.6 0v2"/><path d="M4.2 12.5H2.5v5h3.7v-5h-2ZM19.8 12.5h1.7v5h-3.7v-5h2ZM18 18c-.8 1.8-2.7 2.8-5.7 2.8"/><circle cx="11.4" cy="20.8" r=".7" fill="currentColor" stroke="none"/></svg>`,
    telegram: `<svg viewBox="0 0 24 24" aria-hidden="true" ${ICON_STROKE}><path d="m3.2 11.1 17.1-7-4.2 16-5-4.1-3 2.4.5-4.7 8-6.1-10 5.1-3.4-1.6Z"/></svg>`,
    login: `<svg viewBox="0 0 24 24" aria-hidden="true" ${ICON_STROKE}><path d="M13.5 8.2 17.3 12l-3.8 3.8M17 12H6.2"/><path d="M10 4H4.2v16H10"/></svg>`,
    logout: `<svg viewBox="0 0 24 24" aria-hidden="true" ${ICON_STROKE}><path d="m10.5 8.2-3.8 3.8 3.8 3.8M7 12h10.8"/><path d="M14 4h5.8v16H14"/></svg>`
  });

  const AR_TO_EN = Object.freeze({
    "الرئيسية": "Home",
    "إضافة رصيد": "Add balance",
    "الأقسام": "Categories",
    "طلباتي": "Orders",
    "حسابي": "Account",
    "الدعم": "Support",
    "تسجيل الخروج": "Log out",
    "تسجيل الدخول": "Log in",
    "الأقسام الرئيسية": "Main categories",
    "بوتات تلغرام": "Telegram bots",
    "بوتات المتاجر": "Store bots",
    "بوتات الذكاء الاصطناعي": "AI bots",
    "بوتات الاشتراكات": "Subscription bots",
    "بوتات الإدارة": "Admin bots",
    "بوتات الدعم": "Support bots",
    "المواقع": "Websites",
    "مواقع المتاجر": "Store websites",
    "مواقع الشركات": "Company websites",
    "منصات الخدمات": "Service platforms",
    "تطبيقات الجوال": "Mobile apps",
    "تطبيقات Android": "Android apps",
    "تطبيقات iPhone": "iPhone apps",
    "الذكاء الاصطناعي": "Artificial intelligence",
    "مساعدات الدردشة": "Chat assistants",
    "ذكاء البرمجة": "Coding AI",
    "الصور والصوت": "Images and audio",
    "واجهات API": "API integrations",
    "API المنتجات": "Catalog API",
    "API الطلبات": "Orders API",
    "الربط المخصص": "Custom integrations",
    "الاستضافة والدومينات": "Hosting and domains",
    "استضافة البوتات": "Bot hosting",
    "استضافة المواقع": "Website hosting",
    "الدومينات": "Domains",
    "اختر طريقة الدفع": "Choose a payment method",
    "لا توجد طريقة دفع مفعلة حاليًا": "No payment method is available right now",
    "لا توجد منتجات جاهزة للبيع في هذا القسم حاليًا": "No products are ready for sale in this category yet",
    "لا توجد نتيجة": "No results",
    "السعر": "Price",
    "تسجيل الدخول للشراء": "Log in to buy",
    "الاسم": "Name",
    "البريد الإلكتروني": "Email",
    "رقم الهاتف": "Phone number",
    "المعلومات المطلوبة": "Required information",
    "شراء": "Buy",
    "الشبكة": "Network",
    "اسم المستفيد": "Beneficiary name",
    "بيانات التحويل": "Transfer details",
    "الحد الأدنى": "Minimum",
    "الحد الأعلى": "Maximum",
    "تسجيل الدخول لإضافة الرصيد": "Log in to add balance",
    "المبلغ": "Amount",
    "اسم صاحب التحويل": "Sender name",
    "رقم العملية أو المرجع": "Transaction or reference number",
    "رفع إثبات التحويل": "Upload transfer proof",
    "تقديم الطلب": "Submit request",
    "لا توجد طلبات حتى الآن": "No orders yet",
    "لا توجد قناة دعم مفعلة حاليًا": "No support channel is active right now",
    "إنشاء حساب": "Create account",
    "إنشاء الحساب": "Create account",
    "جارٍ التحميل": "Loading"
  });
  const EN_TO_AR = Object.freeze(Object.fromEntries(Object.entries(AR_TO_EN).map(([ar, en]) => [en, ar])));

  let decorating = false;
  let closingDrawer = false;
  let lastScrollY = window.scrollY;

  function customIcon(name) {
    return ICONS[name] || ICONS.categories;
  }

  function locale() {
    return localStorage.getItem("uchiha-platform-locale") === "en" ? "en" : "ar";
  }

  function translateTextNode(node, targetLocale) {
    if (node.nodeType !== Node.TEXT_NODE) return;
    const value = node.nodeValue || "";
    const trimmed = value.trim();
    if (!trimmed) return;
    const dictionary = targetLocale === "en" ? AR_TO_EN : EN_TO_AR;
    const translated = dictionary[trimmed];
    if (!translated) return;
    node.nodeValue = value.replace(trimmed, translated);
  }

  function translateTree(scope = document) {
    const targetLocale = locale();
    root.lang = targetLocale;
    root.dir = targetLocale === "ar" ? "rtl" : "ltr";
    body.classList.toggle("v5-locale-en", targetLocale === "en");

    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => translateTextNode(node, targetLocale));

    scope.querySelectorAll?.('input[placeholder="ابحث..."]').forEach((input) => {
      input.placeholder = targetLocale === "en" ? "Search..." : "ابحث...";
    });
    scope.querySelectorAll?.('input[placeholder="Search..."]').forEach((input) => {
      if (targetLocale === "ar") input.placeholder = "ابحث...";
    });
  }

  function replaceIcon(container, name) {
    if (!container) return;
    if (container.dataset.uchihaIcon === name && container.querySelector("svg")) return;
    container.innerHTML = customIcon(name);
    container.dataset.uchihaIcon = name;
  }

  function ensureLanguageMenu() {
    let overlay = document.querySelector("[data-language-overlay]");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "v5-language-overlay";
    overlay.dataset.languageOverlay = "";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="v5-language-card" role="dialog" aria-modal="true" aria-label="اللغة">
        <button type="button" data-locale-option="ar"><span>العربية</span><small>AR</small></button>
        <button type="button" data-locale-option="en"><span>English</span><small>EN</small></button>
      </div>`;
    body.append(overlay);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeLanguageMenu();
    });
    overlay.querySelectorAll("[data-locale-option]").forEach((button) => {
      button.addEventListener("click", () => {
        localStorage.setItem("uchiha-platform-locale", button.dataset.localeOption);
        closeLanguageMenu();
        translateTree(document);
        decorateAll();
      });
    });
    return overlay;
  }

  function openLanguageMenu() {
    const overlay = ensureLanguageMenu();
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add("open"));
    overlay.querySelector(`[data-locale-option="${locale()}"]`)?.focus();
  }

  function closeLanguageMenu() {
    const overlay = document.querySelector("[data-language-overlay]");
    if (!overlay || overlay.hidden) return;
    overlay.classList.remove("open");
    window.setTimeout(() => {
      overlay.hidden = true;
    }, reducedMotion.matches ? 0 : 180);
  }

  function decorateHeader() {
    const inner = header?.querySelector(".v5-header-inner");
    if (!inner) return;
    const brand = inner.querySelector(".v5-brand");
    const menu = inner.querySelector("[data-drawer-open]");
    const side = inner.querySelector(".v5-header-side");
    let controls = inner.querySelector(".v5-header-controls");

    if (!controls) {
      controls = document.createElement("div");
      controls.className = "v5-header-controls";
      inner.append(controls);
    }

    if (menu && menu.parentElement !== controls) controls.append(menu);
    let language = controls.querySelector("[data-language-open]");
    if (!language) {
      language = document.createElement("button");
      language.type = "button";
      language.className = "v5-language-button";
      language.dataset.languageOpen = "";
      language.setAttribute("aria-label", "اللغة");
      controls.append(language);
      language.addEventListener("click", openLanguageMenu);
    }

    if (side) {
      [...side.children].forEach((child) => controls.append(child));
      side.remove();
    }

    if (brand && inner.firstElementChild !== brand) inner.prepend(brand);
    replaceIcon(menu, "menu");
    replaceIcon(language, "language");
    controls.querySelectorAll(".v5-header-login svg").forEach((svg) => svg.remove());
    const login = controls.querySelector(".v5-header-login");
    if (login && !login.querySelector("[data-header-login-icon]")) {
      const span = document.createElement("span");
      span.dataset.headerLoginIcon = "";
      span.className = "v5-header-control-icon";
      span.innerHTML = customIcon("user");
      login.prepend(span);
    }
    const wallet = controls.querySelector(".v5-header-wallet");
    if (wallet && !wallet.querySelector("[data-header-wallet-icon]")) {
      const span = document.createElement("span");
      span.dataset.headerWalletIcon = "";
      span.className = "v5-header-control-icon";
      span.innerHTML = customIcon("wallet");
      wallet.prepend(span);
    }
    inner.dataset.polished = "true";
  }

  function toneForHref(href) {
    if (href === "/") return ["home", "green"];
    if (href.startsWith("/add-balance")) return ["deposit", "blue"];
    if (href === "/services" || href.startsWith("/category")) return ["categories", "purple"];
    if (href.startsWith("/orders")) return ["orders", "orange"];
    if (href.startsWith("/account")) return ["user", "gray"];
    if (href.startsWith("/support")) return ["support", "teal"];
    if (href.startsWith("/login")) return ["login", "blue"];
    return ["categories", "gray"];
  }

  function decorateDrawer() {
    const overlay = drawerRoot?.querySelector(".v5-drawer-overlay");
    const drawer = overlay?.querySelector(".v5-drawer");
    if (!overlay || !drawer) return;

    drawer.querySelectorAll(".v5-drawer-link").forEach((link) => {
      const [iconName, tone] = toneForHref(link.getAttribute("href") || "");
      const iconNode = link.querySelector(".v5-icon");
      replaceIcon(iconNode, iconName);
      link.dataset.tone = tone;
    });
    const logout = drawer.querySelector("[data-logout]");
    if (logout) {
      replaceIcon(logout.querySelector(".v5-icon"), "logout");
      logout.dataset.tone = "red";
    }

    const close = drawer.querySelector("[data-drawer-close]");
    if (close && close.textContent.trim() === "×") {
      close.innerHTML = '<span aria-hidden="true">×</span>';
    }

    if (overlay.classList.contains("open") && overlay.dataset.animated !== "true") {
      overlay.dataset.animated = "true";
      overlay.classList.remove("open");
      void overlay.offsetWidth;
      requestAnimationFrame(() => overlay.classList.add("open"));
    }
  }

  function navItem(href, label, iconName, tone) {
    const active = href === "/"
      ? location.pathname === "/"
      : location.pathname === href || location.pathname.startsWith(`${href}/`);
    return `<a href="${href}" class="${active ? "active" : ""}" data-tone="${tone}"${active ? ' aria-current="page"' : ""} aria-label="${label}">${customIcon(iconName)}<span>${label}</span></a>`;
  }

  function decorateBottomNav() {
    if (!bottomNav) return;
    const signature = `${location.pathname}|5`;
    if (bottomNav.dataset.polishSignature === signature && bottomNav.children.length === 5) return;
    bottomNav.innerHTML = [
      navItem("/account", "حسابي", "user", "gray"),
      navItem("/add-balance", "إضافة رصيد", "deposit", "blue"),
      navItem("/", "الرئيسية", "home", "green"),
      navItem("/orders", "طلباتي", "orders", "orange"),
      navItem("/services", "الأقسام", "categories", "purple")
    ].join("");
    bottomNav.dataset.polishSignature = signature;
  }

  function animatePage() {
    if (!pageMount || pageMount.dataset.animatedPath === location.pathname) return;
    pageMount.dataset.animatedPath = location.pathname;
    pageMount.classList.remove("v5-page-enter");
    void pageMount.offsetWidth;
    pageMount.classList.add("v5-page-enter");
    pageMount.querySelectorAll(".v5-category-card, .v5-method-card, .v5-product-card, .v5-order-card, .v5-contact-card").forEach((card, index) => {
      card.style.setProperty("--v5-stagger", `${Math.min(index, 10) * 28}ms`);
      card.classList.add("v5-stagger-item");
    });
  }

  function decorateAll() {
    if (decorating) return;
    decorating = true;
    try {
      decorateHeader();
      decorateDrawer();
      decorateBottomNav();
      translateTree(document);
      animatePage();
    } finally {
      decorating = false;
    }
  }

  function animateDrawerClose(overlay, trigger) {
    if (!overlay || closingDrawer) return;
    closingDrawer = true;
    overlay.classList.remove("open");
    window.setTimeout(() => {
      trigger.dataset.polishBypass = "true";
      trigger.click();
      delete trigger.dataset.polishBypass;
      closingDrawer = false;
    }, reducedMotion.matches ? 0 : 270);
  }

  document.addEventListener("click", (event) => {
    const close = event.target.closest("[data-drawer-close]");
    const overlay = event.target.closest("[data-drawer-overlay]");
    const overlayBackground = overlay && event.target === overlay;
    const trigger = close || (overlayBackground ? overlay : null);
    if (trigger && trigger.dataset.polishBypass !== "true") {
      event.preventDefault();
      event.stopImmediatePropagation();
      animateDrawerClose(overlay || trigger.closest("[data-drawer-overlay]"), trigger);
      return;
    }

    const internalLink = event.target.closest('a[href^="/"]');
    if (!internalLink || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (internalLink.target === "_blank" || internalLink.hasAttribute("download")) return;
    const destination = new URL(internalLink.href, location.href);
    if (destination.pathname === location.pathname && destination.search === location.search && destination.hash === location.hash) return;
    if (reducedMotion.matches) return;
    event.preventDefault();
    pageMount?.classList.add("v5-page-leave");
    window.setTimeout(() => location.assign(destination.href), 135);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeLanguageMenu();
  });

  window.addEventListener("scroll", () => {
    if (!bottomNav || body.classList.contains("v5-drawer-open")) return;
    const current = window.scrollY;
    const difference = current - lastScrollY;
    if (current < 24 || difference < -8) bottomNav.classList.remove("v5-bottom-nav-hidden");
    else if (difference > 10) bottomNav.classList.add("v5-bottom-nav-hidden");
    lastScrollY = current;
  }, { passive: true });

  const observer = new MutationObserver((mutations) => {
    if (decorating) return;
    const relevant = mutations.some((mutation) => mutation.addedNodes.length || mutation.removedNodes.length);
    if (!relevant) return;
    queueMicrotask(decorateAll);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  ensureLanguageMenu();
  decorateAll();
})();
