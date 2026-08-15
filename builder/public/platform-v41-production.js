(() => {
  "use strict";

  const body = document.body;
  if (!body) return;
  body.classList.add("uchiha-production");

  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const icons = {
    bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0v4l2 3H4l2-3Z"></path><path d="M10 20h4"></path></svg>',
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path><path d="M12 2 4 5v6c0 5 3 8 8 11 5-3 8-6 8-11V5Z"></path></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>',
    headset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13v-2a8 8 0 0 1 16 0v2"></path><path d="M4 13H2v5h4v-5H4ZM20 13h2v5h-4v-5h2ZM18 18c0 2-2 3-5 3"></path></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8"></path><path d="M5 10v10h14V10M9 20v-6h6v6"></path></svg>',
    wallet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h15a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13"></path><path d="M16 11h5v4h-5a2 2 0 0 1 0-4Z"></path></svg>',
    orders: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18H6z"></path><path d="M9 7h6M9 11h6M9 15h4"></path></svg>',
    payment: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 9h18M7 15h4"></path></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"></circle><circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="19" r="2.5"></circle><path d="m8.2 10.8 7.5-4.3M8.2 13.2l7.5 4.3"></path></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 1-12.7 6.5L3 19l1.4-4A8 8 0 1 1 20 11Z"></path><path d="M8.5 8.5c.7 2.8 2.2 4.5 5 5"></path></svg>',
    store: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v10h16V10M3 10l2-6h14l2 6"></path><path d="M3 10a3 3 0 0 0 5 2 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 5-2M9 20v-5h6v5"></path></svg>'
  };

  const categoryItems = [
    { href: "/category/telegram-bots", name: "البوتات", desc: "تيليجرام وأتمتة", count: "3 خدمات", tone: "purple", image: "/assets/catalog-assets/social-service.svg" },
    { href: "/category/mobile-apps", name: "التطبيقات", desc: "Android و iOS", count: "3 خدمات", tone: "blue", image: "/assets/marketing-assets/slide-apps.svg" },
    { href: "/category/websites", name: "المواقع", desc: "مواقع احترافية", count: "3 خدمات", tone: "cyan", image: "/assets/catalog-assets/programming.svg" },
    { href: "/create-store", name: "المتاجر", desc: "متجر جاهز للبيع", count: "3 خدمات", tone: "red", image: "/assets/marketing-assets/showcase-store.svg" },
    { href: "/category/hosting-domains/domains", name: "الدومينات", desc: "اسم مشروعك", count: "3 خدمات", tone: "amber", image: "/assets/marketing-assets/slide-infrastructure.svg" },
    { href: "/category/hosting-domains/website-hosting", name: "الاستضافات", desc: "سريعة وآمنة", count: "3 خدمات", tone: "green", image: "/assets/marketing-assets/slide-infrastructure.svg" }
  ];

  let portalPromise = null;
  let accountStatePromise = null;
  let scheduled = false;

  async function json(url) {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  function portal() {
    if (!portalPromise) portalPromise = json("/api/public/portal").catch(() => null);
    return portalPromise;
  }

  function accountState() {
    if (!accountStatePromise) {
      accountStatePromise = (async () => {
        const me = await json("/api/me");
        if (!me?.user) return { user: null, orders: [], account: null };
        const [ordersPayload, accountPayload] = await Promise.all([
          json("/api/platform/orders").catch(() => null),
          json("/api/platform/account").catch(() => null)
        ]);
        return {
          user: me.user,
          orders: Array.isArray(ordersPayload?.orders) ? ordersPayload.orders : [],
          account: accountPayload?.account || null
        };
      })().catch(() => ({ user: null, orders: [], account: null }));
    }
    return accountStatePromise;
  }

  function removePreviewArtifacts() {
    document.querySelectorAll(".uchiha-preview-banner,[data-v41-demo-badge],.v41-demo-badge").forEach((node) => node.remove());
    if (/v41|final demo|demo/i.test(document.title) && location.pathname === "/") document.title = "UCHIHA Builder";
  }

  function enhanceHeader() {
    const inner = $(".v5-header-inner");
    if (!inner) return;
    const brand = $(".v5-brand", inner);
    if (brand) {
      brand.setAttribute("aria-label", "UCHIHA Builder");
      const b = $("b", brand);
      if (b && b.textContent.trim() !== "UCHIHA Builder") b.innerHTML = "UCHIHA <span>Builder</span>";
    }
    if (!$(".v41-bell", inner)) {
      const side = $(".v5-header-side", inner);
      if (side) {
        const bell = document.createElement("a");
        bell.className = "v41-bell";
        bell.href = "/account#notifications";
        bell.setAttribute("aria-label", "الإشعارات");
        bell.innerHTML = `${icons.bell}<span class="v41-bell-badge" hidden>0</span>`;
        side.before(bell);
        accountState().then((state) => {
          const unread = Number(state.account?.notifications?.unreadCount || state.account?.unreadNotifications || 0);
          const badge = $(".v41-bell-badge", bell);
          if (badge && unread > 0) {
            badge.textContent = String(Math.min(unread, 99));
            badge.hidden = false;
          }
        });
      }
    }
  }

  function heroMarkup() {
    return `<a class="v41-hero-link" href="/create-store">
      <span class="v41-hero-copy"><small>UCHIHA STORES</small><b>متجر مرتب وجاهز للبيع</b><span>موقع وبوت وإدارة موحّدة بدون تعقيد.</span></span>
      <span class="v41-hero-art" aria-hidden="true">${icons.store}</span>
    </a>`;
  }

  function categoryMarkup(item) {
    return `<a class="v5-category-card" data-v41-tone="${item.tone}" href="${item.href}">
      <span class="v5-card-media v5-category-media" aria-hidden="true"><img src="${item.image}" alt="" loading="lazy" decoding="async"></span>
      <span class="v5-category-name">${item.name}</span>
      <small class="v41-cat-desc">${item.desc}</small>
      <i class="v41-cat-count">${item.count}</i>
    </a>`;
  }

  function injectStatusCard(hero) {
    const parent = hero?.parentElement;
    if (!parent || $(".v41-status-card", parent)) return;
    const card = document.createElement("section");
    card.className = "v41-status-card";
    card.setAttribute("aria-live", "polite");
    card.innerHTML = `<span class="v41-status-icon">${icons.user}</span><span class="v41-status-copy"><small>مرحبًا بك</small><b>جاري تحميل حالة حسابك…</b></span><a class="v41-status-action" href="/orders">متابعة الطلبات</a>`;
    hero.after(card);
    accountState().then((state) => {
      if (!card.isConnected) return;
      const copy = $(".v41-status-copy", card);
      const action = $(".v41-status-action", card);
      if (!state.user) {
        copy.innerHTML = "<small>مرحبًا بك في UCHIHA</small><b>سجّل الدخول لمتابعة طلباتك ومحفظتك</b>";
        action.href = "/login";
        action.textContent = "تسجيل الدخول";
        return;
      }
      const active = state.orders.filter((order) => !["completed", "rejected", "cancelled"].includes(String(order.status || "").toLowerCase())).length;
      const name = state.user.displayName || state.account?.user?.displayName || "بك";
      copy.innerHTML = `<small>مرحبًا ${escapeHtml(name)}</small><b>${active ? `لديك ${active} ${active === 1 ? "طلب قيد المتابعة" : "طلبات قيد المتابعة"}` : "لا توجد طلبات معلّقة حاليًا"}</b>`;
    });
  }

  function injectTrust(search) {
    const parent = search?.parentElement;
    if (!parent || $(".v41-trust", parent)) return;
    const trust = document.createElement("div");
    trust.className = "v41-trust";
    trust.innerHTML = `
      <span class="v41-trust-item">${icons.check}<b>تنفيذ موثوق</b></span>
      <span class="v41-trust-item">${icons.clock}<b>متابعة واضحة</b></span>
      <a class="v41-trust-item" href="/support" style="text-decoration:none">${icons.headset}<b>محادثة مباشرة</b></a>`;
    search.after(trust);
  }

  function enhanceHome() {
    if ((location.pathname.replace(/\/+$/, "") || "/") !== "/") return;
    const mount = $("#platformPage");
    if (!mount) return;

    const hero = $(".v5-home-slider", mount) || $(".v41-hero", mount);
    if (hero && !hero.classList.contains("v41-hero")) {
      hero.className = "v41-hero";
      hero.removeAttribute("data-home-slider");
      hero.innerHTML = heroMarkup();
    }
    if (hero) injectStatusCard(hero);

    const search = $(".v5-search", mount);
    if (search) {
      const input = $("input", search);
      if (input) input.placeholder = "إبحث عن خدمة أو مشروع…";
      injectTrust(search);
    }

    const section = $(".v5-home-categories", mount);
    if (section && section.dataset.v41HomeCategories !== "true") {
      section.dataset.v41HomeCategories = "true";
      const head = $(".v5-section-title", section);
      if (head) head.innerHTML = '<div><p>ابدأ من هنا</p><h2>خدمات المنصة</h2></div><a href="/services">عرض الكل</a>';
      const grid = $(".v5-category-grid", section);
      if (grid) grid.innerHTML = categoryItems.map(categoryMarkup).join("");
    }
  }

  function enhanceBottomNav() {
    const nav = $("#bottomNav");
    if (!nav || nav.dataset.v41Enhanced === "true") return;
    nav.dataset.v41Enhanced = "true";
    const path = location.pathname.replace(/\/+$/, "") || "/";
    const items = [
      { key: "payment", href: "/add-balance", label: "الدفع", icon: icons.payment, active: path.startsWith("/add-balance") },
      { key: "orders", href: "/orders", label: "طلباتي", icon: icons.orders, active: path.startsWith("/orders") },
      { key: "home", href: "/", label: "الرئيسية", icon: icons.home, active: path === "/" },
      { key: "wallet", href: "/account#wallet", label: "المحفظة", icon: icons.wallet, active: path === "/account" && location.hash === "#wallet" },
      { key: "account", href: "/account", label: "حسابي", icon: icons.user, active: path === "/account" && location.hash !== "#wallet" }
    ];
    nav.innerHTML = items.map((item) => `<a data-v41-nav="${item.key}" href="${item.href}"${item.active ? ' class="active" aria-current="page"' : ""}>${item.icon}<span>${item.label}</span></a>`).join("");
  }

  function whatsappHref(contact) {
    const target = String(contact?.target || "");
    const digits = target.replace(/\D/g, "");
    if (!digits) return "/support";
    const message = contact?.messageTemplate?.ar || "مرحبًا، أريد الاستفسار عن خدمات UCHIHA";
    return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  }

  function enhanceFloating() {
    if ($(".v41-floating")) return;
    const floating = document.createElement("div");
    floating.className = "v41-floating";
    floating.innerHTML = `<button class="v41-float share" type="button" aria-label="مشاركة UCHIHA">${icons.share}</button><a class="v41-float whatsapp" href="/support" aria-label="مركز المحادثة">${icons.chat}</a>`;
    body.append(floating);

    $(".v41-float.share", floating)?.addEventListener("click", async () => {
      const data = { title: "UCHIHA Builder", text: "UCHIHA Builder — خدمات وبرمجة ومتاجر رقمية", url: location.origin };
      try {
        if (navigator.share) await navigator.share(data);
        else await navigator.clipboard.writeText(location.origin);
      } catch { /* user cancelled or clipboard is unavailable */ }
    });

    portal().then((payload) => {
      const contact = (payload?.contacts || []).find((item) => item.status === "active" && item.type === "whatsapp");
      if (!contact || !floating.isConnected) return;
      const link = $(".v41-float.whatsapp", floating);
      link.href = whatsappHref(contact);
      link.target = "_blank";
      link.rel = "noopener";
    });
  }

  function enhance() {
    scheduled = false;
    removePreviewArtifacts();
    enhanceHeader();
    enhanceHome();
    enhanceBottomNav();
    enhanceFloating();
  }

  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(enhance);
  }

  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", () => {
    const nav = $("#bottomNav");
    if (nav) delete nav.dataset.v41Enhanced;
    scheduleEnhance();
  });
  window.addEventListener("pageshow", scheduleEnhance);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enhance, { once: true });
  else enhance();
})();
