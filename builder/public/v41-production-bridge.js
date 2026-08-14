(() => {
  "use strict";

  const RELEASE = "2026.08.14.3";
  const DEMO_STORAGE_KEY = "uchiha-platform-v19-demo";
  const SYNC_INTERVAL_MS = 60000;
  const PAGE_ROUTES = Object.freeze({
    auth: "/login",
    account: "/account",
    "account-edit": "/account",
    wallet: "/add-balance",
    orders: "/orders",
    "order-detail": "/orders",
    payments: "/payment-methods",
    payment: "/payment-methods",
    builder: "/create-store",
    support: "/support",
    notifications: "/account",
    pricing: "/services",
    search: "/services",
    all: "/services",
    domain: "/category/hosting-domains",
    about: "/about"
  });

  const CATEGORY_ROUTES = Object.freeze({
    bots: "/category/telegram-bots",
    apps: "/category/mobile-apps",
    websites: "/category/websites",
    stores: "/create-store",
    domains: "/category/hosting-domains/domains",
    hosting: "/category/hosting-domains"
  });

  const ACTION_ROUTES = Object.freeze({
    "demo-admin-launch": "/platform-admin",
    "confirm-review": "/services",
    "retry-payment": "/orders",
    "accept-quote": "/orders",
    "domain-buy": "/category/hosting-domains",
    "order-detail": "/orders"
  });

  const FORM_ROUTES = Object.freeze({
    loginForm: "/login",
    registerForm: "/register",
    requestForm: "/services",
    paymentForm: "/payment-methods",
    accountEditForm: "/account",
    orderInfoForm: "/orders"
  });

  const productionContacts = new Map();
  let productionBanners = [];
  let portalReady = false;
  let accountReady = false;
  let accountResolved = false;
  let initialRouteApplied = false;
  let syncTimer = null;
  let syncInFlight = null;
  let serviceRequestInFlight = false;
  let bannerObserver = null;

  function safeRoute(value, fallback = "/") {
    const route = String(value || "");
    if (!route.startsWith("/") || route.startsWith("//") || route.includes("..")) return fallback;
    return route;
  }

  function navigate(route) {
    window.location.assign(safeRoute(route));
  }

  function productionRuntime() {
    const runtime = window.__UCHIHA_V41_RUNTIME__;
    if (!runtime || String(runtime.release || "") !== RELEASE) return null;
    if (typeof runtime.setGuest !== "function" || typeof runtime.setAccount !== "function") return null;
    return runtime;
  }

  function canBrowseInsideV41(action, page) {
    const runtime = productionRuntime();
    const hasPortalSync = Boolean(runtime && typeof runtime.syncPortal === "function");
    if (!hasPortalSync) return false;
    if ((action === "category" || action === "service") && portalReady) return true;
    if ((action === "go" || action === "push") && portalReady && ["all", "search", "payments"].includes(page)) return true;
    if ((action === "go" || action === "push") && accountResolved && page === "orders") return true;
    return false;
  }

  function productionRouteForAction(element) {
    const action = element.getAttribute("data-action") || "";
    const page = element.getAttribute("data-page") || "";
    const id = element.getAttribute("data-id") || "";
    if (canBrowseInsideV41(action, page)) return null;
    if (ACTION_ROUTES[action]) return ACTION_ROUTES[action];
    if (action === "category") return CATEGORY_ROUTES[id] || "/services";
    if (action === "service") return "/services";
    if (page.startsWith("admin-")) return "/platform-admin";
    if ((action === "go" || action === "push") && PAGE_ROUTES[page]) return PAGE_ROUTES[page];
    if (action === "request") return "/services";
    return null;
  }

  function clearLegacyDemoStorage() {
    try {
      window.localStorage.removeItem(DEMO_STORAGE_KEY);
    } catch {
      // Storage may be unavailable; production state remains server-authoritative.
    }
  }

  function installManifestLink() {
    const existing = document.querySelector('link[rel="manifest"]');
    const link = existing || document.createElement("link");
    link.rel = "manifest";
    link.href = "/assets/manifest.webmanifest";
    if (!existing) document.head.append(link);
  }

  function registerProductionServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost") return;
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register(`/sw.js?v=${RELEASE}`, { scope: "/", updateViaCache: "none" })
        .catch(() => undefined);
    }, { once: true });
  }

  function contactUrl(contact) {
    const type = String(contact?.type || "").trim().toLowerCase();
    const target = String(contact?.target || "").trim();
    if (!target) return "";
    if (/^https:\/\//i.test(target)) return target;
    if (/^http:\/\//i.test(target)) return "";

    if (type === "whatsapp") {
      const digits = target.replace(/\D/g, "");
      if (!digits) return "";
      const message = String(contact?.messageTemplate?.ar || contact?.messageTemplate?.en || "").trim();
      return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
    }

    const username = target.replace(/^@/, "").trim();
    if (!username || username.includes("/")) return "";
    const base = {
      telegram: "https://t.me/",
      instagram: "https://www.instagram.com/",
      facebook: "https://www.facebook.com/",
      tiktok: "https://www.tiktok.com/@",
      youtube: "https://www.youtube.com/@"
    }[type];
    return base ? `${base}${encodeURIComponent(username)}` : "";
  }

  function applyProductionContacts(portal) {
    const contacts = Array.isArray(portal?.contacts) ? portal.contacts : [];
    productionContacts.clear();
    for (const contact of contacts) {
      if (contact?.status !== "active") continue;
      const type = String(contact?.type || "").trim().toLowerCase();
      const url = contactUrl(contact);
      if (type && url && !productionContacts.has(type)) productionContacts.set(type, url);
    }
  }

  function localizedText(value, fallback = "") {
    if (value && typeof value === "object") return String(value.ar || value.en || fallback || "").trim();
    return String(value || fallback || "").trim();
  }

  function safeBannerAsset(value) {
    const url = String(value || "").trim();
    if (/^https:\/\//i.test(url)) return url;
    if (/^\/(?:assets|uploads)\//i.test(url) && !url.includes("..")) return url;
    if (url.length <= 750000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(url)) return url;
    return "";
  }

  function safeBannerLink(value) {
    const url = String(value || "").trim();
    if (/^https:\/\//i.test(url)) return url;
    if (url.startsWith("/") && !url.startsWith("//") && !url.includes("..")) return url;
    return "";
  }

  function bannerFingerprint(items) {
    return items.map((item) => [item.id, item.title, item.subtitle, item.image, item.href].join("|")).join("||");
  }

  function createBannerSlide(item, tone) {
    const article = document.createElement("article");
    article.className = `slide ${tone}`;
    article.dataset.action = "production-banner";
    if (item.href) article.dataset.href = item.href;

    const copy = document.createElement("div");
    copy.className = "slideCopy";
    const small = document.createElement("small");
    small.textContent = item.action || "UCHIHA";
    const title = document.createElement("b");
    title.textContent = item.title || "UCHIHA";
    const subtitle = document.createElement("span");
    subtitle.textContent = item.subtitle || "";
    copy.append(small, title, subtitle);
    article.append(copy);

    const art = document.createElement("div");
    art.className = "slideArt";
    if (item.image) {
      const image = document.createElement("img");
      image.src = item.image;
      image.alt = item.title || "UCHIHA";
      image.loading = "eager";
      image.decoding = "async";
      image.style.width = "100%";
      image.style.height = "100%";
      image.style.objectFit = "cover";
      image.style.borderRadius = "inherit";
      art.append(image);
    } else {
      const mark = document.createElement("strong");
      mark.textContent = "UCHIHA";
      art.append(mark);
    }
    article.append(art);
    return article;
  }

  function renderProductionBanners() {
    const track = document.getElementById("slides");
    if (!track || !productionBanners.length) return;
    const fingerprint = bannerFingerprint(productionBanners);
    if (track.dataset.productionBannerFingerprint === fingerprint) return;

    const tones = ["red", "blue", "green"];
    const logical = Array.from({ length: 3 }, (_, index) => productionBanners[index % productionBanners.length]);
    const slides = logical.map((item, index) => createBannerSlide(item, tones[index]));
    const sequence = [slides[2].cloneNode(true), slides[0], slides[1], slides[2], slides[0].cloneNode(true)];
    track.replaceChildren(...sequence);
    track.dataset.productionBannerFingerprint = fingerprint;
  }

  function syncProductionBanners(portal) {
    const rows = Array.isArray(portal?.banners) ? portal.banners : [];
    productionBanners = rows
      .filter((row) => row?.status === "active")
      .sort((a, b) => Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0))
      .slice(0, 3)
      .map((row) => ({
        id: String(row?.id || ""),
        title: localizedText(row?.title, "UCHIHA"),
        subtitle: localizedText(row?.subtitle, ""),
        action: localizedText(row?.actionLabel, "UCHIHA"),
        image: safeBannerAsset(row?.imageUrl),
        href: safeBannerLink(row?.linkUrl)
      }));
    renderProductionBanners();
  }

  function installBannerObserver() {
    if (bannerObserver || typeof MutationObserver === "undefined") return;
    bannerObserver = new MutationObserver(() => renderProductionBanners());
    const mount = document.getElementById("main") || document.body;
    bannerObserver.observe(mount, { childList: true, subtree: true });
  }

  function openProductionBanner(element) {
    const href = safeBannerLink(element?.dataset?.href || "");
    if (!href) return;
    if (href.startsWith("/")) navigate(href);
    else window.open(href, "_blank", "noopener,noreferrer");
  }

  function routeNeedsPortal(pathname) {
    return pathname === "/services" || pathname === "/services.html" ||
      pathname === "/payment-methods" || pathname === "/payment-methods.html" ||
      pathname.startsWith("/category/") || pathname.startsWith("/product/");
  }

  function routeNeedsAccount(pathname) {
    return pathname === "/orders";
  }

  function maybeApplyInitialRoute() {
    if (initialRouteApplied) return;
    const runtime = productionRuntime();
    if (!runtime || typeof runtime.openRoute !== "function") return;
    const pathname = location.pathname.replace(/\/+$/, "") || "/";
    if (pathname === "/" || pathname === "/index.html") {
      initialRouteApplied = true;
      return;
    }
    if (routeNeedsPortal(pathname) && !portalReady) return;
    if (routeNeedsAccount(pathname) && !accountResolved) return;
    if (runtime.openRoute(pathname) !== false) initialRouteApplied = true;
  }

  async function hydrateProductionPortal() {
    try {
      const response = await fetch("/api/public/portal", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" }
      });
      if (!response.ok) {
        portalReady = false;
        return false;
      }
      const portal = await response.json();
      applyProductionContacts(portal);
      syncProductionBanners(portal);
      const runtime = productionRuntime();
      if (!runtime || typeof runtime.syncPortal !== "function") {
        portalReady = false;
        return false;
      }
      portalReady = runtime.syncPortal(portal) !== false;
      renderProductionBanners();
      clearLegacyDemoStorage();
      maybeApplyInitialRoute();
      return portalReady;
    } catch {
      portalReady = false;
      productionContacts.clear();
      return false;
    }
  }

  function openProductionContact(type) {
    const url = productionContacts.get(String(type || "").toLowerCase()) || "";
    if (!url) {
      navigate("/support");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function productionCsrfToken() {
    let token = "";
    try {
      token = window.sessionStorage.getItem("uchihaBuilderCsrf") || "";
    } catch {
      token = "";
    }
    try {
      const response = await fetch("/api/me", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" }
      });
      if (response.ok) {
        const payload = await response.json();
        token = String(payload?.csrfToken || token || "");
      }
    } catch {
      // The sessionStorage token can still complete logout when /api/me is interrupted.
    }
    return token;
  }

  async function logoutProductionSession() {
    let loggedOut = false;
    try {
      const token = await productionCsrfToken();
      const headers = { accept: "application/json" };
      if (token) headers["x-csrf-token"] = token;
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers
      });
      loggedOut = response.ok || response.status === 401;
    } catch {
      loggedOut = false;
    }

    if (loggedOut) {
      try {
        window.sessionStorage.removeItem("uchihaBuilderCsrf");
      } catch {
        // Session cookie is authoritative; clearing the cached CSRF token is best effort.
      }
      clearLegacyDemoStorage();
      window.location.assign("/login");
      return;
    }

    window.location.assign("/account");
  }

  function applyProductionAccount(account, orders) {
    const runtime = productionRuntime();
    if (!runtime || !account) return false;
    const apply = typeof runtime.syncAccount === "function" ? runtime.syncAccount : runtime.setAccount;
    const applied = apply.call(runtime, account, orders) !== false;
    accountReady = applied;
    accountResolved = true;
    clearLegacyDemoStorage();
    maybeApplyInitialRoute();
    return applied;
  }

  async function hydrateProductionAccount({ initial = false } = {}) {
    try {
      const accountResponse = await fetch("/api/platform/account", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" }
      });
      if (accountResponse.status === 401 || accountResponse.status === 403) {
        accountReady = false;
        accountResolved = true;
        const runtime = productionRuntime();
        if (runtime) runtime.setGuest();
        maybeApplyInitialRoute();
        return "guest";
      }
      if (!accountResponse.ok) return "error";

      const accountPayload = await accountResponse.json();
      let orders = [];
      try {
        const ordersResponse = await fetch("/api/platform/orders", {
          credentials: "same-origin",
          cache: "no-store",
          headers: { accept: "application/json" }
        });
        if (ordersResponse.ok) {
          const ordersPayload = await ordersResponse.json();
          if (Array.isArray(ordersPayload?.orders)) orders = ordersPayload.orders;
        }
      } catch {
        // Identity and wallet remain authoritative if the order list is temporarily unavailable.
      }

      return applyProductionAccount(accountPayload?.account, orders) ? "account" : "error";
    } catch {
      if (initial) {
        accountReady = false;
        accountResolved = false;
      }
      return "error";
    }
  }

  function revealResolvedAccountState(status) {
    if (status === "error") {
      window.location.replace("/account");
      return;
    }
    document.documentElement.removeAttribute("data-v41-production-pending");
  }

  function responseMessage(payload, fallback) {
    return String(payload?.message || payload?.error?.message || payload?.error || fallback || "تعذر إكمال العملية");
  }

  async function submitProductionServiceRequest() {
    if (serviceRequestInFlight) return;
    const runtime = productionRuntime();
    if (!runtime || typeof runtime.serviceRequestDraft !== "function") {
      navigate("/services");
      return;
    }
    if (!accountReady) {
      const next = `${location.pathname}${location.search}`;
      navigate(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    const draft = runtime.serviceRequestDraft();
    if (!draft?.serviceId) {
      if (typeof runtime.showToast === "function") runtime.showToast("تعذر تجهيز بيانات الطلب. ارجع للخدمة وحاول مجددًا.");
      return;
    }
    if (!draft.customerEmail && !draft.customerPhone) {
      navigate("/account");
      return;
    }

    serviceRequestInFlight = true;
    try {
      const requestId = typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `v41-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const response = await fetch("/api/public/service-requests", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "idempotency-key": requestId
        },
        body: JSON.stringify(draft)
      });
      let payload = null;
      try { payload = await response.json(); } catch { payload = null; }
      if (!response.ok) throw new Error(responseMessage(payload, `HTTP ${response.status}`));

      await hydrateProductionAccount();
      if (typeof runtime.openRoute === "function") runtime.openRoute("/orders");
      history.pushState(null, "", "/orders");
      if (typeof runtime.showToast === "function") runtime.showToast("تم إرسال الطلب بنجاح إلى الإدارة");
    } catch (error) {
      if (typeof runtime.showToast === "function") runtime.showToast(error?.message || "تعذر إرسال الطلب الآن");
    } finally {
      serviceRequestInFlight = false;
    }
  }

  function refreshProductionState({ initial = false } = {}) {
    if (syncInFlight) return syncInFlight;
    syncInFlight = Promise.all([
      hydrateProductionPortal(),
      hydrateProductionAccount({ initial })
    ]).finally(() => {
      syncInFlight = null;
    });
    return syncInFlight;
  }

  function installProductionRefreshLoop() {
    if (syncTimer) window.clearInterval(syncTimer);
    syncTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshProductionState();
    }, SYNC_INTERVAL_MS);

    window.addEventListener("focus", () => {
      void refreshProductionState();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void refreshProductionState();
    });
  }

  function syncInternalBrowserPath(element) {
    const action = element.getAttribute("data-action") || "";
    const page = element.getAttribute("data-page") || "";
    const id = element.getAttribute("data-id") || "";
    let path = "";
    if (action === "category") path = CATEGORY_ROUTES[id] || "/services";
    else if ((action === "go" || action === "push") && ["all", "search"].includes(page)) path = "/services";
    else if ((action === "go" || action === "push") && page === "payments") path = "/payment-methods";
    else if ((action === "go" || action === "push") && page === "orders") path = "/orders";
    if (path && path !== location.pathname) history.pushState(null, "", path);
  }

  function initializeProductionShell() {
    const runtime = productionRuntime();
    if (!runtime) {
      window.location.replace("/services");
      return;
    }
    runtime.setGuest();
    clearLegacyDemoStorage();
    installBannerObserver();
    maybeApplyInitialRoute();
    void hydrateProductionPortal();
    void hydrateProductionAccount({ initial: true }).then(revealResolvedAccountState);
    installProductionRefreshLoop();
  }

  document.addEventListener("click", (event) => {
    const actionElement = event.target.closest?.("[data-action]");
    if (!actionElement) return;
    const action = actionElement.getAttribute("data-action") || "";
    const id = actionElement.getAttribute("data-id") || "";
    const runtime = productionRuntime();

    if (action === "logout") {
      event.preventDefault();
      event.stopImmediatePropagation();
      void logoutProductionSession();
      return;
    }
    if (action === "production-banner") {
      event.preventDefault();
      event.stopImmediatePropagation();
      openProductionBanner(actionElement);
      return;
    }
    if (action === "quick-whatsapp" || action === "open-social") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const type = action === "quick-whatsapp" ? "whatsapp" : id;
      openProductionContact(type);
      return;
    }
    if (action === "service-primary" && runtime && typeof runtime.beginServiceReview === "function") {
      const handled = runtime.beginServiceReview(id);
      if (handled) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
    if (action === "confirm-review" && runtime && typeof runtime.serviceRequestDraft === "function" && runtime.serviceRequestDraft()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void submitProductionServiceRequest();
      return;
    }
    if (action === "payment-method" && portalReady) {
      event.preventDefault();
      event.stopImmediatePropagation();
      navigate(`/add-balance/${encodeURIComponent(id)}`);
      return;
    }

    const page = actionElement.getAttribute("data-page") || "";
    if (canBrowseInsideV41(action, page)) {
      syncInternalBrowserPath(actionElement);
      return;
    }
    const route = productionRouteForAction(actionElement);
    if (!route) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    navigate(route);
  }, true);

  document.addEventListener("submit", (event) => {
    const route = FORM_ROUTES[event.target?.id];
    if (!route) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    navigate(route);
  }, true);

  window.addEventListener("popstate", () => {
    const runtime = productionRuntime();
    if (runtime && typeof runtime.openRoute === "function") runtime.openRoute(location.pathname);
  });

  clearLegacyDemoStorage();
  installManifestLink();
  registerProductionServiceWorker();

  document.documentElement.setAttribute("data-v41-production-pending", "true");
  const style = document.createElement("style");
  style.dataset.v41ProductionBridge = "true";
  style.textContent = [
    "#demoAdminLauncher{display:none!important}",
    ".cat>i{display:none!important}",
    ".slide[data-action=\"production-banner\"]{cursor:pointer}",
    ".slide[data-action=\"production-banner\"] .slideArt{overflow:hidden}",
    "html[data-v41-production-pending=\"true\"] .balanceChip{visibility:hidden!important}",
    "html[data-v41-production-pending=\"true\"] .headerLogin{visibility:hidden!important}",
    "html[data-v41-production-pending=\"true\"] .userWelcome{visibility:hidden!important}",
    "html[data-v41-production-pending=\"true\"] .loggedDrawerHead{visibility:hidden!important}"
  ].join("");
  document.head.append(style);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeProductionShell, { once: true });
  } else {
    initializeProductionShell();
  }

  window.__UCHIHA_V41_PRODUCTION_BRIDGE__ = Object.freeze({
    active: true,
    release: RELEASE,
    accountEndpoint: "/api/platform/account",
    ordersEndpoint: "/api/platform/orders",
    portalEndpoint: "/api/public/portal",
    serviceRequestEndpoint: "/api/public/service-requests",
    syncIntervalMs: SYNC_INTERVAL_MS
  });
})();