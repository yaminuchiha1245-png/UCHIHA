(() => {
  "use strict";

  const body = document.body;
  const root = document.documentElement;
  const pageMount = document.getElementById("platformPage");
  const headerMount = document.getElementById("siteHeader");
  const footerMount = document.getElementById("siteFooter");
  const builderTopbar = body.dataset.page === "builder" ? document.querySelector("body > .topbar") : null;

  const LEGACY_PATHS = Object.freeze({
    "/index.html": "/",
    "/services.html": "/services",
    "/support.html": "/support",
    "/contact.html": "/support",
    "/login.html": "/login",
    "/register.html": "/register",
    "/payment-methods.html": "/payment-methods",
    "/api-services.html": "/api-services",
    "/showcase.html": "/showcase",
    "/about.html": "/about",
    "/privacy.html": "/privacy",
    "/terms.html": "/terms",
    "/refund-policy.html": "/refund-policy"
  });

  const rawPath = location.pathname.replace(/\/+$/, "") || "/";
  const path = LEGACY_PATHS[rawPath] || rawPath;
  if (path !== rawPath) history.replaceState(null, "", `${path}${location.search}${location.hash}`);

  const CATEGORIES = Object.freeze([
    {
      slug: "telegram-bots",
      title: "بوتات تلغرام",
      icon: "✈",
      description: "بوتات جاهزة للبيع والإدارة والاشتراكات والذكاء الاصطناعي.",
      children: [
        { slug: "store-bots", title: "بوتات المتاجر", description: "بيع المنتجات والطلبات والدفع والإشعارات." },
        { slug: "ai-bots", title: "بوتات الذكاء الاصطناعي", description: "مستويات مختلفة للسرعة والفهم والميزات." },
        { slug: "subscription-bots", title: "بوتات الاشتراكات", description: "إدارة الخطط والمشتركين والقنوات." },
        { slug: "admin-bots", title: "بوتات الإدارة", description: "طلبات وموظفون وتقارير وتنبيهات." },
        { slug: "support-bots", title: "بوتات الدعم", description: "تذاكر ومتابعة وخدمة عملاء." }
      ]
    },
    {
      slug: "websites",
      title: "المواقع",
      icon: "▣",
      description: "مواقع واضحة وسريعة مرتبطة بلوحة إدارة موحدة.",
      children: [
        { slug: "store-websites", title: "مواقع المتاجر", description: "أقسام ومنتجات وسلة وطلبات ودفع." },
        { slug: "company-websites", title: "مواقع الشركات", description: "هوية وخدمات وأعمال وتواصل." },
        { slug: "service-platforms", title: "منصات الخدمات", description: "حسابات وطلبات واشتراكات ولوحات تحكم." }
      ]
    },
    {
      slug: "mobile-apps",
      title: "تطبيقات الجوال",
      icon: "▯",
      description: "تطبيقات مرتبطة بالحساب والبيانات نفسها دون تكرار.",
      children: [
        { slug: "android-apps", title: "تطبيقات Android", description: "تطبيق متجر أو إدارة أو خدمة." },
        { slug: "ios-apps", title: "تطبيقات iPhone", description: "نسخ iOS مرتبطة بالنظام نفسه." }
      ]
    },
    {
      slug: "artificial-intelligence",
      title: "الذكاء الاصطناعي",
      icon: "◎",
      description: "منتجات ذكية جاهزة بمستويات وميزات واضحة.",
      children: [
        { slug: "chat-ai", title: "مساعدات الدردشة", description: "دردشة وكتابة وترجمة وتحليل." },
        { slug: "coding-ai", title: "ذكاء البرمجة", description: "مساعدة برمجية وتحليل ملفات ومشاريع." },
        { slug: "media-ai", title: "الصور والصوت", description: "إنشاء ومعالجة الوسائط حسب الخطة." }
      ]
    },
    {
      slug: "api-integrations",
      title: "واجهات API",
      icon: "</>",
      description: "ربط الكتالوج والطلبات والحالات والخدمات الخارجية.",
      children: [
        { slug: "catalog-api", title: "API المنتجات", description: "استيراد ومزامنة المنتجات والأسعار." },
        { slug: "orders-api", title: "API الطلبات", description: "إنشاء الطلبات وتتبع الحالات بأمان." },
        { slug: "custom-integrations", title: "ربط مخصص", description: "تكامل بين أنظمة ومزودين مختلفين." }
      ]
    },
    {
      slug: "hosting-domains",
      title: "الاستضافة والدومينات",
      icon: "☁",
      description: "تشغيل واستقرار وربط نطاق ونسخ احتياطية.",
      children: [
        { slug: "bot-hosting", title: "استضافة البوتات", description: "تشغيل دائم ومراقبة وإعادة تشغيل." },
        { slug: "website-hosting", title: "استضافة المواقع", description: "SSL ونسخ احتياطي ومراقبة." },
        { slug: "domains", title: "الدومينات", description: "ربط ونقل وإدارة DNS." }
      ]
    }
  ]);

  const FALLBACK_PRODUCTS = Object.freeze([
    { slug: "store-bot-starter", category: "telegram-bots", subcategory: "store-bots", name: "بوت متجر Starter", description: "المنتجات والأقسام والطلبات والدفع اليدوي لبدء مشروع صغير.", priceMinor: 1499, currency: "USD", badge: "للبداية" },
    { slug: "store-bot-pro", category: "telegram-bots", subcategory: "store-bots", name: "بوت متجر Pro", description: "كوبونات وطرق دفع متعددة وتقارير وربط منتجات أكبر.", priceMinor: 2999, currency: "USD", badge: "الأكثر طلبًا" },
    { slug: "store-bot-ultimate", category: "telegram-bots", subcategory: "store-bots", name: "بوت متجر Ultimate", description: "جميع الميزات والموظفين والتكاملات والترقيات ضمن منتج واحد.", priceMinor: 4999, currency: "USD", badge: "كامل" },
    { slug: "ai-bot-starter", category: "telegram-bots", subcategory: "ai-bots", name: "بوت AI Starter", description: "دردشة وكتابة وترجمة بعدد استخدام مناسب للبداية.", priceMinor: 1299, currency: "USD", badge: "Starter" },
    { slug: "ai-bot-pro", category: "telegram-bots", subcategory: "ai-bots", name: "بوت AI Pro", description: "فهم أفضل وتحليل ملفات ومساعدة برمجية وخيارات إدارة أوسع.", priceMinor: 2499, currency: "USD", badge: "Pro" },
    { slug: "ai-bot-ultimate", category: "telegram-bots", subcategory: "ai-bots", name: "بوت AI Ultimate", description: "أوضاع ذكاء متعددة وصور وصوت وملفات وحدود أكبر.", priceMinor: 4499, currency: "USD", badge: "Ultimate" },
    { slug: "subscription-bot", category: "telegram-bots", subcategory: "subscription-bots", name: "بوت الاشتراكات", description: "خطط ومدد وتجديد وتنبيهات وإدارة مشتركين.", priceMinor: 1999, currency: "USD" },
    { slug: "admin-bot", category: "telegram-bots", subcategory: "admin-bots", name: "بوت الإدارة", description: "إدارة الطلبات والعملاء والموظفين والتنبيهات من تلغرام.", priceMinor: 1999, currency: "USD" },
    { slug: "support-bot", category: "telegram-bots", subcategory: "support-bots", name: "بوت الدعم والتذاكر", description: "تذاكر دعم وتصنيف ومتابعة وتحويل للموظفين.", priceMinor: 1499, currency: "USD" },
    { slug: "digital-store-website", category: "websites", subcategory: "store-websites", name: "متجر رقمي احترافي", description: "أقسام رئيسية وفرعية ومنتجات داخل الأقسام وسلة وطلبات.", priceMinor: 2999, currency: "USD" },
    { slug: "company-website", category: "websites", subcategory: "company-websites", name: "موقع شركة", description: "واجهة تعريفية واضحة للخدمات والأعمال والتواصل.", priceMinor: 2499, currency: "USD" },
    { slug: "service-platform", category: "websites", subcategory: "service-platforms", name: "منصة خدمات", description: "حسابات وطلبات وحالات ولوحة عميل وإدارة.", priceMinor: 5999, currency: "USD" },
    { slug: "android-store-app", category: "mobile-apps", subcategory: "android-apps", name: "تطبيق متجر Android", description: "تطبيق مرتبط بنفس كتالوج الموقع والبوت والطلبات.", priceMinor: 3999, currency: "USD" },
    { slug: "ios-store-app", category: "mobile-apps", subcategory: "ios-apps", name: "تطبيق متجر iPhone", description: "نسخة iOS مرتبطة بالحساب والنظام الموحد.", priceMinor: 5999, currency: "USD", badge: "قريبًا" },
    { slug: "chat-ai-assistant", category: "artificial-intelligence", subcategory: "chat-ai", name: "مساعد دردشة ذكي", description: "كتابة وترجمة وتلخيص وتحليل حسب مستوى المنتج.", priceMinor: 1499, currency: "USD" },
    { slug: "coding-ai-assistant", category: "artificial-intelligence", subcategory: "coding-ai", name: "مساعد برمجة", description: "شرح وبناء ومراجعة أكواد وملفات مشاريع.", priceMinor: 2499, currency: "USD" },
    { slug: "media-ai-suite", category: "artificial-intelligence", subcategory: "media-ai", name: "حزمة ذكاء للوسائط", description: "إنشاء صور وصوت ومعالجة محتوى ضمن حدود الخطة.", priceMinor: 2999, currency: "USD" },
    { slug: "catalog-api-package", category: "api-integrations", subcategory: "catalog-api", name: "API المنتجات", description: "كتالوج وأسعار وحقول وخيارات ومزامنة دورية.", priceMinor: 999, currency: "USD" },
    { slug: "orders-api-package", category: "api-integrations", subcategory: "orders-api", name: "API الطلبات", description: "إنشاء وتتبع وحالات وWebhooks وIdempotency.", priceMinor: 1499, currency: "USD" },
    { slug: "custom-api-integration", category: "api-integrations", subcategory: "custom-integrations", name: "ربط API مخصص", description: "تكامل مدروس بين مشروعك ومزود أو نظام خارجي.", priceMinor: null, currency: "USD" },
    { slug: "bot-hosting-plan", category: "hosting-domains", subcategory: "bot-hosting", name: "استضافة بوت", description: "تشغيل دائم ومراقبة وسجلات ونسخ احتياطي.", priceMinor: 799, currency: "USD" },
    { slug: "website-hosting-plan", category: "hosting-domains", subcategory: "website-hosting", name: "استضافة موقع", description: "SSL ونسخ احتياطي ومراقبة واستقرار.", priceMinor: 999, currency: "USD" },
    { slug: "domain-management", category: "hosting-domains", subcategory: "domains", name: "ربط وإدارة دومين", description: "إعداد DNS وربط النطاق بالمشروع ومتابعة التجديد.", priceMinor: null, currency: "USD" }
  ]);

  const state = {
    user: null,
    account: null,
    portal: null,
    products: [...FALLBACK_PRODUCTS],
    menuOpen: false
  };

  const NAV_ITEMS = Object.freeze([
    { href: "/", label: "الرئيسية" },
    { href: "/services", label: "الأقسام" },
    { href: "/account", label: "لوحة التحكم" },
    { href: "/support", label: "الدعم" }
  ]);

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

  function slugify(value) {
    return normalize(value)
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "service";
  }

  function safeInternal(value, fallback = "/account") {
    const candidate = String(value || "");
    return candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("..")
      ? candidate
      : fallback;
  }

  function money(minor, currency = "USD") {
    if (minor === null || minor === undefined) return "حسب المتطلبات";
    try {
      return new Intl.NumberFormat("ar", {
        style: "currency",
        currency,
        maximumFractionDigits: 2
      }).format(Number(minor) / 100);
    } catch {
      return `${(Number(minor) / 100).toFixed(2)} ${currency}`;
    }
  }

  function categoryBySlug(slug) {
    return CATEGORIES.find((category) => category.slug === slug) || null;
  }

  function childBySlug(category, slug) {
    return category?.children?.find((child) => child.slug === slug) || null;
  }

  function categoryHref(category, child = null) {
    return child
      ? `/category/${encodeURIComponent(category.slug)}/${encodeURIComponent(child.slug)}`
      : `/category/${encodeURIComponent(category.slug)}`;
  }

  function categoryCard(category) {
    return `
      <a class="catalog-category-card" href="${categoryHref(category)}">
        <span class="catalog-category-icon" aria-hidden="true">${escapeHtml(category.icon)}</span>
        <div><h2>${escapeHtml(category.title)}</h2><p>${escapeHtml(category.description)}</p></div>
        <span class="catalog-category-count">${category.children.length} أقسام</span>
        <b class="catalog-card-arrow" aria-hidden="true">←</b>
      </a>`;
  }

  function childCard(category, child) {
    const count = state.products.filter((product) => product.category === category.slug && product.subcategory === child.slug).length;
    return `
      <a class="catalog-child-card" href="${categoryHref(category, child)}">
        <span class="catalog-child-index">${String(category.children.indexOf(child) + 1).padStart(2, "0")}</span>
        <div><h2>${escapeHtml(child.title)}</h2><p>${escapeHtml(child.description)}</p></div>
        <small>${count} منتجات</small>
        <b aria-hidden="true">←</b>
      </a>`;
  }

  function productCard(product) {
    return `
      <article class="catalog-product-card">
        <div class="catalog-product-top">
          <span class="catalog-product-mark">U</span>
          ${product.badge ? `<small>${escapeHtml(product.badge)}</small>` : ""}
        </div>
        <h2>${escapeHtml(product.name)}</h2>
        <p>${escapeHtml(product.description)}</p>
        <div class="catalog-product-bottom">
          <strong>${escapeHtml(money(product.priceMinor, product.currency))}</strong>
          <a href="/product/${encodeURIComponent(product.slug)}">عرض التفاصيل</a>
        </div>
      </article>`;
  }

  function breadcrumb(items) {
    return `<nav class="catalog-breadcrumb" aria-label="مسار الصفحة">
      ${items.map((item) => item.href
        ? `<a href="${item.href}">${escapeHtml(item.label)}</a><span aria-hidden="true">/</span>`
        : `<b aria-current="page">${escapeHtml(item.label)}</b>`).join("")}
    </nav>`;
  }

  function setTitle(title) {
    document.title = title ? `${title} — UCHIHA Builder` : "UCHIHA Builder";
  }

  function activeNav(href) {
    if (href === "/") return path === "/";
    if (href === "/services") return path === "/services" || path.startsWith("/category/") || path.startsWith("/product/");
    return path.startsWith(href);
  }

  function headerActionsHtml() {
    const wallet = state.account?.wallet;
    const amount = wallet ? money(wallet.availableMinor, wallet.currency) : "";
    if (state.user) {
      return `
        <a class="unified-wallet" href="/account#wallet"><small>الرصيد</small><b>${escapeHtml(amount)}</b></a>
        <a class="unified-account-link" href="/account">حسابي</a>`;
    }
    return '<a class="unified-login" href="/login">تسجيل الدخول</a>';
  }

  function navHtml() {
    return NAV_ITEMS.map((item) => `
      <a href="${item.href}" class="${activeNav(item.href) ? "active" : ""}"${activeNav(item.href) ? ' aria-current="page"' : ""}>${item.label}</a>`).join("");
  }

  function renderHeader() {
    const target = headerMount || builderTopbar;
    if (!target) return;
    target.className = "unified-site-header";
    target.innerHTML = `
      <div class="unified-shell unified-header-inner">
        <a class="unified-brand" href="/" aria-label="UCHIHA Builder">
          <span class="unified-brand-mark"><img src="/assets/brand/platform-mark.svg" alt=""></span>
          <span><b>UCHIHA</b><small>BUILDER</small></span>
        </a>
        <nav class="unified-main-nav" aria-label="التنقل الرئيسي">${navHtml()}</nav>
        <div class="unified-header-actions">
          ${headerActionsHtml()}
          <button class="unified-mobile-toggle" type="button" data-menu-toggle aria-label="فتح القائمة" aria-expanded="${state.menuOpen}"><span></span><span></span><span></span></button>
        </div>
      </div>
      <nav class="unified-mobile-panel${state.menuOpen ? " open" : ""}" aria-label="قائمة الهاتف">
        ${navHtml()}
        <a href="/payment-methods">طرق الدفع</a>
        <a href="/api-services">واجهات API</a>
        ${state.user ? '<a href="/account">حسابي</a>' : '<a href="/login">تسجيل الدخول</a>'}
      </nav>`;
    target.querySelector("[data-menu-toggle]")?.addEventListener("click", () => {
      state.menuOpen = !state.menuOpen;
      renderHeader();
    });
  }

  function renderFooter() {
    if (!footerMount) return;
    footerMount.className = "unified-site-footer";
    footerMount.innerHTML = `
      <div class="unified-shell unified-footer-inner">
        <div class="unified-footer-brand"><b>UCHIHA Builder</b><small>حلول رقمية مرتبة ضمن أقسام واضحة.</small></div>
        <nav aria-label="روابط إضافية">
          <a href="/services">الأقسام</a>
          <a href="/payment-methods">طرق الدفع</a>
          <a href="/api-services">واجهات API</a>
          <a href="/support">الدعم</a>
          <a href="/privacy">الخصوصية</a>
          <a href="/terms">الشروط</a>
        </nav>
      </div>`;
  }

  async function requestJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
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
    } finally {
      clearTimeout(timer);
    }
  }

  function inferServiceLocation(service) {
    const text = normalize([
      service.slug,
      service.key,
      service.category,
      service.name?.ar,
      service.name?.en,
      service.description?.ar,
      service.description?.en
    ].join(" "));
    const rules = [
      ["telegram-bots", "ai-bots", ["ذكاء", "ai", "chat"]],
      ["telegram-bots", "subscription-bots", ["اشتراك", "subscription", "قناة"]],
      ["telegram-bots", "admin-bots", ["بوت إدارة", "admin bot", "موظف"]],
      ["telegram-bots", "support-bots", ["دعم", "ticket", "تذكرة"]],
      ["telegram-bots", "store-bots", ["بوت", "telegram"]],
      ["mobile-apps", "ios-apps", ["ios", "iphone", "آيفون"]],
      ["mobile-apps", "android-apps", ["android", "تطبيق"]],
      ["artificial-intelligence", "coding-ai", ["برمجة", "coding", "code ai"]],
      ["artificial-intelligence", "media-ai", ["صورة", "صور", "video", "صوت", "media"]],
      ["artificial-intelligence", "chat-ai", ["ذكاء", "ai", "chat"]],
      ["api-integrations", "orders-api", ["orders api", "طلب", "webhook"]],
      ["api-integrations", "catalog-api", ["api", "واجهة", "منتج", "catalog"]],
      ["hosting-domains", "domains", ["domain", "دومين", "dns"]],
      ["hosting-domains", "bot-hosting", ["استضافة بوت", "bot hosting"]],
      ["hosting-domains", "website-hosting", ["استضافة", "hosting", "server", "vps"]],
      ["websites", "company-websites", ["شركة", "company", "corporate"]],
      ["websites", "service-platforms", ["منصة", "platform", "نظام"]],
      ["websites", "store-websites", ["موقع", "متجر", "website", "web"]]
    ];
    for (const [category, subcategory, words] of rules) {
      if (words.some((word) => text.includes(word))) return { category, subcategory };
    }
    return { category: "websites", subcategory: "service-platforms" };
  }

  function mergePortalProducts(portal) {
    const mapped = (portal?.services || [])
      .filter((service) => service.status === "active")
      .map((service) => {
        const location = inferServiceLocation(service);
        return {
          slug: service.slug || slugify(service.name?.ar || service.key),
          category: location.category,
          subcategory: location.subcategory,
          name: service.name?.ar || service.name?.en || "خدمة رقمية",
          description: service.description?.ar || service.description?.en || "خدمة رقمية من UCHIHA Builder.",
          priceMinor: service.startingPriceMinor,
          currency: service.currency || "USD",
          badge: service.status === "coming_soon" ? "قريبًا" : null,
          serviceId: service.id,
          features: service.features?.ar || []
        };
      });
    const map = new Map(FALLBACK_PRODUCTS.map((product) => [product.slug, product]));
    for (const product of mapped) map.set(product.slug, product);
    state.products = [...map.values()];
  }

  async function loadPublicData() {
    const [me, portal] = await Promise.all([
      requestJson("/api/me").catch(() => null),
      requestJson("/api/public/portal").catch(() => null)
    ]);
    if (me?.user) {
      state.user = me.user;
      const account = await requestJson("/api/platform/account").catch(() => null);
      state.account = account?.account || null;
    }
    state.portal = portal;
    mergePortalProducts(portal);
    renderHeader();
    renderCurrentPage();
  }

  function homePage() {
    setTitle("حلولك الرقمية من مكان واحد");
    return `
      <section class="catalog-hero">
        <div class="unified-shell catalog-hero-inner">
          <span class="catalog-kicker">منصة خدمات رقمية</span>
          <h1>حلولك الرقمية<br><em>من مكان واحد.</em></h1>
          <p>اختر القسم، ثم القسم الفرعي، وبعدها المنتج المناسب. لا منتجات عشوائية ولا واجهات متداخلة.</p>
          <form class="catalog-search" data-catalog-search>
            <input name="q" type="search" autocomplete="off" placeholder="ابحث عن بوت أو موقع أو تطبيق...">
            <button type="submit">بحث</button>
          </form>
          <div class="catalog-hero-points"><span>واجهة واحدة</span><span>أقسام واضحة</span><span>إدارة موحدة</span></div>
        </div>
      </section>
      <section class="catalog-section">
        <div class="unified-shell">
          <div class="catalog-section-heading"><div><small>01</small><h2>الأقسام الرئيسية</h2></div><p>المنتجات لا تظهر هنا؛ افتح القسم للوصول إلى أقسامه الداخلية.</p></div>
          <div class="catalog-category-grid">${CATEGORIES.map(categoryCard).join("")}</div>
        </div>
      </section>
      <section class="catalog-section catalog-steps-section">
        <div class="unified-shell">
          <div class="catalog-section-heading"><div><small>02</small><h2>طريقة الوصول للمنتج</h2></div></div>
          <div class="catalog-steps">
            <article><b>1</b><h3>اختر المجال</h3><p>بوتات أو مواقع أو تطبيقات أو غيرها.</p></article>
            <article><b>2</b><h3>افتح القسم الفرعي</h3><p>مثلاً بوتات المتاجر أو بوتات الذكاء.</p></article>
            <article><b>3</b><h3>اختر المنتج</h3><p>قارن المستويات ثم افتح التفاصيل والشراء.</p></article>
          </div>
        </div>
      </section>`;
  }

  function servicesPage() {
    setTitle("الأقسام");
    const query = normalize(new URLSearchParams(location.search).get("q"));
    const results = query
      ? state.products.filter((product) => normalize(`${product.name} ${product.description}`).includes(query))
      : [];
    return `
      <section class="catalog-page-head"><div class="unified-shell">
        ${breadcrumb([{ href: "/", label: "الرئيسية" }, { label: "الأقسام" }])}
        <span class="catalog-kicker">دليل المنصة</span><h1>الأقسام الرئيسية</h1>
        <p>ابدأ من القسم، ولا تظهر المنتجات إلا بعد اختيار القسم الفرعي.</p>
        <form class="catalog-search compact" data-catalog-search><input name="q" type="search" value="${escapeHtml(query)}" placeholder="ابحث عن منتج..."><button type="submit">بحث</button></form>
      </div></section>
      <section class="catalog-section"><div class="unified-shell">
        <div class="catalog-category-grid">${CATEGORIES.map(categoryCard).join("")}</div>
        ${query ? `<div class="catalog-search-results"><div class="catalog-section-heading"><div><small>نتائج</small><h2>نتائج البحث</h2></div><p>${results.length} نتيجة</p></div>${results.length ? `<div class="catalog-product-grid">${results.map(productCard).join("")}</div>` : '<div class="catalog-empty"><b>لا توجد نتيجة مطابقة</b><p>جرّب كلمة أخرى أو افتح أحد الأقسام.</p></div>'}</div>` : ""}
      </div></section>`;
  }

  function categoryPage() {
    const parts = path.split("/").filter(Boolean);
    const category = categoryBySlug(parts[1]);
    const child = category ? childBySlug(category, parts[2]) : null;
    if (!category || (parts[2] && !child)) return notFoundPage();
    setTitle(child ? child.title : category.title);
    const products = child
      ? state.products.filter((product) => product.category === category.slug && product.subcategory === child.slug)
      : [];
    return `
      <section class="catalog-page-head category"><div class="unified-shell">
        ${breadcrumb([
          { href: "/", label: "الرئيسية" },
          { href: "/services", label: "الأقسام" },
          ...(child ? [{ href: categoryHref(category), label: category.title }, { label: child.title }] : [{ label: category.title }])
        ])}
        <span class="catalog-page-icon" aria-hidden="true">${escapeHtml(category.icon)}</span>
        <h1>${escapeHtml(child?.title || category.title)}</h1>
        <p>${escapeHtml(child?.description || category.description)}</p>
      </div></section>
      <section class="catalog-section"><div class="unified-shell">
        ${child
          ? `<div class="catalog-section-heading"><div><small>المنتجات</small><h2>منتجات ${escapeHtml(child.title)}</h2></div><p>اختر المنتج لفتح صفحته المستقلة.</p></div>${products.length ? `<div class="catalog-product-grid">${products.map(productCard).join("")}</div>` : '<div class="catalog-empty"><b>لا توجد منتجات منشورة في هذا القسم بعد</b><p>سيظهر المنتج هنا بعد تفعيله من الإدارة.</p></div>'}`
          : `<div class="catalog-section-heading"><div><small>الأقسام الداخلية</small><h2>اختر القسم الفرعي</h2></div><p>لن نعرض المنتجات قبل اختيار القسم المناسب.</p></div><div class="catalog-child-grid">${category.children.map((item) => childCard(category, item)).join("")}</div>`}
      </div></section>`;
  }

  function productPage() {
    const slug = decodeURIComponent(path.split("/").filter(Boolean)[1] || "");
    const product = state.products.find((item) => item.slug === slug);
    if (!product) return notFoundPage();
    const category = categoryBySlug(product.category);
    const child = childBySlug(category, product.subcategory);
    setTitle(product.name);
    const features = Array.isArray(product.features) && product.features.length
      ? product.features
      : ["حساب وإدارة موحدة", "إعداد واضح بعد الشراء", "إمكانية الترقية دون إعادة الشراء", "دعم ومتابعة من حساب UCHIHA"];
    const setupPath = `/create-store?service=${encodeURIComponent(product.slug)}`;
    const orderHref = state.user
      ? setupPath
      : `/login?next=${encodeURIComponent(setupPath)}`;
    return `
      <section class="product-page"><div class="unified-shell">
        ${breadcrumb([
          { href: "/", label: "الرئيسية" },
          { href: categoryHref(category), label: category.title },
          { href: categoryHref(category, child), label: child.title },
          { label: product.name }
        ])}
        <div class="product-page-layout">
          <div class="product-page-copy">
            ${product.badge ? `<span class="catalog-kicker">${escapeHtml(product.badge)}</span>` : '<span class="catalog-kicker">منتج UCHIHA</span>'}
            <h1>${escapeHtml(product.name)}</h1>
            <p>${escapeHtml(product.description)}</p>
            <ul>${features.slice(0, 8).map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul>
          </div>
          <aside class="product-order-card">
            <small>السعر الابتدائي</small><strong>${escapeHtml(money(product.priceMinor, product.currency))}</strong>
            <p>تظهر المتطلبات الدقيقة قبل تأكيد الطلب، ويُضاف المنتج إلى حسابك بعد الشراء.</p>
            <a class="catalog-primary-button" href="${escapeHtml(orderHref)}">${state.user ? "متابعة إعداد المنتج" : "تسجيل الدخول والطلب"}</a>
            <a class="catalog-secondary-button" href="${categoryHref(category, child)}">العودة إلى القسم</a>
          </aside>
        </div>
      </div></section>`;
  }

  function supportPage() {
    setTitle("الدعم");
    const contacts = state.portal?.contacts || [];
    const cards = contacts.map((contact) => {
      const target = contact.target || "";
      let href = "#";
      if (contact.type === "email") href = `mailto:${target}`;
      else if (contact.type === "phone") href = `tel:${target}`;
      else if (contact.type === "whatsapp") href = `https://wa.me/${String(target).replace(/\D/g, "")}`;
      else if (/^https:\/\//i.test(target)) href = target;
      else if (contact.type === "telegram" && target.startsWith("@")) href = `https://t.me/${target.slice(1)}`;
      return `<a class="support-channel-card" href="${escapeHtml(href)}"${href.startsWith("https://") ? ' target="_blank" rel="noopener"' : ""}><small>${escapeHtml(contact.type)}</small><h2>${escapeHtml(contact.name?.ar || contact.name?.en || "قناة دعم")}</h2><p>${escapeHtml(contact.description?.ar || contact.description?.en || "تواصل مع فريق الدعم.")}</p><b>فتح القناة ←</b></a>`;
    }).join("");
    return `
      <section class="catalog-page-head"><div class="unified-shell">${breadcrumb([{ href: "/", label: "الرئيسية" }, { label: "الدعم" }])}<span class="catalog-kicker">مركز الدعم</span><h1>الدعم من نفس الواجهة</h1><p>لا انتقال إلى تصميم قديم ولا صفحة مختلفة. اختر القناة المناسبة وتابع طلبك من حسابك.</p></div></section>
      <section class="catalog-section"><div class="unified-shell"><div class="support-grid">${cards || '<div class="catalog-empty"><b>لا توجد قناة دعم مفعلة حاليًا</b><p>ستظهر القنوات بعد تفعيلها من إدارة المنصة.</p></div>'}</div></div></section>`;
  }

  function paymentsPage() {
    setTitle("طرق الدفع");
    const methods = state.portal?.paymentMethods || [];
    return `
      <section class="catalog-page-head"><div class="unified-shell">${breadcrumb([{ href: "/", label: "الرئيسية" }, { label: "طرق الدفع" }])}<span class="catalog-kicker">الدفع</span><h1>طرق الدفع المتاحة</h1><p>تظهر بيانات الطريقة فقط عندما تكون مفعلة ومهيأة رسميًا.</p></div></section>
      <section class="catalog-section"><div class="unified-shell"><div class="payment-method-grid">${methods.length ? methods.map((method) => `<article class="payment-method-card"><small>${escapeHtml(method.status)}</small><h2>${escapeHtml(method.name?.ar || method.name?.en || method.key)}</h2><p>${escapeHtml([method.currency, method.network].filter(Boolean).join(" • "))}</p><b>${method.status === "active" ? "متاحة" : "غير مفعلة"}</b></article>`).join("") : '<div class="catalog-empty"><b>لم تُنشر طرق دفع بعد</b><p>لن نعرض بيانات وهمية أو غير مفعلة.</p></div>'}</div></div></section>`;
  }

  function apiPage() {
    setTitle("واجهات API");
    return `
      <section class="catalog-page-head"><div class="unified-shell">${breadcrumb([{ href: "/", label: "الرئيسية" }, { label: "واجهات API" }])}<span class="catalog-kicker">UCHIHA API</span><h1>تكاملات واضحة وآمنة</h1><p>المنتجات والطلبات والحالات تعمل من خلال عقود موحدة دون كشف أسرار المزود في الواجهة.</p></div></section>
      <section class="catalog-section"><div class="unified-shell"><div class="info-card-grid"><article><small>01</small><h2>كتالوج المنتجات</h2><p>قراءة الأقسام والمنتجات والحقول والأسعار وفق صلاحيات الشريك.</p></article><article><small>02</small><h2>الطلبات والحالات</h2><p>إنشاء موثوق مع Idempotency وتحديثات Webhook موقعة.</p></article><article><small>03</small><h2>ربط تلقائي</h2><p>الخدمات المتوافقة تتزامن مع لوحة المنتج بعد التفعيل.</p></article></div><a class="catalog-primary-button inline" href="/category/api-integrations">استعراض أقسام API</a></div></section>`;
  }

  function showcasePage() {
    setTitle("نماذج الأعمال");
    const items = state.portal?.portfolio || [];
    return `
      <section class="catalog-page-head"><div class="unified-shell">${breadcrumb([{ href: "/", label: "الرئيسية" }, { label: "نماذج الأعمال" }])}<span class="catalog-kicker">نماذج</span><h1>واجهات يمكن فتحها وتجربتها</h1><p>نعرض النماذج التجريبية بوضوح دون خلطها بمنتجات العملاء.</p></div></section>
      <section class="catalog-section"><div class="unified-shell"><div class="showcase-grid">${items.length ? items.map((item) => `<a href="${escapeHtml(item.targetUrl || "/store/demo")}" class="showcase-card"><small>${escapeHtml(item.type || "demo")}</small><h2>${escapeHtml(item.title?.ar || item.title?.en || "نموذج")}</h2><p>${escapeHtml(item.description?.ar || item.description?.en || "")}</p><b>فتح النموذج ←</b></a>`).join("") : '<a class="showcase-card" href="/store/demo"><small>نموذج تجريبي</small><h2>متجر UCHIHA التجريبي</h2><p>تجربة مستقلة لمعاينة المتجر والمنتجات والطلبات.</p><b>فتح النموذج ←</b></a>'}</div></div></section>`;
  }

  function authPage(mode) {
    const login = mode === "login";
    setTitle(login ? "تسجيل الدخول" : "إنشاء حساب");
    return `
      <section class="auth-page"><div class="unified-shell auth-page-layout">
        <div class="auth-page-copy"><span class="catalog-kicker">حساب UCHIHA</span><h1>${login ? "أهلاً بعودتك" : "أنشئ حسابك الموحّد"}</h1><p>${login ? "ادخل إلى منتجاتك ورصيدك وطلباتك من نفس الواجهة." : "حساب واحد لجميع البوتات والمواقع والتطبيقات والخدمات."}</p><a href="/">العودة إلى الرئيسية</a></div>
        <form class="auth-card" data-auth-form="${mode}">
          <div class="auth-notice" data-auth-notice hidden></div>
          ${login ? "" : '<label>الاسم الكامل<input name="displayName" autocomplete="name" required maxlength="120"></label>'}
          <label>البريد الإلكتروني<input name="email" type="email" autocomplete="email" required></label>
          <label>كلمة المرور<input name="password" type="password" autocomplete="${login ? "current-password" : "new-password"}" minlength="10" required></label>
          <button type="submit">${login ? "تسجيل الدخول" : "إنشاء الحساب"}</button>
          <p>${login ? 'ليس لديك حساب؟ <a href="/register">إنشاء حساب</a>' : 'لديك حساب؟ <a href="/login">تسجيل الدخول</a>'}</p>
        </form>
      </div></section>`;
  }

  function legalPage(kind) {
    const content = {
      about: ["عن UCHIHA Builder", "منصة تقنية تجمع الخدمات الرقمية ضمن حساب وإدارة موحدة."],
      privacy: ["سياسة الخصوصية", "نستخدم البيانات اللازمة لتشغيل الحساب والطلبات والخدمات، ولا نعرض الأسرار أو بيانات الدفع في الصفحات العامة."],
      terms: ["الشروط والأحكام", "يجب استخدام الخدمات بطريقة قانونية، وتُوضح حدود كل منتج ومدة تنفيذه قبل تأكيد الطلب."],
      refund: ["سياسة الاسترداد", "تختلف إمكانية الاسترداد حسب حالة التنفيذ والتجهيز ونوع المنتج الرقمي."]
    }[kind];
    setTitle(content[0]);
    return `<section class="catalog-page-head legal"><div class="unified-shell">${breadcrumb([{ href: "/", label: "الرئيسية" }, { label: content[0] }])}<h1>${content[0]}</h1><p>${content[1]}</p></div></section><section class="catalog-section"><div class="unified-shell"><article class="legal-card"><h2>معلومات واضحة</h2><p>${content[1]}</p><p>يتم تحديث التفاصيل عند اعتماد النسخة القانونية النهائية للمنصة.</p></article></div></section>`;
  }

  function notFoundPage() {
    setTitle("الصفحة غير موجودة");
    return `<section class="not-found-page"><div><small>404</small><h1>الصفحة غير موجودة</h1><p>الرابط غير صحيح أو تم نقل الصفحة إلى قسم جديد.</p><a class="catalog-primary-button" href="/services">فتح الأقسام</a></div></section>`;
  }

  function renderCurrentPage() {
    if (!pageMount) return;
    let html;
    if (path === "/") html = homePage();
    else if (path === "/services") html = servicesPage();
    else if (path.startsWith("/category/")) html = categoryPage();
    else if (path.startsWith("/product/")) html = productPage();
    else if (path === "/support") html = supportPage();
    else if (path === "/payment-methods") html = paymentsPage();
    else if (path === "/api-services") html = apiPage();
    else if (path === "/showcase") html = showcasePage();
    else if (path === "/login") html = authPage("login");
    else if (path === "/register") html = authPage("register");
    else if (path === "/about") html = legalPage("about");
    else if (path === "/privacy") html = legalPage("privacy");
    else if (path === "/terms") html = legalPage("terms");
    else if (path === "/refund-policy") html = legalPage("refund");
    else html = notFoundPage();
    pageMount.innerHTML = html;
    bindPageEvents();
  }

  function bindPageEvents() {
    document.querySelectorAll("[data-catalog-search]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const query = String(new FormData(form).get("q") || "").trim();
        location.assign(query ? `/services?q=${encodeURIComponent(query)}` : "/services");
      });
    });
    document.querySelector("[data-auth-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const mode = form.dataset.authForm;
      const button = form.querySelector('button[type="submit"]');
      const notice = form.querySelector("[data-auth-notice]");
      const data = Object.fromEntries(new FormData(form).entries());
      button.disabled = true;
      button.textContent = "جارٍ المتابعة...";
      notice.hidden = true;
      try {
        const result = await requestJson(`/api/auth/${mode}`, { method: "POST", body: data });
        if (result.csrfToken) sessionStorage.setItem("uchihaBuilderCsrf", result.csrfToken);
        const next = safeInternal(new URLSearchParams(location.search).get("next"), "/account");
        location.assign(next);
      } catch (error) {
        notice.hidden = false;
        notice.textContent = error.message;
        button.disabled = false;
        button.textContent = mode === "login" ? "تسجيل الدخول" : "إنشاء الحساب";
      }
    });
  }

  function applyBuilderCompatibility() {
    if (body.dataset.page !== "builder") return;
    body.classList.add("unified-platform-surface");
    if (path === "/create-store") body.classList.add("unified-create-route");
    if (["/login", "/register"].includes(path)) body.classList.add("unified-auth-route");
  }

  applyBuilderCompatibility();
  renderHeader();
  renderFooter();
  renderCurrentPage();
  loadPublicData();
})();
