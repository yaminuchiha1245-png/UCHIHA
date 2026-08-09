(() => {
  "use strict";

  const RELEASE_VERSION = "2026.08.09.2";
  const LEGACY_RELEASE_CONTRACT = "2026.08.03.1";
  const STORE_APP_RELEASE = "2026.08.09.2-store-runtime";
  const DEMO_SLUG = "demo";
  const WATCHDOG_MS = 22000;

  function installCompatibility() {
    if (typeof Array.prototype.at !== "function") {
      Object.defineProperty(Array.prototype, "at", {
        configurable: true,
        writable: true,
        value(index) {
          const length = this == null ? 0 : Number(this.length) || 0;
          const relative = Number(index) || 0;
          const position = relative < 0 ? length + relative : relative;
          return position < 0 || position >= length ? undefined : this[position];
        }
      });
    }
    if (typeof window.queueMicrotask !== "function") {
      window.queueMicrotask = (callback) => Promise.resolve().then(callback);
    }
  }

  installCompatibility();

  function isDemoHostname() {
    return location.hostname.toLowerCase().startsWith(`${DEMO_SLUG}.`);
  }

  function normalizeDemoRoute() {
    if (!isDemoHostname()) return;
    if (location.pathname === "/" || location.pathname === "") {
      history.replaceState(history.state, "", `/store/${DEMO_SLUG}${location.search}${location.hash}`);
    }
    if (/^\/store\/[^/]+\/?$/.test(location.pathname) && document.body) {
      document.body.dataset.page = "store";
    }
  }

  normalizeDemoRoute();
  const wrongStoreDocument =
    document.body?.dataset.page === "store" && !/^\/store\/[^/]+\/?$/.test(location.pathname);
  if (wrongStoreDocument) document.body.dataset.page = "recovery";

  function installScript(src, marker, { defer = true } = {}) {
    if (document.querySelector(`script[${marker}="true"]`)) return null;
    const script = document.createElement("script");
    script.src = src;
    script.defer = defer;
    script.async = false;
    script.setAttribute(marker, "true");
    document.head.append(script);
    return script;
  }

  function installStoreAppFresh() {
    if (document.body?.dataset.page !== "store") return;
    normalizeDemoRoute();

    // store.html already contains the canonical deferred app.js script. Removing that
    // parser-managed script and injecting a second copy caused a nondeterministic startup
    // race in Android Custom Tabs. Keep the original script and only provide a fallback
    // when an older document genuinely has no storefront bundle.
    const existing = document.querySelector('script[src^="/assets/app.js"]');
    if (existing) {
      existing.dataset.storeAppRelease = STORE_APP_RELEASE;
      existing.addEventListener("error", () => {
        revealStoreFailure("تعذر تنزيل ملف تشغيل المتجر. أعد تحميل الصفحة.");
      }, { once: true });
      return;
    }

    if (window.__uchihaStoreAppFreshInstalled) return;
    window.__uchihaStoreAppFreshInstalled = true;
    const load = () => {
      if (document.querySelector('script[data-store-app-hotfix="true"]')) return;
      const script = document.createElement("script");
      script.src = `/assets/app.js?v=${STORE_APP_RELEASE}`;
      script.async = false;
      script.dataset.storeAppHotfix = "true";
      script.addEventListener("error", () => {
        revealStoreFailure("تعذر تنزيل ملف تشغيل المتجر. أعد تحميل الصفحة.");
      });
      document.body.append(script);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", load, { once: true });
    } else {
      queueMicrotask(load);
    }
  }

  function ensureStorage(name) {
    try {
      const storage = window[name];
      const probe = `__uchiha_probe_${Date.now()}`;
      storage.setItem(probe, "1");
      storage.removeItem(probe);
    } catch {
      const values = new Map();
      try {
        Object.defineProperty(window, name, {
          configurable: true,
          value: {
            get length() { return values.size; },
            clear() { values.clear(); },
            getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
            key(index) { return [...values.keys()][Number(index)] ?? null; },
            removeItem(key) { values.delete(String(key)); },
            setItem(key, value) { values.set(String(key), String(value)); }
          }
        });
      } catch {
        // The visible watchdog below remains available when storage is fully blocked.
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

  function addRecoveryActions(errorNode) {
    if (!errorNode || errorNode.querySelector(".runtime-recovery-actions")) return;
    const actions = document.createElement("span");
    actions.className = "runtime-recovery-actions";

    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "إعادة المحاولة";
    retry.addEventListener("click", () => {
      const url = new URL(location.href);
      url.searchParams.set("refresh", Date.now().toString());
      location.replace(url);
    });

    const home = document.createElement("a");
    home.href = "https://uchiha-builder.com/";
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

  function installRecoveryStyles() {
    if (document.querySelector("style[data-preview-runtime-recovery]")) return;
    const style = document.createElement("style");
    style.dataset.previewRuntimeRecovery = RELEASE_VERSION;
    style.textContent = `
      .network-activity{pointer-events: none !important}
      .store-loading-error{display:grid;justify-items:center;gap:14px;line-height:1.8;text-align:center;padding:24px}
      .store-loading-error[hidden]{display:none!important}
      .runtime-recovery-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:9px}
      .runtime-recovery-actions button,.runtime-recovery-actions a{min-height:44px;padding:9px 15px;border:1px solid #cfd5de;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;color:#202632;background:#fff;text-decoration:none;font:inherit;font-weight:800}
      .runtime-recovery-actions button{color:#fff;border-color:#8f3044;background:#8f3044}
    `;
    document.head.append(style);
  }

  function installRuntimeRecovery() {
    ensureStorage("sessionStorage");
    ensureStorage("localStorage");
    installFetchDeadline();
    installRecoveryStyles();

    window.addEventListener("error", (event) => {
      const message = event?.error?.message || event?.message || "تعذر تشغيل الصفحة على هذا المتصفح.";
      revealStoreFailure(message);
    });
    window.addEventListener("unhandledrejection", (event) => {
      revealStoreFailure(event.reason?.message || "تعذر إكمال تحميل الصفحة.");
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
        if (document.body?.dataset.page === "store" && (app?.hidden ?? true)) {
          revealStoreFailure("تعذر بدء واجهة المتجر. تم إيقاف شاشة الانتظار بدل تركها معلقة.");
        }
      }, WATCHDOG_MS);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startWatchdog, { once: true });
    } else {
      startWatchdog();
    }
  }

  const COPY = {
    ar: "نسخة معاينة مؤقتة — قد تُعاد تهيئة البيانات عند إعادة تشغيل الخادم.",
    en: "Temporary preview — data may reset when the server restarts."
  };
  const DEMO_LABEL = { ar: "شاهد متجرًا تجريبيًا", en: "View a demo store" };

  function locale() {
    return document.documentElement.lang === "en" ? "en" : "ar";
  }

  function installDemoLink() {
    const heroActions = document.querySelector('body[data-page="home"] .hero-actions');
    // The storefront shell marks its <body> with data-demo-store. Restrict this
    // query to the actual homepage link so updating its text never erases <body>.
    let link = document.querySelector('a[data-demo-store]');
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

  function installPreviewBanner() {
    if (document.querySelector(".uchiha-preview-banner")) return;
    const banner = document.createElement("div");
    banner.className = "uchiha-preview-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    const update = () => { banner.textContent = COPY[locale()]; };
    update();
    document.body.prepend(banner);
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
      if (!document.querySelector('link[data-preview-styles="true"]')) {
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = `/assets/uchiha-showcase-preview.css?v=${RELEASE_VERSION}`;
        stylesheet.dataset.previewStyles = "true";
        document.head.append(stylesheet);
      }
      installPreviewBanner();
    } catch {
      // Preview status must never block storefront startup.
    }
  }

  function installFunctionalHardening() {
    installScript(`/assets/functional-hardening.js?v=${RELEASE_VERSION}`, "data-functional-hardening");
  }

  installScript(`/assets/runtime-recovery.js?v=${RELEASE_VERSION}`, "data-route-recovery");
  installScript(`/assets/launch-builder-sales.js?v=${RELEASE_VERSION}`, "data-launch-sales");
  installRuntimeRecovery();
  installFunctionalHardening();
  installStoreAppFresh();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadPreviewState, { once: true });
  } else {
    loadPreviewState();
  }
})();
