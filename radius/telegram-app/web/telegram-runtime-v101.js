(() => {
  "use strict";
  window.__UCHIHA_PROVIDER_RUNTIME__ = true;
  const tg = window.Telegram && window.Telegram.WebApp;
  const originalFetch = window.fetch.bind(window);
  let authReadyResolve, authReadyReject;
  const authReady = new Promise((resolve, reject) => { authReadyResolve = resolve; authReadyReject = reject; });
  // A rejected auth guard must not become an unhandled promise rejection.
  authReady.catch(() => {});
  window.__UCHIHA_TELEGRAM_AUTH_READY__ = authReady;

  const urlOf = (input) => {
    try { return new URL(typeof input === "string" ? input : input.url, location.href); }
    catch { return null; }
  };
  const pathOf = (input) => urlOf(input)?.pathname || "";
  const telegramApiInput = (input) => {
    const url = urlOf(input);
    if (!url || url.origin !== location.origin || !url.pathname.startsWith("/api/")) return input;
    url.pathname = "/telegram-api" + url.pathname.slice(4);
    if (typeof input === "string") return url.pathname + url.search + url.hash;
    return new Request(url.toString(), input);
  };
  const requiresProviderAuth = (path) =>
    path.startsWith("/api/catalog") ||
    path.startsWith("/api/workflows") ||
    path.startsWith("/api/operations") ||
    path.startsWith("/api/radius-provider/") ||
    path.startsWith("/api/connectors/radius");

  let csrfToken = "";
  let providerRevoked = false;
  window.fetch = async (input, init = {}) => {
    const path = pathOf(input);
    if (requiresProviderAuth(path) && path !== "/api/radius-provider/auth/telegram" && path !== "/api/radius-provider/logout") {
      await authReady;
      if (providerRevoked) throw new Error("telegram_session_expired");
    }
    const method = String(init.method || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    const options = { credentials: "same-origin", ...init };
    if (csrfToken && !["GET","HEAD","OPTIONS"].includes(method) && requiresProviderAuth(path)) {
      const headers = new Headers(options.headers || (typeof input !== "string" ? input.headers : undefined) || {});
      if (!headers.has("X-Uchiha-CSRF")) headers.set("X-Uchiha-CSRF", csrfToken);
      options.headers = headers;
    }
    const response = await originalFetch(telegramApiInput(input), options);
    if (requiresProviderAuth(path) && response.status === 401) {
      invalidateProviderSession("telegram_session_expired");
    } else if (path === "/api/radius-provider/logout" && response.ok) {
      invalidateProviderSession("telegram_session_closed");
    }
    return response;
  };

  function injectTelegramRuntimeCss() {
    const style = document.createElement("style");
    style.textContent = `
      #uchiha-operator-login-v99,#uchiha-operator-chip-v99{display:none!important}
      html.uchiha-telegram-runtime:not(.uchiha-telegram-authenticated) #root{visibility:hidden!important}
      /* React portals and fixed toolbars can live outside #root. Never reveal
         provider content until a signed Telegram session has been verified. */
      html.uchiha-telegram-runtime:not(.uchiha-telegram-authenticated) body > :not([data-uchiha-auth-error]){visibility:hidden!important;pointer-events:none!important}
      html.uchiha-telegram-runtime .profile-button:not([data-uchiha-live-profile-verified="1"]){visibility:hidden!important}
      html.uchiha-telegram-runtime body{padding-bottom:max(env(safe-area-inset-bottom),0px)}
      html.uchiha-telegram-runtime .provider-promo-connected{display:none!important}
      /* v101's platform-wide scope and active plan banner are design placeholders.
         Hide them until real provider entitlements are available from the API. */
      html.uchiha-telegram-runtime .radius-plan-strip,
      html.uchiha-telegram-runtime .scope-switch.platform{display:none!important}
      html.uchiha-telegram-runtime [data-uchiha-live-hidden="1"]{display:none!important}
      html.uchiha-telegram-runtime .command-search:not(.advanced)+.command-results{display:none!important}
    `;
    document.head.appendChild(style);
    document.documentElement.classList.add("uchiha-telegram-runtime");
  }

  const STRICT_HIDDEN_NAV = new Set([
    "مركز القيادة","Command Center",
    "غرفة عمليات NOC","NOC Wallboard",
    "تجهيز مزود جديد","Provider Onboarding",
    "البنية التحتية","Infrastructure",
    "طوبولوجيا الشبكة","Network Topology",
    "مخزون الأجهزة","Asset Inventory",
    "RADIUS وAAA","RADIUS & AAA",
    "جودة الخدمة وSLA","Service Assurance",
    "الحركة وQoS","Traffic & QoS",
    "IPAM وDHCP","IPAM & DHCP",
    "الأتمتة وRunbooks","Automation & Runbooks",
    "بوابات Hotspot","Hotspot Portals",
    "المحافظ والصناديق","Wallets & Cashboxes",
    "الوكلاء والموزعون","Agents & Resellers",
    "البطاقات والقسائم","Cards & Vouchers",
    "العمولات","Commissions",
    "الصيانة والحوادث","Incidents",
    "تذاكر الدعم","Support Tickets",
    "الفنيون","Technicians",
    "التقارير","Reports",
    "المستخدمون والصلاحيات","Users & Roles",
    "الأمان","Security",
    "بوابة الدخول","Access Gateway",
    "النسخ الاحتياطي","Backups",
    "API والتكاملات","API & Integrations",
    "الهوية الخاصة","White-label",
    "بوابة المشترك","Subscriber Portal",
    "تجربة تطبيق الهاتف","Mobile app shell",
    "الإعدادات","Settings",
    "مكتبة التصميم","UI Kit",
    "الباقات والسياسات","Plans & Policies"
  ]);

  const STRICT_HIDDEN_TABS = new Set([
    "Authentication","Accounting","AAA Policies","IP Pools"
  ]);

  const STRICT_HIDDEN_ACTIONS = new Set([
    "إضافة مزود", "إضافة مزود خدمة","Add provider",
    "إعلان حادث","Declare incident",
    "إنشاء فاتورة","Create invoice",
    "إصدار دفعة قسائم","Generate voucher batch",
    "تشغيل نسخة احتياطية","Run backup"
  ]);

  function syncProviderHeader() {
    const context = window.__UCHIHA_PROVIDER_CONTEXT__;
    if (!context?.provider) return;
    const button = document.querySelector('.profile-button');
    if (!button) return;
    const name = String(context.displayName || context.provider.name || 'مزود').trim().slice(0,80);
    const roleNames = {owner: 'مالك المزود', admin: 'مدير المزود', operator: 'مشغّل', viewer: 'مشاهد'};
    const role = roleNames[context.role] || 'حساب المزود';
    const title = button.querySelector('strong');
    const subtitle = button.querySelector('small');
    const avatar = button.querySelector('.profile-avatar');
    if (title && title.textContent !== name) title.textContent = name;
    if (subtitle && subtitle.textContent !== role) subtitle.textContent = role;
    if (avatar && avatar.textContent !== name[0]) avatar.textContent = name[0];
    button.dataset.uchihaLiveProfileVerified = '1';
  }

  function enforceStrictLiveSurface(root = document) {
    syncProviderHeader();
    for (const item of root.querySelectorAll?.(".nav-item") || []) {
      const label = (item.textContent || "").replace(/\s+/g, " ").trim();
      if ([...STRICT_HIDDEN_NAV].some((value) => label.includes(value))) {
        item.setAttribute("data-uchiha-live-hidden", "1");
        item.setAttribute("aria-hidden", "true");
        item.tabIndex = -1;
      }
    }
    for (const tab of root.querySelectorAll?.('[role="tab"],button') || []) {
      const label = (tab.textContent || "").replace(/\s+/g, " ").trim();
      if (STRICT_HIDDEN_TABS.has(label)) {
        tab.setAttribute("data-uchiha-live-hidden", "1");
        tab.setAttribute("aria-hidden", "true");
        tab.tabIndex = -1;
      }
    }
    for (const promo of root.querySelectorAll?.(".provider-promo-connected") || []) {
      promo.setAttribute("data-uchiha-live-hidden", "1");
      promo.setAttribute("aria-hidden", "true");
      promo.tabIndex = -1;
    }
    for (const button of root.querySelectorAll?.("button") || []) {
      const label = (button.textContent || "").replace(/\s+/g, " ").trim();
      if (STRICT_HIDDEN_ACTIONS.has(label)) {
        button.setAttribute("data-uchiha-live-hidden", "1");
        button.setAttribute("aria-hidden", "true");
        button.tabIndex = -1;
      }
    }
  }

  function startStrictLiveObserver() {
    const run = () => enforceStrictLiveSurface(document);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }
    // React sometimes appends a button itself rather than an ancestor node.
    // Coalesce updates so direct buttons and their late-arriving text are hidden
    // without performing a full scan for every individual DOM mutation.
    let scheduled = false;
    const observer = new MutationObserver((mutations) => {
      if (scheduled || !mutations.some((mutation) => mutation.addedNodes.length)) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        run();
      });
    });
    const attach = () => {
      if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) attach();
    else document.addEventListener("DOMContentLoaded", attach, { once: true });
  }

  const formatBytes = (n) => {
    const v = Number(n || 0);
    if (v >= 1073741824) return (v / 1073741824).toFixed(1) + " GB";
    if (v >= 1048576) return (v / 1048576).toFixed(1) + " MB";
    if (v >= 1024) return (v / 1024).toFixed(1) + " KB";
    return String(v) + " B";
  };

  const formatDuration = (started, stopped) => {
    const start = Number(started || 0);
    if (!start) return "—";
    const end = Number(stopped || 0) || Math.floor(Date.now() / 1000);
    const seconds = Math.max(0, end - start);
    const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    return h + ":" + m + ":" + s;
  };

  async function syncProviderData(providerContext) {
    const [cat, sessions, plans] = await Promise.all([
      originalFetch("/telegram-api/catalog", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" }
      }),
      originalFetch("/telegram-api/radius-provider/sessions", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" }
      }),
      originalFetch("/telegram-api/radius-provider/plans", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" }
      })
    ]);

    if ([cat, sessions, plans].some((response) => response.status === 401)) {
      invalidateProviderSession("telegram_session_expired");
      return;
    }
    if (providerRevoked) return;

    if (cat.ok) {
      const catalog = await cat.json();
      if (providerRevoked) return;
      // Keep provider data scoped to this authenticated Telegram session.
      // The interface fetches its catalog from the server directly; storing it
      // in origin-wide localStorage can leak data across providers on one device.
      window.__UCHIHA_PROVIDER_LIVE_CATALOG__ = catalog;
      window.dispatchEvent(new CustomEvent("uchiha-radius-provider-catalog-ready", {
        detail: { provider: providerContext && providerContext.provider }
      }));
    }

    if (plans.ok) {
      const data = await plans.json();
      if (providerRevoked) return;
      const planSeed = window.__UCHIHA_RADIUS_PLAN_SEED__ || (window.__UCHIHA_RADIUS_PLAN_SEED__ = []);
      const items = Array.isArray(data.items) ? data.items : [];
      planSeed.splice(0, planSeed.length, ...items.map((item) => ({
        id: String(item.id || ""),
        name: String(item.name || ""),
        downloadMbps: Number(item.download_mbps || 0),
        uploadMbps: Number(item.upload_mbps || 0),
        quotaGb: Number(item.quota_gb || 0),
        durationDays: Number(item.duration_days || 0),
        price: Number(item.price || 0),
        status: String(item.status || "")
      })));
      window.dispatchEvent(new CustomEvent("uchiha-radius-plan-change", {
        detail: { live: true, count: planSeed.length }
      }));
    }

    if (sessions.ok) {
      const data = await sessions.json();
      if (providerRevoked) return;
      const seed = window.__UCHIHA_RADIUS_SESSION_SEED__ || (window.__UCHIHA_RADIUS_SESSION_SEED__ = []);
      const items = Array.isArray(data.items) ? data.items : [];
      seed.splice(0, seed.length, ...items.map((item) => ({
        id: String(item.id || ""),
        user: String(item.username || ""),
        provider: String(item.provider_name || providerContext?.provider?.name || ""),
        nas: String(item.nas || item.router_name || ""),
        ip: String(item.framed_ip || "—"),
        kind: String(item.access_kind || "RADIUS"),
        duration: formatDuration(item.started_at, item.stopped_at),
        down: "—",
        up: "—",
        traffic: formatBytes(Number(item.input_octets || 0) + Number(item.output_octets || 0)),
        // No latency/auth-server measurement is supplied by this API yet.
        // Do not present a fabricated 0 ms response or start timestamp.
        latencyMs: null,
        authServer: "—",
        startedAt: item.started_at
          ? new Date(Number(item.started_at) * 1000).toISOString()
          : null,
        state: String(item.status || "") === "online" ? "healthy" : "disconnected",
        tone: String(item.status || "") === "online" ? "green" : "red",
        runtimeSource: "live"
      })));
      window.dispatchEvent(new CustomEvent("uchiha-radius-session-change", {
        detail: { live: true, count: seed.length }
      }));
    }
  }

  let providerSyncTimer = null;

  function invalidateProviderSession(reason) {
    if (providerRevoked) return;
    providerRevoked = true;
    document.documentElement.classList.remove("uchiha-telegram-authenticated");
    if (providerSyncTimer) clearInterval(providerSyncTimer);
    providerSyncTimer = null;
    csrfToken = "";
    window.__UCHIHA_PROVIDER_AUTH_ERROR__ = reason;
    window.__UCHIHA_PROVIDER_CONTEXT__ = null;
    window.__UCHIHA_PROVIDER_LIVE_CATALOG__ = null;
    for (const name of ["__UCHIHA_RADIUS_PLAN_SEED__", "__UCHIHA_RADIUS_SESSION_SEED__"]) {
      const items = window[name];
      if (Array.isArray(items)) items.splice(0, items.length);
    }
    const profile = document.querySelector(".profile-button");
    if (profile) profile.removeAttribute("data-uchiha-live-profile-verified");
    window.dispatchEvent(new CustomEvent("uchiha-radius-provider-catalog-ready", {detail: {expired: true}}));
    window.dispatchEvent(new CustomEvent("uchiha-radius-plan-change", {detail: {expired: true, count: 0}}));
    window.dispatchEvent(new CustomEvent("uchiha-radius-session-change", {detail: {expired: true, count: 0}}));
    const showAuthError = () => {
      if (document.querySelector("[data-uchiha-auth-error]")) return;
      const box = document.createElement("div");
      box.setAttribute("role", "alert");
      box.setAttribute("data-uchiha-auth-error", "1");
      box.dir = "rtl";
      box.style.cssText = "position:fixed;z-index:2147483647;inset:16px 16px auto 16px;padding:14px 16px;border-radius:14px;background:#15171b;color:#fff;font:600 14px system-ui;box-shadow:0 12px 40px #0008";
      box.textContent = reason === "telegram_session_expired" || reason === "telegram_session_closed"
        ? "انتهت جلسة Telegram. أغلق الواجهة وافتح RADIUS مجددًا من البوت الرسمي."
        : "تعذر التحقق من جلسة Telegram. افتح RADIUS من زر البوت الرسمي ثم حاول مجددًا.";
      document.body.appendChild(box);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", showAuthError, {once: true});
    } else {
      showAuthError();
    }
  }

  async function authenticate() {
    injectTelegramRuntimeCss();
    startStrictLiveObserver();
    if (!tg || !tg.initData) throw new Error("telegram_webapp_required");
    try { tg.ready(); tg.expand(); } catch {}
    const response = await originalFetch("/telegram-api/radius-provider/auth/telegram", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ initData: tg.initData })
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok || body.ok !== true) throw new Error(body?.error?.code || `telegram_auth_http_${response.status}`);
    window.__UCHIHA_PROVIDER_CONTEXT__ = body;
    csrfToken = String(body.csrfToken || "");
    syncProviderHeader();
    document.documentElement.classList.add('uchiha-telegram-authenticated');
    authReadyResolve(body);
    try {
      await syncProviderData(body);
      if (providerRevoked) return body;
      if (providerSyncTimer) clearInterval(providerSyncTimer);
      providerSyncTimer = setInterval(() => {
        if (!providerRevoked) syncProviderData(body).catch(() => {});
      }, 5000);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && !providerRevoked) syncProviderData(body).catch(() => {});
      });
    } catch {}
    return body;
  }

  authenticate().catch((error) => {
    authReadyReject(error);
    invalidateProviderSession(String(error && error.message || error));
  });
})();
