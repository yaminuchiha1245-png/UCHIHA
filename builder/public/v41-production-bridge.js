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

  const TERMINAL_ORDER_STATUSES = new Set([
    "completed",
    "complete",
    "approved",
    "rejected",
    "cancelled",
    "canceled",
    "failed",
    "refunded"
  ]);

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

  function clearLegacyDemoStorage() {
    try {
      window.localStorage.removeItem(DEMO_STORAGE_KEY);
    } catch {
      // Storage may be unavailable; production routing still remains fail-closed.
    }
  }

  function clearLegacyDemoSession() {
    // v41 remains the approved visual shell, but none of its bundled demo account,
    // wallet, order, notification, chat or admin records may survive in production.
    try {
      if (window.state && typeof window.state === "object") {
        window.state.loggedIn = false;
        window.state.session = null;
        window.state.authReturn = null;
        window.state.reviewOrder = null;
        window.state.pendingOrder = null;
        window.state.stack = [{ page: "home" }];
        window.state.orders = [];
        window.state.walletTxs = [];
        window.state.notifications = [];
        window.state.customerRecords = [];
        window.state.paymentRecords = [];
        window.state.adminLedger = [];
        window.state.chatThreads = {};
      }
      if (window.DEMO_USER && typeof window.DEMO_USER === "object") {
        window.DEMO_USER.name = "مستخدم UCHIHA";
        window.DEMO_USER.firstName = "مستخدم";
        window.DEMO_USER.initial = "م";
        window.DEMO_USER.accountId = "";
        window.DEMO_USER.walletId = "";
        window.DEMO_USER.phone = "";
        window.DEMO_USER.telegram = "";
        window.DEMO_USER.email = "";
        window.DEMO_USER.balance = 0;
        window.DEMO_USER.notifications = 0;
        window.DEMO_USER.role = "guest";
        window.DEMO_USER.status = "active";
      }
      if (window.CONFIG && typeof window.CONFIG === "object") {
        window.CONFIG.demoAdminMode = false;
      }
    } catch {
      // Never block the production shell if the archived visual runtime changes.
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

  function formatWalletCurrency(currency) {
    const normalized = String(currency || "USD").trim().toUpperCase();
    return /^[A-Z]{3}$/.test(normalized) ? normalized : "USD";
  }

  function installProductionMoneyFormatter(currency) {
    const walletCurrency = formatWalletCurrency(currency);
    if (window.CONFIG && typeof window.CONFIG === "object") window.CONFIG.currency = walletCurrency;
    window.money = (value) => {
      const amount = Number(value) || 0;
      try {
        return new Intl.NumberFormat(document.documentElement.lang || "ar", {
          style: "currency",
          currency: walletCurrency,
          maximumFractionDigits: 2
        }).format(amount);
      } catch {
        return `${walletCurrency} ${amount.toFixed(2)}`;
      }
    };
  }

  function productionOrder(order) {
    const status = String(order?.status || "pending").toLowerCase();
    const done = TERMINAL_ORDER_STATUSES.has(status);
    return {
      id: String(order?.id || ""),
      product: String(order?.title || "طلب UCHIHA"),
      status: String(order?.status || "قيد المتابعة"),
      progress: done ? 100 : 35,
      done,
      createdAt: order?.createdAt || null,
      updatedAt: order?.updatedAt || null,
      amount: Number.isFinite(Number(order?.amountMinor)) ? Number(order.amountMinor) / 100 : null,
      details: {}
    };
  }

  function applyProductionAccount(account, orders) {
    if (!account || !window.state || !window.DEMO_USER) return false;
    const user = account.user || {};
    const wallet = account.wallet || {};
    const preferences = account.preferences || {};
    const notifications = Array.isArray(account.notifications) ? account.notifications : [];
    const displayName = String(user.displayName || user.email || "مستخدم UCHIHA").trim();
    const nameParts = displayName.split(/\s+/).filter(Boolean);

    installProductionMoneyFormatter(wallet.currency);

    window.DEMO_USER.name = displayName;
    window.DEMO_USER.firstName = nameParts[0] || "مستخدم";
    window.DEMO_USER.initial = (nameParts[0] || "م").charAt(0);
    window.DEMO_USER.accountId = String(user.email || "");
    window.DEMO_USER.walletId = formatWalletCurrency(wallet.currency);
    window.DEMO_USER.phone = String(preferences.phone || "");
    window.DEMO_USER.telegram = preferences.telegramUsername ? `@${preferences.telegramUsername}` : "";
    window.DEMO_USER.email = String(user.email || "");
    window.DEMO_USER.balance = Math.max(0, Number(wallet.availableMinor || 0)) / 100;
    window.DEMO_USER.notifications = Number(account.counts?.unreadNotifications || 0);
    window.DEMO_USER.createdAt = user.createdAt || "";
    window.DEMO_USER.role = user.isPlatformAdmin ? "admin" : "customer";
    window.DEMO_USER.status = String(user.status || "active");

    window.state.loggedIn = true;
    window.state.session = {
      id: "production",
      role: window.DEMO_USER.role,
      permissions: [],
      lastLogin: new Date().toISOString()
    };
    window.state.stack = [{ page: "home" }];
    window.state.orders = Array.isArray(orders) ? orders.map(productionOrder) : [];
    window.state.notifications = notifications.map((notification) => ({
      id: String(notification.id || ""),
      title: String(notification.title || ""),
      body: String(notification.body || ""),
      orderId: "",
      type: String(notification.type || "info"),
      read: Boolean(notification.isRead),
      time: notification.createdAt || null
    }));
    return true;
  }

  async function hydrateProductionAccount() {
    try {
      const accountResponse = await fetch("/api/platform/account", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" }
      });
      if (accountResponse.status === 401 || accountResponse.status === 403) return false;
      if (!accountResponse.ok) return false;

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
        // Account identity and wallet can still be shown safely when orders are temporarily unavailable.
      }

      if (!applyProductionAccount(accountPayload?.account, orders)) return false;
      if (typeof window.render === "function") window.render();
      return true;
    } catch {
      return false;
    }
  }

  function initializeProductionShell() {
    clearLegacyDemoSession();
    if (typeof window.render === "function") window.render();
    document.documentElement.removeAttribute("data-v41-production-pending");
    void hydrateProductionAccount();
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

  clearLegacyDemoStorage();
  installManifestLink();
  registerProductionServiceWorker();

  // The production bridge is injected in <head>, while v41 defines its demo state
  // later in the document. Keep sensitive demo UI hidden until DOMContentLoaded,
  // then sanitize the state after those legacy variables actually exist.
  document.documentElement.setAttribute("data-v41-production-pending", "true");
  const style = document.createElement("style");
  style.dataset.v41ProductionBridge = "true";
  style.textContent = [
    "#demoAdminLauncher{display:none!important}",
    "html[data-v41-production-pending=\"true\"] .balanceChip{visibility:hidden!important}",
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
    ordersEndpoint: "/api/platform/orders"
  });
})();
