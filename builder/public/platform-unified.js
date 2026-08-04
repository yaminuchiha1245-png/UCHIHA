(() => {
  "use strict";

  const path = location.pathname;
  const body = document.body;
  const root = document.documentElement;
  const headerMount = document.getElementById("siteHeader");
  const footerMount = document.getElementById("siteFooter");
  const builderTopbar = body.dataset.page === "builder" ? document.querySelector("body > .topbar") : null;

  const navItems = [
    { href: "/", label: "الرئيسية", match: ["/"] },
    { href: "/services", label: "الخدمات", match: ["/services"] },
    { href: "/account", label: "لوحة التحكم", match: ["/account"] },
    { href: "/payment-methods", label: "طرق الدفع", match: ["/payment-methods"] },
    { href: "/api-services", label: "واجهات API", match: ["/api-services"] },
    { href: "/support", label: "الدعم", match: ["/support"] }
  ];

  const state = {
    user: null,
    account: null,
    menuOpen: false,
    query: "",
    category: "all"
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function activeFor(item) {
    return item.match.some((candidate) => candidate === "/" ? path === "/" : path.startsWith(candidate));
  }

  function navHtml(mobile = false) {
    return navItems.map((item) => `
      <a href="${item.href}" class="${activeFor(item) ? "active" : ""}"${activeFor(item) ? ' aria-current="page"' : ""}>
        ${item.label}
      </a>`).join("");
  }

  function themeIcon() {
    return root.dataset.theme === "light"
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"></path><circle cx="12" cy="12" r="4"></circle></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A8.5 8.5 0 0 1 8.8 4a8.5 8.5 0 1 0 11.2 11.2Z"></path></svg>';
  }

  function headerActionsHtml() {
    const account = state.account;
    const user = state.user;
    const availableMinor = Number(account?.wallet?.availableMinor || 0);
    const currency = account?.wallet?.currency || "USD";
    const amount = `${(availableMinor / 100).toFixed(2)} ${currency}`;

    return `
      ${user ? `
        <a class="unified-wallet account-unified-header-wallet" href="/account#wallet" aria-label="فتح المحفظة">
          <span aria-hidden="true">▣</span>
          <span class="unified-wallet-copy"><small>الرصيد</small><b>${escapeHtml(amount)}</b></span>
        </a>
        <a class="unified-account-link header-create" href="/account">حسابي</a>
      ` : '<a class="unified-login header-login" href="/login">تسجيل الدخول</a>'}
      <button class="unified-theme-button" type="button" data-unified-theme aria-label="تبديل المظهر">${themeIcon()}</button>
      <button class="unified-mobile-toggle mobile-menu-toggle" type="button" data-unified-menu aria-label="فتح القائمة" aria-expanded="${state.menuOpen}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>
      </button>`;
  }

  function shellInnerHtml() {
    return `
      <div class="unified-shell unified-header-inner">
        <a class="unified-brand" href="/" aria-label="UCHIHA Builder">
          <img src="/assets/brand/platform-mark.svg" alt="">
          <span class="unified-brand-copy"><b>UCHIHA</b><small>Builder</small></span>
        </a>
        <nav class="unified-main-nav" aria-label="التنقل الرئيسي">${navHtml()}</nav>
        <div class="header-actions unified-header-actions">${headerActionsHtml()}</div>
      </div>
      <nav class="unified-mobile-panel${state.menuOpen ? " open" : ""}" aria-label="قائمة الهاتف">
        ${navHtml(true)}
        <a href="/account#wallet">المحفظة</a>
        ${state.user ? '<a href="/account">حسابي</a>' : '<a href="/login">تسجيل الدخول</a>'}
      </nav>`;
  }

  function renderHeader() {
    if (headerMount) {
      headerMount.className = "unified-site-header";
      headerMount.innerHTML = shellInnerHtml();
    }
    if (builderTopbar) {
      builderTopbar.innerHTML = shellInnerHtml();
      builderTopbar.classList.add("unified-site-header");
      const nestedHeader = builderTopbar.querySelector(".unified-shell");
      if (nestedHeader) nestedHeader.style.width = "100%";
    }
    bindHeaderControls();
  }

  function renderFooter() {
    if (!footerMount) return;
    footerMount.className = "unified-site-footer";
    footerMount.innerHTML = `
      <div class="unified-shell unified-footer-inner">
        <div class="unified-footer-copy">
          <img src="/assets/brand/platform-mark.svg" alt="">
          <div><b>UCHIHA Builder</b><small>منصة واحدة لمنتجاتك ومشاريعك الرقمية.</small></div>
        </div>
        <nav class="unified-footer-links" aria-label="روابط إضافية">
          <a href="/services">الخدمات</a>
          <a href="/payment-methods">طرق الدفع</a>
          <a href="/support">الدعم</a>
          <a href="/privacy">الخصوصية</a>
          <a href="/terms">الشروط</a>
        </nav>
      </div>`;
  }

  function toggleTheme() {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    root.style.colorScheme = next;
    try {
      localStorage.setItem("uchiha-ui-theme", next);
    } catch {
      // Theme remains active for this page.
    }
    document.querySelectorAll("[data-unified-theme]").forEach((button) => {
      button.innerHTML = themeIcon();
    });
  }

  function bindHeaderControls() {
    document.querySelectorAll("[data-unified-theme]").forEach((button) => {
      button.onclick = toggleTheme;
    });
    document.querySelectorAll("[data-unified-menu]").forEach((button) => {
      button.onclick = () => {
        state.menuOpen = !state.menuOpen;
        renderHeader();
      };
    });
  }

  async function requestJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(url, { credentials: "same-origin", signal: controller.signal });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadSession() {
    const me = await requestJson("/api/me");
    if (!me?.user) return;
    state.user = me.user;
    const accountPayload = await requestJson("/api/platform/account");
    state.account = accountPayload?.account || null;
    renderHeader();
  }

  function applyRouteClasses() {
    if (body.dataset.page !== "builder") return;
    body.classList.add("unified-platform-surface");
    if (["/login", "/register"].includes(path)) body.classList.add("unified-auth-route");
    if (path === "/create-store") body.classList.add("unified-create-route");

    const introTitle = document.querySelector(".builder-intro h2");
    const introText = document.querySelector(".builder-intro p");
    if (path === "/login") {
      if (introTitle) introTitle.textContent = "أهلاً بعودتك إلى UCHIHA";
      if (introText) introText.textContent = "سجّل الدخول للوصول إلى منتجاتك ومشاريعك ورصيدك من مكان واحد.";
    } else if (path === "/register") {
      if (introTitle) introTitle.textContent = "ابدأ حسابك الموحّد";
      if (introText) introText.textContent = "حساب واحد لشراء وإدارة البوتات والمواقع والتطبيقات والخدمات الرقمية.";
    } else if (path === "/create-store") {
      if (introTitle) introTitle.textContent = "جهّز مشروعك بخطوات واضحة";
      if (introText) introText.textContent = "اختر الخدمة وأكمل متطلباتها، وسنحفظ تقدمك داخل نفس الحساب.";
    }
  }

  function serviceCards() {
    return [...document.querySelectorAll("#unifiedServicesGrid .unified-service-card")];
  }

  function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase("ar");
  }

  function runFilter({ scroll = false } = {}) {
    const cards = serviceCards();
    if (!cards.length) return;
    const query = normalize(state.query);
    let visible = 0;
    for (const card of cards) {
      const categoryMatch = state.category === "all" || card.dataset.category === state.category;
      const queryMatch = !query || normalize(card.dataset.search || card.textContent).includes(query);
      const show = categoryMatch && queryMatch;
      card.hidden = !show;
      if (show) visible += 1;
    }

    document.querySelectorAll("[data-category-filter]").forEach((button) => {
      button.classList.toggle("active", button.dataset.categoryFilter === state.category);
    });
    document.querySelectorAll(".unified-category-card[data-category]").forEach((button) => {
      button.classList.toggle("active", button.dataset.category === state.category);
    });

    const categorySelect = document.getElementById("unifiedSearchCategory");
    if (categorySelect) categorySelect.value = state.category;
    const status = document.getElementById("unifiedSearchStatus");
    if (status) {
      status.hidden = visible > 0 && !query;
      if (visible === 0) {
        status.hidden = false;
        status.textContent = "لا توجد خدمة مطابقة. جرّب عبارة أخرى أو اختر جميع الأقسام.";
      } else if (query) {
        status.hidden = false;
        status.textContent = `تم العثور على ${visible} خدمة مطابقة.`;
      }
    }
    if (scroll) document.getElementById("services")?.scrollIntoView({ block: "start" });
  }

  function bindHome() {
    const form = document.getElementById("unifiedSearchForm");
    const input = document.getElementById("unifiedSearchInput");
    const select = document.getElementById("unifiedSearchCategory");
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        state.query = input?.value || "";
        state.category = select?.value || "all";
        runFilter({ scroll: true });
      });
    }
    input?.addEventListener("input", () => {
      state.query = input.value;
      runFilter();
    });
    select?.addEventListener("change", () => {
      state.category = select.value;
      runFilter();
    });

    document.getElementById("unifiedCategoryGrid")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      state.category = button.dataset.category;
      state.query = "";
      if (input) input.value = "";
      runFilter({ scroll: true });
    });

    document.getElementById("unifiedSubcategories")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-category-filter]");
      if (!button) return;
      state.category = button.dataset.categoryFilter;
      runFilter({ scroll: true });
    });
  }

  function closeMenuOnNavigation() {
    document.addEventListener("click", (event) => {
      const link = event.target.closest(".unified-mobile-panel a");
      if (!link) return;
      state.menuOpen = false;
    });
  }

  applyRouteClasses();
  renderHeader();
  renderFooter();
  bindHome();
  closeMenuOnNavigation();
  loadSession();
})();
