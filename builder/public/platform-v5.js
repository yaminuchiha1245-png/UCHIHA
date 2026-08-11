(() => {
  "use strict";

  const body = document.body;
  const pageMount = document.getElementById("platformPage");
  const headerMount = document.getElementById("siteHeader");
  const footerMount = document.getElementById("siteFooter");
  const drawerRoot = document.getElementById("appDrawerRoot");
  const bottomNav = document.getElementById("bottomNav");
  const contactStrip = document.getElementById("contactStrip");
  const toast = document.getElementById("v5Toast");

  const PATH_ALIASES = Object.freeze({
    "/index.html": "/",
    "/services.html": "/services",
    "/support.html": "/support",
    "/contact": "/support",
    "/contact.html": "/support",
    "/login.html": "/login",
    "/register.html": "/register",
    "/payment-methods": "/add-balance",
    "/payment-methods.html": "/add-balance",
    "/api-services": "/category/api-integrations",
    "/api-services.html": "/category/api-integrations"
  });

  const rawPath = location.pathname.replace(/\/+$/, "") || "/";
  const path = PATH_ALIASES[rawPath] || rawPath;
  if (path !== rawPath) history.replaceState(null, "", `${path}${location.search}${location.hash}`);

  const HOME_SLIDES = Object.freeze([
    {
      href: "/create-store",
      image: "/assets/marketing-assets/showcase-store.svg",
      kicker: "UCHIHA Builder",
      title: "متجرك وموقعك وبوتاتك من مكان واحد",
      description: "أنشئ مشروعك بهوية مستقلة وإدارة مترابطة."
    },
    {
      href: "/category/telegram-bots",
      image: "/assets/marketing-assets/slide-commerce.svg",
      kicker: "بوتات جاهزة ومخصصة",
      title: "بيع وإدارة وخدمة عملاء عبر Telegram",
      description: "بوت بيع وبوت إدارة مرتبطان بنفس بيانات مشروعك."
    },
    {
      href: "/category/mobile-apps",
      image: "/assets/marketing-assets/slide-apps.svg",
      kicker: "تطبيقات الجوال",
      title: "تطبيق واحد مرتبط بحسابك ومنصتك",
      description: "Android وiPhone مع واجهات سريعة وقابلة للتوسع."
    },
    {
      href: "/category/hosting-domains",
      image: "/assets/marketing-assets/slide-infrastructure.svg",
      kicker: "الاستضافة والدومينات",
      title: "كل ما يحتاجه مشروعك ليعمل بثبات",
      description: "استضافة للبوتات والمواقع وربط الدومينات وواجهات API."
    }
  ]);

  const CATEGORY_TREE = Object.freeze([
    {
      slug: "telegram-bots",
      name: "بوتات تلغرام",
      image: "/assets/catalog-assets/social-service.svg",
      tone: "red",
      children: [
        { slug: "store-bots", name: "بوتات المتاجر" },
        { slug: "ai-bots", name: "بوتات الذكاء الاصطناعي" },
        { slug: "subscription-bots", name: "بوتات الاشتراكات" },
        { slug: "admin-bots", name: "بوتات الإدارة" },
        { slug: "support-bots", name: "بوتات الدعم" }
      ]
    },
    {
      slug: "mobile-apps",
      name: "تطبيقات الجوال",
      image: "/assets/marketing-assets/slide-apps.svg",
      tone: "green",
      children: [
        { slug: "android-apps", name: "تطبيقات Android" },
        { slug: "ios-apps", name: "تطبيقات iPhone" }
      ]
    },
    {
      slug: "websites",
      name: "المواقع",
      image: "/assets/catalog-assets/programming.svg",
      tone: "blue",
      children: [
        { slug: "store-websites", name: "مواقع المتاجر" },
        { slug: "company-websites", name: "مواقع الشركات" },
        { slug: "service-platforms", name: "منصات الخدمات" }
      ]
    },
    {
      slug: "online-stores",
      name: "المتاجر الإلكترونية",
      image: "/assets/marketing-assets/showcase-store.svg",
      tone: "orange",
      href: "/create-store",
      children: [
        { slug: "website-store", name: "متجر بموقع" },
        { slug: "telegram-store", name: "متجر Telegram" },
        { slug: "full-store", name: "موقع وبوتات إدارة وبيع" }
      ]
    },
    {
      slug: "artificial-intelligence",
      name: "الذكاء الاصطناعي",
      image: "/assets/catalog-assets/ai-chatbot.svg",
      tone: "purple",
      children: [
        { slug: "chat-ai", name: "مساعدات الدردشة" },
        { slug: "coding-ai", name: "ذكاء البرمجة" },
        { slug: "media-ai", name: "الصور والصوت" }
      ]
    },
    {
      slug: "api-integrations",
      name: "واجهات API",
      image: "/assets/catalog-assets/software.svg",
      tone: "teal",
      featured: false,
      children: [
        { slug: "catalog-api", name: "API المنتجات" },
        { slug: "orders-api", name: "API الطلبات" },
        { slug: "custom-integrations", name: "الربط المخصص" }
      ]
    },
    {
      slug: "hosting-domains",
      name: "الاستضافة والدومينات",
      image: "/assets/marketing-assets/slide-infrastructure.svg",
      tone: "navy",
      children: [
        { slug: "bot-hosting", name: "استضافة البوتات" },
        { slug: "website-hosting", name: "استضافة المواقع" },
        { slug: "domains", name: "الدومينات" }
      ]
    }
  ]);

  const state = {
    me: null,
    user: null,
    account: null,
    csrfToken: "",
    portal: null,
    products: [],
    paymentMethods: [],
    contacts: [],
    orders: [],
    drawerOpen: false,
    loading: false
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase("ar");
  }

  function internalPath(value, fallback = "/") {
    const candidate = String(value || "");
    return candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("..")
      ? candidate
      : fallback;
  }

  function icon(name) {
    const icons = {
      menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>',
      home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8"></path><path d="M5 10v10h14V10M9 20v-6h6v6"></path></svg>',
      grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>',
      wallet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h15a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13"></path><path d="M16 11h5v4h-5a2 2 0 0 1 0-4Z"></path></svg>',
      orders: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18H6z"></path><path d="M9 7h6M9 11h6M9 15h4"></path></svg>',
      user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg>',
      support: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13v-2a8 8 0 0 1 16 0v2"></path><path d="M4 13H2v5h4v-5H4ZM20 13h2v5h-4v-5h2ZM18 18c0 2-2 3-5 3"></path></svg>',
      login: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8l4 4-4 4M18 12H6"></path><path d="M10 4H4v16h6"></path></svg>',
      logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 8 6 12l4 4M6 12h12"></path><path d="M14 4h6v16h-6"></path></svg>',
      back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>',
      search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>',
      upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M8 8l4-4 4 4"></path><path d="M4 15v5h16v-5"></path></svg>',
      copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path></svg>',
      bot: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="16" height="12" rx="3"></rect><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8"></path></svg>',
      app: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"></rect><path d="M10 5h4M11 19h2"></path></svg>',
      web: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 8h18M7 6h.01M10 6h.01"></path></svg>',
      store: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v10h16V10M3 10l2-6h14l2 6"></path><path d="M3 10a3 3 0 0 0 5 2 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 5-2M9 20v-5h6v5"></path></svg>',
      cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h11a4 4 0 0 0 .5-8A6 6 0 0 0 7 8.5 4.5 4.5 0 0 0 7 18Z"></path></svg>',
      spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"></path><path d="m18.5 16 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z"></path></svg>'
    };
    return icons[name] || icons.grid;
  }

  function categoryBySlug(slug) {
    return CATEGORY_TREE.find((item) => item.slug === slug) || null;
  }

  function childBySlug(category, slug) {
    return category?.children.find((item) => item.slug === slug) || null;
  }

  function categoryHref(category, child = null) {
    if (!child && category?.href) return category.href;
    return child
      ? `/category/${encodeURIComponent(category.slug)}/${encodeURIComponent(child.slug)}`
      : `/category/${encodeURIComponent(category.slug)}`;
  }

  function money(minor, currency = "USD") {
    if (minor === null || minor === undefined || minor === "") return "يحدد لاحقًا";
    let digits = 2;
    try {
      digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
      return new Intl.NumberFormat("ar", {
        style: "currency",
        currency,
        maximumFractionDigits: digits
      }).format(Number(minor) / (10 ** digits));
    } catch {
      return `${Number(minor) / 100} ${currency}`;
    }
  }

  function amountToMinor(value, currency = "USD") {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    let digits = 2;
    try {
      digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    } catch {
      digits = 2;
    }
    return Math.round(amount * (10 ** digits));
  }

  function dateLabel(value) {
    try {
      return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
    } catch {
      return "—";
    }
  }

  async function requestJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...(options.headers || {})
        },
        body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.message || "تعذر إكمال العملية");
        error.status = response.status;
        error.code = payload.error;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error.name === "AbortError") {
        const timeoutError = new Error("استغرق الاتصال وقتًا طويلًا. أعد المحاولة.");
        timeoutError.code = "request_timeout";
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function showToast(message, error = false) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("error", error);
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.hidden = true;
    }, 4200);
  }

  function safeNext() {
    return internalPath(new URLSearchParams(location.search).get("next"), "/account");
  }

  function statusLabel(status) {
    const labels = {
      pending_review: "قيد المراجعة",
      approved: "مكتمل",
      rejected: "مرفوض",
      cancelled: "ملغى",
      new: "جديد",
      contacted: "تم التواصل",
      quoted: "تم التسعير",
      in_progress: "قيد التنفيذ",
      completed: "مكتمل"
    };
    return labels[status] || status || "قيد المراجعة";
  }

  function contactHref(contact) {
    const target = String(contact.target || "");
    if (contact.type === "whatsapp") {
      const digits = target.replace(/\D/g, "");
      const message = contact.messageTemplate?.ar || "";
      return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
    }
    if (contact.type === "telegram") {
      if (target.startsWith("@")) return `https://t.me/${target.slice(1)}`;
      return target;
    }
    if (contact.type === "email") return `mailto:${target}`;
    if (contact.type === "phone") return `tel:${target}`;
    return target.startsWith("https://") ? target : "#";
  }

  function catalogProducts(portal) {
    return (portal?.services || [])
      .filter((service) => {
        const catalog = service.catalog || {};
        return service.status === "active" && (catalog.isProduct === true || service.isCatalogProduct === true);
      })
      .map((service) => {
        const catalog = service.catalog || {};
        return {
          id: service.id,
          slug: service.slug,
          name: service.name?.ar || service.name?.en || "منتج",
          description: service.description?.ar || service.description?.en || "",
          features: service.features?.ar || [],
          priceMinor: service.startingPriceMinor,
          currency: service.currency || "USD",
          category: catalog.categorySlug || service.catalogCategorySlug,
          subcategory: catalog.subcategorySlug || service.catalogSubcategorySlug,
          imageUrl: catalog.imageUrl || service.productImageUrl || null
        };
      })
      .filter((product) => {
        const category = categoryBySlug(product.category);
        return Boolean(category && childBySlug(category, product.subcategory));
      });
  }

  function availablePaymentMethods(portal) {
    return (portal?.paymentMethods || []).filter(
      (method) => method.status === "active" && method.configured === true
    );
  }

  function activeContacts(portal) {
    return (portal?.contacts || []).filter((contact) => contact.status === "active");
  }

  function isActive(target) {
    if (target === "/") return path === "/";
    if (target === "/services") return path === "/services" || path.startsWith("/category/") || path.startsWith("/product/");
    if (target === "/add-balance") return path.startsWith("/add-balance");
    return path.startsWith(target);
  }

  function headerHtml() {
    const wallet = state.account?.wallet;
    const walletText = wallet ? money(wallet.availableMinor, wallet.currency) : "";
    return `
      <div class="v5-shell v5-header-inner">
        <button class="v5-menu-button" type="button" data-drawer-open aria-label="فتح القائمة" aria-expanded="${state.drawerOpen}">${icon("menu")}</button>
        <a class="v5-brand" href="/" aria-label="UCHIHA Builder"><img src="/assets/brand/platform-mark.svg" alt=""><b>UCHIHA <span>Builder</span></b></a>
        <div class="v5-header-side">
          ${state.user
            ? `<a class="v5-header-wallet" href="/account#wallet" aria-label="الرصيد"><span>${escapeHtml(walletText)}</span></a>`
            : `<a class="v5-header-login" href="/login" aria-label="تسجيل الدخول">${icon("user")}<span>دخول</span></a>`}
        </div>
      </div>`;
  }

  function drawerLink(href, label, iconName) {
    return `<a class="v5-drawer-link${isActive(href) ? " active" : ""}" href="${href}"><span class="v5-icon">${icon(iconName)}</span><span>${label}</span></a>`;
  }

  function drawerHtml() {
    return `
      <div class="v5-drawer-overlay${state.drawerOpen ? " open" : ""}" data-drawer-overlay>
        <aside class="v5-drawer" aria-label="القائمة الجانبية" aria-hidden="${!state.drawerOpen}">
          <div class="v5-drawer-head">
            <div class="v5-drawer-brand"><img src="/assets/brand/platform-mark.svg" alt=""><b>UCHIHA Builder</b></div>
            <button class="v5-drawer-close" type="button" data-drawer-close aria-label="إغلاق القائمة">×</button>
          </div>
          <nav class="v5-drawer-nav">
            <span class="v5-drawer-label">المنصة</span>
            ${drawerLink("/", "الرئيسية", "home")}
            ${drawerLink("/create-store", "إنشاء متجر", "store")}
            ${drawerLink("/services", "الأقسام", "grid")}
            <span class="v5-drawer-label">الخدمات</span>
            ${drawerLink("/category/telegram-bots", "بوتات تلغرام", "bot")}
            ${drawerLink("/category/mobile-apps", "تطبيقات الجوال", "app")}
            ${drawerLink("/category/websites", "المواقع", "web")}
            ${drawerLink("/category/artificial-intelligence", "الذكاء الاصطناعي", "spark")}
            ${drawerLink("/category/hosting-domains", "الاستضافة والدومينات", "cloud")}
            ${drawerLink("/category/api-integrations", "واجهات API", "grid")}
            <span class="v5-drawer-label">حسابي</span>
            ${drawerLink("/add-balance", "إضافة رصيد", "wallet")}
            ${drawerLink("/orders", "طلباتي", "orders")}
            ${drawerLink("/account", "حسابي", "user")}
            ${drawerLink("/support", "الدعم", "support")}
          </nav>
          <div class="v5-drawer-foot">
            ${state.user
              ? `<button class="v5-drawer-logout" type="button" data-logout><span class="v5-icon">${icon("logout")}</span><span>تسجيل الخروج</span></button>`
              : drawerLink("/login", "تسجيل الدخول", "login")}
          </div>
        </aside>
      </div>`;
  }

  function bottomNavHtml() {
    const items = [
      ["/", "الرئيسية", "home"],
      ["/services", "الأقسام", "grid"],
      ["/orders", "طلباتي", "orders"],
      ["/account", "حسابي", "user"]
    ];
    return items.map(([href, label, iconName]) => `
      <a href="${href}" class="${isActive(href) ? "active" : ""}"${isActive(href) ? ' aria-current="page"' : ""}>
        ${icon(iconName)}<span>${label}</span>
      </a>`).join("");
  }

  function renderShell() {
    if (headerMount) headerMount.innerHTML = headerHtml();
    if (drawerRoot) drawerRoot.innerHTML = drawerHtml();
    if (bottomNav) bottomNav.innerHTML = bottomNavHtml();
    if (footerMount) {
      footerMount.innerHTML = '<div class="v5-shell v5-footer-inner">UCHIHA Builder</div>';
    }
    bindShellEvents();
  }

  function renderContacts() {
    if (!contactStrip) return;
    const whatsapp = state.contacts.filter((contact) => contact.type === "whatsapp").slice(0, 2);
    if (!whatsapp.length) {
      contactStrip.hidden = true;
      contactStrip.innerHTML = "";
      return;
    }
    contactStrip.hidden = false;
    contactStrip.innerHTML = `<div class="v5-contact-strip-inner">${whatsapp.map((contact) => `
      <a class="v5-contact-card" href="${escapeHtml(contactHref(contact))}" target="_blank" rel="noopener">
        <span class="v5-contact-card-copy"><b>${escapeHtml(contact.name?.ar || contact.name?.en || "واتساب")}</b><small>${escapeHtml(contact.description?.ar || "تواصل عبر واتساب")}</small></span>
        <span class="v5-whatsapp" aria-hidden="true">◔</span>
      </a>`).join("")}</div>`;
  }

  function openDrawer() {
    state.drawerOpen = true;
    body.classList.add("v5-drawer-open");
    renderShell();
    document.querySelector("[data-drawer-close]")?.focus();
  }

  function closeDrawer() {
    state.drawerOpen = false;
    body.classList.remove("v5-drawer-open");
    renderShell();
  }

  async function logout(button) {
    if (!state.user || button.disabled) return;
    button.disabled = true;
    try {
      await requestJson("/api/auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": state.csrfToken }
      });
    } catch {
      // The redirect removes the visible authenticated state even if the response is interrupted.
    }
    location.assign("/login");
  }

  function bindShellEvents() {
    document.querySelector("[data-drawer-open]")?.addEventListener("click", openDrawer);
    document.querySelector("[data-drawer-close]")?.addEventListener("click", closeDrawer);
    document.querySelector("[data-drawer-overlay]")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeDrawer();
    });
    document.querySelector("[data-logout]")?.addEventListener("click", (event) => logout(event.currentTarget));
  }

  function sectionHead(title, description = "", back = null) {
    return `<div class="v5-page-head">
      <div class="v5-page-title"><h1>${escapeHtml(title)}</h1>${description ? `<p>${escapeHtml(description)}</p>` : ""}</div>
      ${back ? `<a class="v5-back" href="${escapeHtml(back)}" aria-label="رجوع">${icon("back")}</a>` : ""}
    </div>`;
  }

  function categoryCard(category, child = null) {
    const href = categoryHref(category, child);
    const name = child?.name || category.name;
    const image = child?.image || category.image || "";
    const tone = child?.tone || category.tone || "gray";
    return `<a class="v5-category-card" href="${href}"><span class="v5-card-media v5-category-media${image ? "" : " empty"}" data-tone="${escapeHtml(tone)}" aria-hidden="true">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async">` : ""}</span><span class="v5-category-name">${escapeHtml(name)}</span></a>`;
  }

  function homeHero() {
    return `<section class="v5-home-slider" data-home-slider aria-roledescription="carousel" aria-label="خدمات UCHIHA">
      <div class="v5-home-slides">
        ${HOME_SLIDES.map((slide, index) => `<a class="v5-home-slide${index === 0 ? " active" : ""}" href="${escapeHtml(slide.href)}" data-home-slide="${index}"${index === 0 ? "" : ' aria-hidden="true" tabindex="-1"'}>
          <img src="${escapeHtml(slide.image)}" alt=""${index === 0 ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">
          <span class="v5-home-slide-copy"><small>${escapeHtml(slide.kicker)}</small><b>${escapeHtml(slide.title)}</b><span>${escapeHtml(slide.description)}</span></span>
        </a>`).join("")}
      </div>
      <div class="v5-home-dots" role="tablist" aria-label="اختيار الشريحة">
        ${HOME_SLIDES.map((slide, index) => `<button type="button" data-home-dot="${index}" class="${index === 0 ? "active" : ""}" aria-label="${escapeHtml(slide.kicker)}" aria-selected="${index === 0}"></button>`).join("")}
      </div>
    </section>`;
  }

  function productCard(product) {
    return `<a class="v5-product-card" href="/product/${encodeURIComponent(product.slug)}">
      <span class="v5-card-media${product.imageUrl ? "" : " empty"}">${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" alt="">` : ""}</span>
      <span class="v5-product-name">${escapeHtml(product.name)}</span>
      <span class="v5-product-price">${escapeHtml(money(product.priceMinor, product.currency))}</span>
    </a>`;
  }

  function methodCard(method) {
    return `<a class="v5-method-card" href="/add-balance/${encodeURIComponent(method.key)}">
      <span class="v5-card-media${method.logoUrl ? "" : " empty"}">${method.logoUrl ? `<img src="${escapeHtml(method.logoUrl)}" alt="">` : ""}</span>
      <span class="v5-method-name">${escapeHtml(method.name?.ar || method.name?.en || method.key)}</span>
      ${method.network ? `<span class="v5-method-meta">${escapeHtml(method.network)}</span>` : ""}
    </a>`;
  }

  function emptyState(title, textValue = "") {
    return `<div class="v5-empty"><div><b>${escapeHtml(title)}</b>${textValue ? `<p>${escapeHtml(textValue)}</p>` : ""}</div></div>`;
  }

  function searchHtml(value = "") {
    return `<form class="v5-search" data-search-form>${icon("search")}<input name="q" type="search" autocomplete="off" value="${escapeHtml(value)}" placeholder="ابحث..."></form>`;
  }

  function homePage() {
    const featuredCategories = CATEGORY_TREE.filter((category) => category.featured !== false);
    document.title = "UCHIHA Builder";
    return `<div class="v5-shell">
      ${homeHero()}
      ${searchHtml()}
      <section class="v5-section v5-home-categories">
        <div class="v5-section-title"><div><h2>ماذا تريد أن تبني؟</h2><p>اختر القسم المناسب لمشروعك</p></div><a href="/services">عرض الكل</a></div>
        <div class="v5-category-grid">${featuredCategories.map((category) => categoryCard(category)).join("")}</div>
      </section>
    </div>`;
  }

  function servicesPage() {
    const query = normalize(new URLSearchParams(location.search).get("q"));
    const matchingCategories = query
      ? CATEGORY_TREE.filter((category) => normalize([category.name, ...category.children.map((item) => item.name)].join(" ")).includes(query))
      : CATEGORY_TREE;
    const matchingProducts = query
      ? state.products.filter((product) => normalize(`${product.name} ${product.description}`).includes(query))
      : [];
    document.title = "الأقسام — UCHIHA";
    return `<div class="v5-shell">
      ${sectionHead("الأقسام", "", "/")}
      ${searchHtml(query)}
      <div class="v5-category-grid">${matchingCategories.map((category) => categoryCard(category)).join("")}</div>
      ${query && matchingProducts.length ? `<section class="v5-section"><div class="v5-section-title"><h2>المنتجات</h2></div><div class="v5-product-grid">${matchingProducts.map(productCard).join("")}</div></section>` : ""}
      ${query && !matchingCategories.length && !matchingProducts.length ? emptyState("لا توجد نتيجة") : ""}
    </div>`;
  }

  function categoryPage() {
    const parts = path.split("/").filter(Boolean);
    const category = categoryBySlug(parts[1]);
    const child = category ? childBySlug(category, parts[2]) : null;
    if (!category || (parts[2] && !child)) return notFoundPage();
    document.title = `${child?.name || category.name} — UCHIHA`;
    if (!child) {
      return `<div class="v5-shell">${sectionHead(category.name, "", "/services")}<div class="v5-category-grid">${category.children.map((item) => categoryCard(category, item)).join("")}</div></div>`;
    }
    const products = state.products.filter(
      (product) => product.category === category.slug && product.subcategory === child.slug
    );
    return `<div class="v5-shell">${sectionHead(child.name, "", categoryHref(category))}${products.length ? `<div class="v5-product-grid">${products.map(productCard).join("")}</div>` : emptyState("لا توجد منتجات جاهزة للبيع في هذا القسم حاليًا")}</div>`;
  }

  function productPage() {
    const slug = decodeURIComponent(path.split("/").filter(Boolean)[1] || "");
    const product = state.products.find((item) => item.slug === slug);
    if (!product) return notFoundPage();
    const category = categoryBySlug(product.category);
    const child = childBySlug(category, product.subcategory);
    document.title = `${product.name} — UCHIHA`;
    const features = Array.isArray(product.features) ? product.features.filter(Boolean).slice(0, 8) : [];
    const loggedOut = !state.user;
    return `<div class="v5-shell">
      ${sectionHead(product.name, "", categoryHref(category, child))}
      <div class="v5-product-layout">
        <section class="v5-panel v5-product-copy">
          <div class="v5-product-image${product.imageUrl ? "" : " empty"}">${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" alt="">` : ""}</div>
          <h1>${escapeHtml(product.name)}</h1>
          ${product.description ? `<p>${escapeHtml(product.description)}</p>` : ""}
          ${features.length ? `<ul class="v5-features">${features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul>` : ""}
        </section>
        <aside class="v5-form-card">
          <div class="v5-price-box"><span>السعر</span><strong>${escapeHtml(money(product.priceMinor, product.currency))}</strong></div>
          ${loggedOut
            ? `<div class="v5-form" style="margin-top:14px"><a class="v5-primary" href="/login?next=${encodeURIComponent(path)}">تسجيل الدخول للشراء</a></div>`
            : `<form class="v5-form" data-product-order style="margin-top:14px">
                <input type="hidden" name="serviceId" value="${escapeHtml(product.id)}">
                <label class="v5-field"><span>الاسم</span><input name="customerName" required maxlength="160" value="${escapeHtml(state.account?.user?.displayName || state.user.displayName || "")}"></label>
                <label class="v5-field"><span>البريد الإلكتروني</span><input name="customerEmail" type="email" maxlength="240" value="${escapeHtml(state.account?.user?.email || state.user.email || "")}"></label>
                <label class="v5-field"><span>رقم الهاتف</span><input name="customerPhone" type="tel" maxlength="40" value="${escapeHtml(state.account?.preferences?.phone || "")}"></label>
                <label class="v5-field"><span>المعلومات المطلوبة</span><textarea name="details" required maxlength="6000"></textarea></label>
                <div id="productOrderNotice" class="v5-notice" hidden></div>
                <button class="v5-primary" type="submit">شراء</button>
              </form>`}
        </aside>
      </div>
    </div>`;
  }

  function addBalancePage() {
    document.title = "إضافة رصيد — UCHIHA";
    return `<div class="v5-shell">${sectionHead("إضافة رصيد", "اختر طريقة الدفع", "/")}${state.paymentMethods.length ? `<div class="v5-method-grid">${state.paymentMethods.map(methodCard).join("")}</div>` : emptyState("لا توجد طريقة دفع مفعلة حاليًا")}</div>`;
  }

  function paymentMethodPage() {
    const key = decodeURIComponent(path.split("/").filter(Boolean)[1] || "");
    const method = state.paymentMethods.find((item) => item.key === key);
    if (!method) return notFoundPage();
    document.title = `${method.name?.ar || method.key} — UCHIHA`;
    const name = method.name?.ar || method.name?.en || method.key;
    const instructionItems = (method.instructions || []).filter((item) => item.locale === "ar" && (item.title || item.body || item.warning));
    const loggedOut = !state.user;
    return `<div class="v5-shell">
      ${sectionHead(name, "", "/add-balance")}
      <div class="v5-balance-layout">
        <section class="v5-detail-card">
          <div class="v5-method-details">
            ${method.network ? `<div class="v5-method-detail-row"><span>الشبكة</span><b>${escapeHtml(method.network)}</b></div>` : ""}
            ${method.beneficiaryName ? `<div class="v5-method-detail-row"><span>اسم المستفيد</span><b>${escapeHtml(method.beneficiaryName)}</b></div>` : ""}
            ${method.accountIdentifier ? `<div class="v5-method-detail-row"><span>بيانات التحويل</span><b>${escapeHtml(method.accountIdentifier)}</b></div>` : ""}
            ${method.minimumAmountMinor !== null ? `<div class="v5-method-detail-row"><span>الحد الأدنى</span><b>${escapeHtml(money(method.minimumAmountMinor, method.currency))}</b></div>` : ""}
            ${method.maximumAmountMinor !== null ? `<div class="v5-method-detail-row"><span>الحد الأعلى</span><b>${escapeHtml(money(method.maximumAmountMinor, method.currency))}</b></div>` : ""}
          </div>
          ${method.qrUrl || method.qrImageUrl ? `<div class="v5-qr"><img src="${escapeHtml(method.qrUrl || method.qrImageUrl)}" alt="رمز QR لطريقة الدفع"></div>` : ""}
          ${instructionItems.length ? `<ul class="v5-instructions" style="margin-top:14px">${instructionItems.map((item) => `<li>${item.title ? `<b>${escapeHtml(item.title)}</b>` : ""}${item.body ? `<p>${escapeHtml(item.body)}</p>` : ""}${item.warning ? `<div class="v5-warning" style="margin-top:8px">${escapeHtml(item.warning)}</div>` : ""}</li>`).join("")}</ul>` : ""}
        </section>
        <aside class="v5-form-card">
          ${loggedOut
            ? `<a class="v5-primary" href="/login?next=${encodeURIComponent(path)}">تسجيل الدخول لإضافة الرصيد</a>`
            : `<form class="v5-form" data-deposit-form>
                <input type="hidden" name="paymentMethodId" value="${escapeHtml(method.id)}">
                <label class="v5-field"><span>المبلغ</span><input name="amount" type="number" inputmode="decimal" min="0" step="any" required placeholder="0"></label>
                <label class="v5-field"><span>اسم صاحب التحويل</span><input name="payerName" maxlength="200"></label>
                <label class="v5-field"><span>رقم العملية أو المرجع</span><input name="providerReference" maxlength="240"></label>
                <label class="v5-upload">${icon("upload")}<strong data-proof-name>رفع إثبات التحويل</strong><small>JPG أو PNG أو WebP — حتى 1.5MB</small><input name="proof" type="file" accept="image/jpeg,image/png,image/webp" required></label>
                <div id="depositNotice" class="v5-notice" hidden></div>
                <button class="v5-primary" type="submit">تقديم الطلب</button>
              </form>`}
        </aside>
      </div>
    </div>`;
  }

  function ordersPage() {
    document.title = "طلباتي — UCHIHA";
    if (!state.user) {
      return `<div class="v5-shell">${sectionHead("طلباتي", "", "/")}<div class="v5-auth-card"><a class="v5-primary" href="/login?next=/orders">تسجيل الدخول لعرض الطلبات</a></div></div>`;
    }
    return `<div class="v5-shell">${sectionHead("طلباتي", "", "/")}${state.orders.length ? `<div class="v5-orders">${state.orders.map((order) => `
      <article class="v5-order-card">
        <div class="v5-order-copy"><b>${escapeHtml(order.title)}</b><small>${escapeHtml(dateLabel(order.createdAt))}</small></div>
        <div class="v5-order-side">${order.amountMinor !== null && order.amountMinor !== undefined ? `<strong>${escapeHtml(money(order.amountMinor, order.currency))}</strong>` : ""}<span class="v5-status ${escapeHtml(order.status)}">${escapeHtml(statusLabel(order.status))}</span></div>
      </article>`).join("")}</div>` : emptyState("لا توجد طلبات حتى الآن")}</div>`;
  }

  function supportPage() {
    document.title = "الدعم — UCHIHA";
    return `<div class="v5-shell">${sectionHead("الدعم", "", "/")}${state.contacts.length ? `<div class="v5-support-grid">${state.contacts.map((contact) => `
      <a class="v5-contact-card" href="${escapeHtml(contactHref(contact))}"${contactHref(contact).startsWith("https://") ? ' target="_blank" rel="noopener"' : ""}>
        <span class="v5-contact-card-copy"><b>${escapeHtml(contact.name?.ar || contact.name?.en || "تواصل")}</b>${contact.description?.ar ? `<small>${escapeHtml(contact.description.ar)}</small>` : ""}</span>
        ${contact.type === "whatsapp" ? '<span class="v5-whatsapp">◔</span>' : `<span class="v5-icon">${icon("support")}</span>`}
      </a>`).join("")}</div>` : emptyState("لا توجد قناة دعم مفعلة حاليًا")}</div>`;
  }

  function authPage(mode) {
    const register = mode === "register";
    document.title = `${register ? "إنشاء حساب" : "تسجيل الدخول"} — UCHIHA`;
    return `<div class="v5-auth-wrap"><section class="v5-auth-card">
      <h1>${register ? "إنشاء حساب" : "تسجيل الدخول"}</h1>
      <p>${register ? "أنشئ حسابك لإدارة الرصيد والطلبات." : "ادخل إلى حسابك."}</p>
      <form class="v5-form" data-auth-form data-mode="${mode}">
        ${register ? '<label class="v5-field"><span>الاسم</span><input name="displayName" required maxlength="120"></label>' : ""}
        <label class="v5-field"><span>البريد الإلكتروني</span><input name="email" type="email" autocomplete="email" required maxlength="240"></label>
        <label class="v5-field"><span>كلمة المرور</span><input name="password" type="password" autocomplete="${register ? "new-password" : "current-password"}" required minlength="10" maxlength="256"></label>
        <div id="authNotice" class="v5-notice" hidden></div>
        <button class="v5-primary" type="submit">${register ? "إنشاء الحساب" : "تسجيل الدخول"}</button>
      </form>
      <p class="v5-auth-switch">${register ? 'لديك حساب؟ <a href="/login">تسجيل الدخول</a>' : 'ليس لديك حساب؟ <a href="/register">إنشاء حساب</a>'}</p>
    </section></div>`;
  }

  function policyPage(title, paragraphs) {
    document.title = `${title} — UCHIHA`;
    return `<div class="v5-shell v5-policy">${sectionHead(title, "", "/")}${paragraphs.map(([heading, value]) => `<h2>${escapeHtml(heading)}</h2><p>${escapeHtml(value)}</p>`).join("")}</div>`;
  }

  function notFoundPage() {
    document.title = "الصفحة غير موجودة — UCHIHA";
    return `<div class="v5-shell">${emptyState("الصفحة غير موجودة")}<div style="margin-top:12px"><a class="v5-primary" href="/">العودة للرئيسية</a></div></div>`;
  }

  function renderCurrentPage() {
    if (!pageMount) return;
    if (path === "/") pageMount.innerHTML = homePage();
    else if (path === "/services") pageMount.innerHTML = servicesPage();
    else if (path.startsWith("/category/")) pageMount.innerHTML = categoryPage();
    else if (path.startsWith("/product/")) pageMount.innerHTML = productPage();
    else if (path === "/add-balance") pageMount.innerHTML = addBalancePage();
    else if (path.startsWith("/add-balance/")) pageMount.innerHTML = paymentMethodPage();
    else if (path === "/orders") pageMount.innerHTML = ordersPage();
    else if (path === "/support") pageMount.innerHTML = supportPage();
    else if (path === "/login") pageMount.innerHTML = authPage("login");
    else if (path === "/register") pageMount.innerHTML = authPage("register");
    else if (path === "/privacy") pageMount.innerHTML = policyPage("الخصوصية", [["بيانات الحساب", "تُستخدم بيانات الحساب لتشغيل الطلبات والمحفظة والدعم فقط."], ["الإثباتات", "تُحفظ إثباتات التحويل بشكل خاص ولا تظهر للعامة."]]);
    else if (path === "/terms") pageMount.innerHTML = policyPage("الشروط", [["الطلبات", "يبدأ تنفيذ الطلب بعد قبول البيانات أو الدفع حسب نوع المنتج."], ["الاستخدام", "يجب استخدام المنصة والمنتجات بطريقة قانونية وآمنة."]]);
    else if (path === "/refund-policy") pageMount.innerHTML = policyPage("سياسة الاسترداد", [["قبل التنفيذ", "تُراجع طلبات الاسترداد قبل بدء تنفيذ الخدمة."], ["بعد التنفيذ", "يعتمد الاسترداد على حالة المنتج والعمل المنجز."]]);
    else if (["/showcase", "/about"].includes(path)) location.replace("/");
    else pageMount.innerHTML = notFoundPage();
    bindPageEvents();
  }

  function setNotice(id, message, error = false) {
    const node = document.getElementById(id);
    if (!node) return;
    node.hidden = false;
    node.textContent = message;
    node.classList.toggle("error", error);
  }

  async function submitAuth(form) {
    const mode = form.dataset.mode;
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    const values = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    try {
      const payload = await requestJson(`/api/auth/${mode}`, {
        method: "POST",
        body: mode === "register"
          ? { displayName: values.displayName, email: values.email, password: values.password }
          : { email: values.email, password: values.password }
      });
      if (payload.csrfToken) sessionStorage.setItem("uchihaBuilderCsrf", payload.csrfToken);
      location.assign(safeNext());
    } catch (error) {
      setNotice("authNotice", error.message, true);
      button.disabled = false;
    }
  }

  async function submitProductOrder(form) {
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    const values = Object.fromEntries(new FormData(form).entries());
    if (!values.customerEmail && !values.customerPhone) {
      setNotice("productOrderNotice", "أدخل البريد الإلكتروني أو رقم الهاتف.", true);
      return;
    }
    button.disabled = true;
    try {
      await requestJson("/api/public/service-requests", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: {
          serviceId: values.serviceId,
          customerName: values.customerName,
          customerEmail: values.customerEmail,
          customerPhone: values.customerPhone,
          details: values.details,
          locale: "ar",
          sourcePage: path
        }
      });
      location.assign("/orders");
    } catch (error) {
      setNotice("productOrderNotice", error.message, true);
      button.disabled = false;
    }
  }

  function readFileDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("تعذر قراءة صورة الإثبات"));
      reader.readAsDataURL(file);
    });
  }

  async function submitDeposit(form) {
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    const values = new FormData(form);
    const method = state.paymentMethods.find((item) => item.id === values.get("paymentMethodId"));
    const proof = values.get("proof");
    if (!method || !(proof instanceof File) || !proof.size) {
      setNotice("depositNotice", "اختر إثبات التحويل.", true);
      return;
    }
    if (proof.size > 1_500_000) {
      setNotice("depositNotice", "حجم صورة الإثبات أكبر من 1.5MB.", true);
      return;
    }
    const amountMinor = amountToMinor(values.get("amount"), method.currency);
    if (!amountMinor) {
      setNotice("depositNotice", "أدخل مبلغًا صحيحًا.", true);
      return;
    }
    button.disabled = true;
    try {
      const proofDataUrl = await readFileDataUrl(proof);
      await requestJson("/api/platform/deposit-requests", {
        method: "POST",
        headers: {
          "x-csrf-token": state.csrfToken,
          "idempotency-key": crypto.randomUUID()
        },
        body: {
          paymentMethodId: method.id,
          amountMinor,
          payerName: values.get("payerName"),
          providerReference: values.get("providerReference"),
          proofDataUrl
        }
      });
      location.assign("/orders");
    } catch (error) {
      setNotice("depositNotice", error.message, true);
      button.disabled = false;
    }
  }

  function bindHomeSlider() {
    const slider = document.querySelector("[data-home-slider]");
    if (!slider || slider.dataset.homeSliderBound === "true") return;
    const slides = [...slider.querySelectorAll("[data-home-slide]")];
    const dots = [...slider.querySelectorAll("[data-home-dot]")];
    if (slides.length < 2) return;
    slider.dataset.homeSliderBound = "true";
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    let activeIndex = 0;
    let pointerStart = null;
    let timer = null;

    const show = (nextIndex) => {
      activeIndex = (nextIndex + slides.length) % slides.length;
      slides.forEach((slide, index) => {
        const active = index === activeIndex;
        slide.classList.toggle("active", active);
        slide.setAttribute("aria-hidden", String(!active));
        slide.tabIndex = active ? 0 : -1;
      });
      dots.forEach((dot, index) => {
        const active = index === activeIndex;
        dot.classList.toggle("active", active);
        dot.setAttribute("aria-selected", String(active));
      });
    };

    const stop = () => {
      window.clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      if (reducedMotion || document.hidden) return;
      timer = window.setInterval(() => show(activeIndex + 1), 5000);
    };

    dots.forEach((dot, index) => dot.addEventListener("click", () => {
      show(index);
      start();
    }));
    slider.addEventListener("pointerdown", (event) => {
      pointerStart = event.clientX;
      stop();
    }, { passive: true });
    slider.addEventListener("pointerup", (event) => {
      if (pointerStart !== null) {
        const distance = event.clientX - pointerStart;
        if (Math.abs(distance) > 46) show(activeIndex + (distance < 0 ? 1 : -1));
      }
      pointerStart = null;
      start();
    }, { passive: true });
    slider.addEventListener("pointercancel", () => {
      pointerStart = null;
      start();
    });
    slider.addEventListener("mouseenter", stop);
    slider.addEventListener("mouseleave", start);
    slider.addEventListener("focusin", stop);
    slider.addEventListener("focusout", start);
    document.addEventListener("visibilitychange", start);
    start();
  }

  function bindPageEvents() {
    bindHomeSlider();
    document.querySelector("[data-search-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = new FormData(event.currentTarget).get("q");
      location.assign(`/services${query ? `?q=${encodeURIComponent(query)}` : ""}`);
    });
    document.querySelector("[data-auth-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitAuth(event.currentTarget);
    });
    document.querySelector("[data-product-order]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitProductOrder(event.currentTarget);
    });
    const depositForm = document.querySelector("[data-deposit-form]");
    depositForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitDeposit(event.currentTarget);
    });
    depositForm?.querySelector('input[type="file"]')?.addEventListener("change", (event) => {
      const file = event.currentTarget.files?.[0];
      const label = depositForm.querySelector("[data-proof-name]");
      if (label) label.textContent = file?.name || "رفع إثبات التحويل";
    });
  }

  async function loadData() {
    const [portal, me] = await Promise.all([
      requestJson("/api/public/portal").catch(() => null),
      requestJson("/api/me").catch(() => null)
    ]);
    state.portal = portal;
    state.products = catalogProducts(portal);
    state.paymentMethods = availablePaymentMethods(portal);
    state.contacts = activeContacts(portal);
    if (me?.user) {
      state.me = me;
      state.user = me.user;
      state.csrfToken = me.csrfToken || sessionStorage.getItem("uchihaBuilderCsrf") || "";
      const accountPayload = await requestJson("/api/platform/account").catch(() => null);
      state.account = accountPayload?.account || null;
      if (path === "/orders") {
        const orderPayload = await requestJson("/api/platform/orders").catch(() => null);
        state.orders = orderPayload?.orders || [];
      }
    }
  }

  async function init() {
    if (state.loading) return;
    state.loading = true;
    renderShell();
    try {
      await loadData();
    } catch (error) {
      showToast(error.message, true);
    } finally {
      state.loading = false;
    }
    renderShell();
    renderContacts();
    renderCurrentPage();
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.drawerOpen) closeDrawer();
  });

  init();
})();
