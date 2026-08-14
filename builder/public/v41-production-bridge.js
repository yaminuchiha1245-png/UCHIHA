(() => {
  "use strict";

  const RELEASE = "2026.08.14.3";
  const DEMO_STORAGE_KEY = "uchiha-platform-v19-demo";
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
    domain: "/category/hosting-domains"
  });

  const ACTION_ROUTES = Object.freeze({
    "demo-admin-launch": "/platform-admin",
    "confirm-review": "/services",
    "retry-payment": "/orders",
    "accept-quote": "/orders",
    "domain-buy": "/category/hosting-domains"
  });

  const FORM_ROUTES = Object.freeze({
    loginForm: "/login",
    registerForm: "/register",
    requestForm: "/services",
    paymentForm: "/payment-methods",
    accountEditForm: "/account",
    orderInfoForm: "/orders"
  });

  function safeRoute(value, fallback = "/") {
    const route = String(value || "");
    if (!route.startsWith("/") || route.startsWith("//") || route.includes("..")) return fallback;
    return route;
  }

  function navigate(route) {
    window.location.assign(safeRoute(route));
  }

  function productionRouteForAction(element) {
    const action = element.getAttribute("data-action") || "";
    const page = element.getAttribute("data-page") || "";
    if (ACTION_ROUTES[action]) return ACTION_ROUTES[action];
    if (page.startsWith("admin-")) return "/platform-admin";
    if ((action === "go" || action === "push") && PAGE_ROUTES[page]) return PAGE_ROUTES[page];
    if (action === "request") return "/services";
    return null;
  }

  function clearLegacyDemoSession() {
    try {
      window.localStorage.removeItem(DEMO_STORAGE_KEY);
    } catch {
      // Storage may be unavailable; production routing still remains fail-closed.
    }

    // v41 is intentionally preserved as a visual shell. If its legacy demo state
    // is globally reachable, force it to guest mode so fake balances/sessions are
    // never presented as real account data before the user enters production routes.
    try {
      if (window.state && typeof window.state === "object") {
        window.state.loggedIn = false;
        window.state.session = null;
        window.state.authReturn = null;
        window.state.stack = [{ page: "home" }];
      }
      if (window.CONFIG && typeof window.CONFIG === "object") {
        window.CONFIG.demoAdminMode = false;
      }
      if (typeof window.render === "function") window.render();
    } catch {
      // Never block the production shell if the archived demo internals change.
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

  document.addEventListener("click", (event) => {
    const actionElement = event.target.closest?.("[data-action]");
    if (!actionElement) return;
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

  // The demo admin launcher must never be visible in production, even for a
  // browser that still had old v41 LocalStorage before this bridge was deployed.
  const style = document.createElement("style");
  style.dataset.v41ProductionBridge = "true";
  style.textContent = "#demoAdminLauncher{display:none!important}";
  document.head.append(style);

  clearLegacyDemoSession();
  installManifestLink();
  registerProductionServiceWorker();
  window.__UCHIHA_V41_PRODUCTION_BRIDGE__ = Object.freeze({
    active: true,
    release: RELEASE
  });
})();
