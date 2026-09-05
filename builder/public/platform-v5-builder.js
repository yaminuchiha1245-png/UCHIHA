(() => {
  "use strict";

  if (document.body?.dataset.page !== "builder" || location.pathname !== "/create-store") return;

  const body = document.body;
  const topbar = document.querySelector("body > .topbar");
  if (!topbar) return;

  const state = {
    user: null,
    account: null,
    csrfToken: "",
    drawerOpen: false
  };

  const icon = (name) => ({
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8"></path><path d="M5 10v10h14V10M9 20v-6h6v6"></path></svg>',
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>',
    wallet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h15a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13"></path><path d="M16 11h5v4h-5a2 2 0 0 1 0-4Z"></path></svg>',
    orders: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18H6z"></path><path d="M9 7h6M9 11h6M9 15h4"></path></svg>',
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg>',
    support: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13v-2a8 8 0 0 1 16 0v2"></path><path d="M4 13H2v5h4v-5H4ZM20 13h2v5h-4v-5h2ZM18 18c0 2-2 3-5 3"></path></svg>',
    logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 8 6 12l4 4M6 12h12"></path><path d="M14 4h6v16h-6"></path></svg>'
  }[name] || "");

  const money = (minor, currency = "USD") => {
    try {
      return new Intl.NumberFormat("ar", { style: "currency", currency }).format(Number(minor || 0) / 100);
    } catch {
      return `${(Number(minor || 0) / 100).toFixed(2)} ${currency}`;
    }
  };

  async function requestJson(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  function drawerLink(href, label, iconName) {
    return `<a class="v5-drawer-link" href="${href}"><span class="v5-icon">${icon(iconName)}</span><span>${label}</span></a>`;
  }

  function render() {
    body.classList.add("uchiha-v5", "v5-builder-route");
    topbar.className = "topbar v5-header";
    topbar.innerHTML = `
      <div class="v5-shell v5-header-inner">
        <button class="v5-menu-button" type="button" data-builder-drawer-open aria-label="فتح القائمة" aria-expanded="${state.drawerOpen}">${icon("menu")}</button>
        <a class="v5-brand" href="/"><img src="/assets/brand/platform-mark.svg" alt=""><b>UCHIHA</b></a>
        <div class="v5-header-side">
          ${state.user
            ? `<a class="v5-header-wallet" href="/account#wallet"><span>${money(state.account?.wallet?.availableMinor, state.account?.wallet?.currency)}</span></a>`
            : '<a class="v5-header-login" href="/login"><span>دخول</span></a>'}
        </div>
      </div>`;

    let drawerRoot = document.getElementById("appDrawerRoot");
    if (!drawerRoot) {
      drawerRoot = document.createElement("div");
      drawerRoot.id = "appDrawerRoot";
      topbar.after(drawerRoot);
    }
    drawerRoot.innerHTML = `
      <div class="v5-drawer-overlay${state.drawerOpen ? " open" : ""}" data-builder-drawer-overlay>
        <aside class="v5-drawer" aria-label="القائمة الجانبية">
          <div class="v5-drawer-head">
            <div class="v5-drawer-brand"><img src="/assets/brand/platform-mark.svg" alt=""><b>UCHIHA</b></div>
            <button class="v5-drawer-close" type="button" data-builder-drawer-close aria-label="إغلاق القائمة">×</button>
          </div>
          <nav class="v5-drawer-nav">
            ${drawerLink("/", "الرئيسية", "home")}
            ${drawerLink("/add-balance", "إضافة رصيد", "wallet")}
            ${drawerLink("/services", "الأقسام", "grid")}
            ${drawerLink("/orders", "طلباتي", "orders")}
            ${drawerLink("/account", "حسابي", "user")}
            ${drawerLink("/support", "الدعم", "support")}
          </nav>
          ${state.user ? `<div class="v5-drawer-foot"><button class="v5-drawer-logout" type="button" data-builder-logout><span class="v5-icon">${icon("logout")}</span><span>تسجيل الخروج</span></button></div>` : ""}
        </aside>
      </div>`;

    let bottom = document.getElementById("bottomNav");
    if (!bottom) {
      bottom = document.createElement("nav");
      bottom.id = "bottomNav";
      bottom.className = "v5-bottom-nav";
      bottom.setAttribute("aria-label", "التنقل السريع");
      body.append(bottom);
    }
    bottom.innerHTML = `
      <a href="/">${icon("home")}<span>الرئيسية</span></a>
      <a href="/services">${icon("grid")}<span>الأقسام</span></a>
      <a href="/orders">${icon("orders")}<span>طلباتي</span></a>
      <a href="/account">${icon("user")}<span>حسابي</span></a>`;

    bind();
  }

  function openDrawer() {
    state.drawerOpen = true;
    body.classList.add("v5-drawer-open");
    render();
    document.querySelector("[data-builder-drawer-close]")?.focus();
  }

  function closeDrawer() {
    state.drawerOpen = false;
    body.classList.remove("v5-drawer-open");
    render();
  }

  async function logout(button) {
    button.disabled = true;
    await requestJson("/api/auth/logout", {
      method: "POST",
      headers: { "x-csrf-token": state.csrfToken }
    }).catch(() => null);
    location.assign("/login");
  }

  function bind() {
    document.querySelector("[data-builder-drawer-open]")?.addEventListener("click", openDrawer);
    document.querySelector("[data-builder-drawer-close]")?.addEventListener("click", closeDrawer);
    document.querySelector("[data-builder-drawer-overlay]")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeDrawer();
    });
    document.querySelector("[data-builder-logout]")?.addEventListener("click", (event) => logout(event.currentTarget));
  }

  async function loadSession() {
    const me = await requestJson("/api/me");
    if (!me?.user) return;
    state.user = me.user;
    state.csrfToken = me.csrfToken || "";
    const account = await requestJson("/api/platform/account");
    state.account = account?.account || null;
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.drawerOpen) closeDrawer();
  });

  render();
  loadSession().finally(render);
})();
