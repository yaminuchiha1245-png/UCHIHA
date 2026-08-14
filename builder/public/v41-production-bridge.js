(() => {
  "use strict";

  const ASSET_RELEASE = "2026.08.14.4";
  const COMPATIBLE_RUNTIME_RELEASES = new Set(["2026.08.14.3", ASSET_RELEASE]);
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
  let portalReady = false;
  let accountReady = false;
  let syncTimer = null;
  let syncInFlight = null;

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
    if (!runtime || !COMPATIBLE_RUNTIME_RELEASES.has(String(runtime.release || ""))) return null;
    if (typeof runtime.setGuest !== "function" || typeof runtime.setAccount !== "function") return null;
    return runtime;
  }

  function canBrowseInsideV41(action, page) {
    const runtime = productionRuntime();
    const hasPortalSync = Boolean(runtime && typeof runtime.syncPortal === "function");
    const hasAccountSync = Boolean(runtime && typeof runtime.syncAccount === "function");
    if (!hasPortalSync) return false;
    if ((action === "category" || action === "service") && portalReady) return true;
    if ((action === "go" || action === "push") && portalReady && ["all", "search", "payments"].includes(page)) return true;
    if ((action === "go" || action === "push") && accountReady && hasAccountSync && ["account", "orders", "order-detail", "notifications"].includes(page)) return true;
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
        .register(`/sw.js?v=${ASSET_RELEASE}`, { scope: "/", updateViaCache: "none" })
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
      const runtime = productionRuntime();
      if (!runtime || typeof runtime.syncPortal !== "function") {
        portalReady = false;
        return false;
      }
      portalReady = runtime.syncPortal(portal) !== false;
      clearLegacyDemoStorage();
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
    clearLegacyDemoStorage();
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
        const runtime = productionRuntime();
        if (runtime) runtime.setGuest();
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
      if (initial) accountReady = false;
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

  function initializeProductionShell() {
    const runtime = productionRuntime();
    if (!runtime) {
      window.location.replace("/services");
      return;
    }
    runtime.setGuest();
    clearLegacyDemoStorage();
    void hydrateProductionPortal();
    void hydrateProductionAccount({ initial: true }).then(revealResolvedAccountState);
    installProductionRefreshLoop();
  }

  document.addEventListener("click", (event) => {
    const actionElement = event.target.closest?.("[data-action]");
    if (!actionElement) return;
    const action = actionElement.getAttribute("data-action") || "";
    if (action === "logout") {
      event.preventDefault();
      event.stopImmediatePropagation();
      void logoutProductionSession();
      return;
    }
    if (action === "quick-whatsapp" || action === "open-social") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const type = action === "quick-whatsapp" ? "whatsapp" : actionElement.getAttribute("data-id");
      openProductionContact(type);
      return;
    }
    const page = actionElement.getAttribute("data-page") || "";
    if (canBrowseInsideV41(action, page)) return;
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

  clearLegacyDemoStorage();
  installManifestLink();
  registerProductionServiceWorker();

  document.documentElement.setAttribute("data-v41-production-pending", "true");
  const style = document.createElement("style");
  style.dataset.v41ProductionBridge = "true";
  style.textContent = [
    "#demoAdminLauncher{display:none!important}",
    ".cat>i{display:none!important}",
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
    release: ASSET_RELEASE,
    accountEndpoint: "/api/platform/account",
    ordersEndpoint: "/api/platform/orders",
    portalEndpoint: "/api/public/portal",
    syncIntervalMs: SYNC_INTERVAL_MS
  });
})();
