(() => {
  "use strict";

  const RELEASE_VERSION = "2026.08.03.1";

  function installLaunchSales() {
    if (document.querySelector('script[data-launch-sales="true"]')) return;
    const script = document.createElement("script");
    script.src = `/assets/launch-builder-sales.js?v=${RELEASE_VERSION}`;
    script.async = false;
    script.dataset.launchSales = "true";
    document.head.append(script);
  }
  const wrongStoreDocument = document.body?.dataset.page === "store" && !/^\/store\/[^/]+\/?$/.test(location.pathname);
  if (wrongStoreDocument) document.body.dataset.page = "recovery";

  function installRouteRecoveryAsset() {
    if (document.querySelector('script[data-route-recovery="true"]')) return;
    const script = document.createElement("script");
    script.src = `/assets/runtime-recovery.js?v=${RELEASE_VERSION}`;
    script.async = false;
    script.dataset.routeRecovery = "true";
    document.head.append(script);
  }
  const WATCHDOG_MS = 22000;
  const memoryStores = new Map();

  function memoryStorage(name) {
    if (memoryStores.has(name)) return memoryStores.get(name);
    const values = new Map();
    const storage = {
      get length() { return values.size; },
      clear() { values.clear(); },
      getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
      key(index) { return [...values.keys()][Number(index)] ?? null; },
      removeItem(key) { values.delete(String(key)); },
      setItem(key, value) { values.set(String(key), String(value)); }
    };
    memoryStores.set(name, storage);
    return storage;
  }

  function ensureStorage(name) {
    try {
      const storage = window[name];
      const probe = `__uchiha_probe_${Date.now()}`;
      storage.setItem(probe, "1");
      storage.removeItem(probe);
    } catch {
      try {
        Object.defineProperty(window, name, { configurable: true, value: memoryStorage(name) });
      } catch {
        // A visible recovery state still replaces an endless loader below.
      }
    }
  }

  function installFetchDeadline() {
    if (window.__uchihaFetchDeadlineInstalled || typeof window.fetch !== "function") return;
    window.__uchihaFetchDeadlineInstalled = true;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      let target;
      try {
        target = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
      } catch {
        return nativeFetch(input, init);
      }
      const method = String(init.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
      const tracked = target.origin === location.origin && target.pathname.startsWith("/api/");
      if (!tracked) return nativeFetch(input, init);

      const controller = new AbortController();
      const externalSignal = init.signal;
      const timeoutMs = ["GET", "HEAD", "OPTIONS"].includes(method) ? 18000 : 30000;
      let timedOut = false;
      const onAbort = () => controller.abort(externalSignal?.reason);
      if (externalSignal) {
        if (externalSignal.aborted) onAbort();
        else externalSignal.addEventListener("abort", onAbort, { once: true });
      }
      const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        return await nativeFetch(input, { ...init, signal: controller.signal });
      } catch (error) {
        if (timedOut) {
          const timeoutError = new Error("تأخر اتصال الخادم. تحقق من الإنترنت ثم أعد المحاولة.");
          timeoutError.name = "TimeoutError";
          throw timeoutError;
        }
        throw error;
      } finally {
        window.clearTimeout(timer);
        externalSignal?.removeEventListener?.("abort", onAbort);
      }
    };
  }

  function installRecoveryStyles() {
    if (document.querySelector("style[data-runtime-recovery]")) return;
    const style = document.createElement("style");
    style.dataset.runtimeRecovery = RELEASE_VERSION;
    style.textContent = `
      .network-activity {
        inset: auto 12px calc(12px + env(safe-area-inset-bottom, 0px)) !important;
        width: min(360px, calc(100vw - 24px)) !important;
        min-height: 58px !important;
        padding: 10px 12px !important;
        display: flex !important;
        place-content: initial !important;
        justify-items: initial !important;
        align-items: center !important;
        gap: 10px !important;
        border: 1px solid color-mix(in srgb, var(--brand, #6654d9) 24%, var(--line, #d8dbe2)) !important;
        border-radius: 16px !important;
        background: color-mix(in srgb, var(--canvas, var(--bg, #11121a)) 96%, transparent) !important;
        box-shadow: 0 14px 34px rgba(0, 0, 0, .18) !important;
        backdrop-filter: blur(12px) !important;
        pointer-events: none !important;
      }
      .network-activity[hidden] { display: none !important; }
      .network-activity-orbit {
        width: 34px !important;
        height: 34px !important;
        margin: 0 !important;
        flex: 0 0 34px !important;
      }
      .network-activity-orbit img { width: 20px !important; height: 20px !important; }
      .network-activity strong { font-size: 13px !important; }
      .network-activity small { display: none !important; }
      .store-loading-error { display: grid; justify-items: center; gap: 14px; line-height: 1.8; }
      .store-loading-error[hidden] { display: none !important; }
      .runtime-recovery-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 9px; }
      .runtime-recovery-actions button,
      .runtime-recovery-actions a {
        min-height: 44px;
        padding: 9px 15px;
        border: 1px solid #cfd5de;
        border-radius: 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #202632;
        background: #fff;
        text-decoration: none;
        font: inherit;
        font-weight: 800;
      }
      .runtime-recovery-actions button { color: #fff; border-color: #8f3044; background: #8f3044; }
    `;
    document.head.append(style);
  }

  function addRecoveryActions(errorNode) {
    if (!errorNode || errorNode.querySelector(".runtime-recovery-actions")) return;
    const actions = document.createElement("span");
    actions.className = "runtime-recovery-actions";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "إعادة المحاولة";
    retry.addEventListener("click", () => location.reload());
    const home = document.createElement("a");
    home.href = "/";
    home.textContent = "العودة للرئيسية";
    actions.append(retry, home);
    errorNode.append(actions);
  }

  function revealStoreFailure(message) {
    if (document.body?.dataset.page !== "store") return;
    const app = document.querySelector("#storeApp");
    if (app && !app.hidden) return;
    const loading = document.querySelector("#storeLoading");
    const orbit = loading?.querySelector(".store-loader-orbit");
    const errorNode = loading?.querySelector("#storeLoadingError");
    if (orbit) orbit.hidden = true;
    if (!errorNode) return;
    if (!errorNode.textContent.trim()) errorNode.textContent = message;
    errorNode.hidden = false;
    addRecoveryActions(errorNode);
  }

  function revealBuilderFailure(message) {
    if (document.body?.dataset.page !== "builder") return;
    const notice = document.querySelector("#notice");
    if (!notice) return;
    notice.textContent = message;
    notice.className = "notice error";
    notice.hidden = false;
    document.querySelectorAll(".network-activity").forEach((overlay) => { overlay.hidden = true; });
  }

  function reportRuntimeFailure(message) {
    revealStoreFailure(message);
    revealBuilderFailure(message);
  }

  function installRuntimeRecovery() {
    ensureStorage("sessionStorage");
    ensureStorage("localStorage");
    installFetchDeadline();
    installRecoveryStyles();

    window.addEventListener("error", () => {
      reportRuntimeFailure("تعذر تشغيل الصفحة على هذا المتصفح. أعد المحاولة أو ارجع للرئيسية.");
    });
    window.addEventListener("unhandledrejection", (event) => {
      reportRuntimeFailure(event.reason?.message || "تعذر إكمال تحميل الصفحة. أعد المحاولة.");
    });

    const startWatchdog = () => {
      const errorNode = document.querySelector("#storeLoadingError");
      if (errorNode) {
        const sync = () => { if (!errorNode.hidden) addRecoveryActions(errorNode); };
        new MutationObserver(sync).observe(errorNode, { attributes: true, childList: true, subtree: true });
        sync();
      }
      window.setTimeout(() => {
        const app = document.querySelector("#storeApp");
        const loading = document.querySelector("#storeLoading");
        if (document.body?.dataset.page === "store" && loading && (app?.hidden ?? true)) {
          revealStoreFailure("استغرق تحميل المتجر وقتًا أطول من المتوقع. أعد المحاولة.");
        }
        document.querySelectorAll(".network-activity:not([hidden])").forEach((overlay) => {
          overlay.hidden = true;
        });
      }, WATCHDOG_MS);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startWatchdog, { once: true });
    } else {
      startWatchdog();
    }
  }

  function installFunctionalHardening() {
    if (document.querySelector('script[data-functional-hardening="true"]')) return;
    const script = document.createElement("script");
    script.src = `/assets/functional-hardening.js?v=${RELEASE_VERSION}`;
    script.defer = true;
    script.dataset.functionalHardening = "true";
    document.head.append(script);
  }

  const COPY = {
    ar: "نسخة معاينة مؤقتة — قد تُعاد تهيئة البيانات عند إعادة تشغيل الخادم.",
    en: "Temporary preview — data may reset when the server restarts."
  };
  const DEMO_LABEL = {
    ar: "شاهد متجرًا تجريبيًا",
    en: "View a demo store"
  };

  function locale() {
    return document.documentElement.lang === "en" ? "en" : "ar";
  }

  function installStylesheet() {
    if (document.querySelector('link[data-preview-styles="true"]')) return;
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = `/assets/uchiha-showcase-preview.css?v=${RELEASE_VERSION}`;
    stylesheet.dataset.previewStyles = "true";
    document.head.append(stylesheet);
  }

  function installBanner() {
    let banner = document.querySelector(".uchiha-preview-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "uchiha-preview-banner";
      banner.setAttribute("role", "status");
      banner.setAttribute("aria-live", "polite");
      document.body.prepend(banner);
    }
    const updateCopy = () => { banner.textContent = COPY[locale()]; };
    updateCopy();
    new MutationObserver(updateCopy).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"]
    });
  }

  function installDemoLink() {
    const heroActions = document.querySelector('body[data-page="home"] .hero-actions');
    let link = document.querySelector("[data-demo-store]");
    if (!link && heroActions) {
      link = document.createElement("a");
      link.className = "secondary-button";
      link.dataset.demoStore = "true";
      heroActions.append(link);
    }
    if (!link) return;
    const update = () => {
      link.href = "/store/demo";
      link.textContent = DEMO_LABEL[locale()];
      link.setAttribute("aria-label", DEMO_LABEL[locale()]);
    };
    update();
    new MutationObserver(update).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"]
    });
  }

  async function loadPreviewState() {
    installDemoLink();
    try {
      const response = await fetch("/api/public/config", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" }
      });
      if (!response.ok) return;
      const config = await response.json();
      if (!config.previewMemoryMode) return;
      document.documentElement.dataset.previewMemory = "true";
      installStylesheet();
      installBanner();
    } catch {
      // Preview status must never block a functional application screen.
    }
  }

  installRouteRecoveryAsset();
  installLaunchSales();
  installRuntimeRecovery();
  installFunctionalHardening();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", loadPreviewState, { once: true });
  else loadPreviewState();
})();
