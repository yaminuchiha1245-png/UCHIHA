(() => {
  "use strict";

  const RELEASE_VERSION = "2026.08.09.1";
  const DESIGN_RELEASE = "2026.08.02.3";
  const STORE_LOADING_TIMEOUT_MS = 15500;
  const CACHE_RESET_MARKER = `uchiha-route-cache-reset-${RELEASE_VERSION}`;

  function installFinalDesignAssets() {
    if (!document.querySelector('link[data-final-design="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `/assets/final-design.css?v=${DESIGN_RELEASE}`;
      link.dataset.finalDesign = "true";
      document.head.append(link);
    }
    if (!document.querySelector('script[data-final-design="true"]')) {
      const script = document.createElement("script");
      script.src = `/assets/final-design.js?v=${DESIGN_RELEASE}`;
      script.async = false;
      script.dataset.finalDesign = "true";
      document.head.append(script);
    }
  }

  async function clearUchihaCaches({ unregister = false } = {}) {
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith("uchiha-")).map((key) => caches.delete(key)));
      }
      if (unregister && "serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
    } catch {
      // Recovery must remain usable when browser storage is restricted.
    }
  }

  function recoveryPanel(message) {
    document.body.innerHTML = "";
    const main = document.createElement("main");
    main.setAttribute("role", "main");
    main.style.cssText = "min-height:100dvh;display:grid;place-items:center;padding:24px;background:#f7f8fa;color:#20242d;font-family:system-ui;text-align:center";
    const card = document.createElement("section");
    card.style.cssText = "width:min(430px,100%);padding:24px;border:1px solid #d9dde5;border-radius:18px;background:#fff;box-shadow:0 16px 44px rgba(20,25,35,.1)";
    const title = document.createElement("h1");
    title.textContent = "جارٍ إصلاح الصفحة";
    title.style.cssText = "margin:0 0 10px;font-size:22px";
    const text = document.createElement("p");
    text.textContent = message;
    text.style.cssText = "margin:0;line-height:1.8;color:#596170";
    card.append(title, text);
    main.append(card);
    document.body.append(main);
  }

  async function recoverWrongDocument() {
    if (document.body?.dataset.page !== "recovery") return false;
    const marker = `uchiha-route-recovery:${location.pathname}`;
    recoveryPanel("تم اكتشاف نسخة قديمة محفوظة في المتصفح. سنعيد فتح الصفحة الصحيحة الآن.");
    if (sessionStorage.getItem(marker) === RELEASE_VERSION) {
      const card = document.querySelector("main section");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "إعادة المحاولة";
      button.style.cssText = "margin-top:16px;min-height:44px;padding:10px 18px;border:0;border-radius:12px;background:#8f3044;color:#fff;font:inherit;font-weight:800";
      button.addEventListener("click", async () => {
        await clearUchihaCaches({ unregister: true });
        location.replace(`${location.pathname}?refresh=${Date.now()}`);
      });
      card?.append(button);
      return true;
    }
    sessionStorage.setItem(marker, RELEASE_VERSION);
    await clearUchihaCaches({ unregister: true });
    const url = new URL(location.href);
    url.searchParams.set("refresh", Date.now().toString());
    location.replace(url);
    return true;
  }

  function installDirectBuilderView() {
    if (document.body?.dataset.page !== "builder" || location.pathname !== "/create-store") return;
    document.body.classList.add("builder-direct-route");
    if (!document.querySelector('style[data-builder-direct-route="true"]')) {
      const style = document.createElement("style");
      style.dataset.builderDirectRoute = "true";
      style.textContent = `
        body.builder-direct-route>.topbar nav,
        body.builder-direct-route>.topbar .pwa-install,
        body.builder-direct-route main>.hero,
        body.builder-direct-route main>#services,
        body.builder-direct-route main>#how,
        body.builder-direct-route main>#templates,
        body.builder-direct-route>footer{display:none!important}
        body.builder-direct-route .builder-shell{margin-block:1rem 2rem;min-height:calc(100dvh - 96px)}
        @media(max-width:720px){body.builder-direct-route .builder-shell{padding:12px;margin-block-start:.5rem}}
      `;
      document.head.append(style);
    }
    requestAnimationFrame(() => document.querySelector("#start")?.scrollIntoView({ block: "start" }));
  }

  function addStoreRecoveryActions(errorNode) {
    if (!errorNode || errorNode.querySelector(".runtime-recovery-actions")) return;
    const actions = document.createElement("span");
    actions.className = "runtime-recovery-actions";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "إعادة المحاولة";
    retry.addEventListener("click", async () => {
      retry.disabled = true;
      await clearUchihaCaches({ unregister: true });
      const url = new URL(location.href);
      url.searchParams.set("refresh", Date.now().toString());
      location.replace(url);
    });
    const home = document.createElement("a");
    home.href = "/";
    home.textContent = "العودة للمنصة";
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
    errorNode.hidden = false;
    if (!errorNode.textContent.trim()) errorNode.textContent = message;
    addStoreRecoveryActions(errorNode);
  }

  function installStoreFailSafe() {
    if (document.body?.dataset.page !== "store") return;
    const app = document.querySelector("#storeApp");
    const errorNode = document.querySelector("#storeLoadingError");
    if (errorNode) {
      const syncActions = () => { if (!errorNode.hidden) addStoreRecoveryActions(errorNode); };
      new MutationObserver(syncActions).observe(errorNode, { attributes: true, childList: true, subtree: true });
      syncActions();
    }
    window.setTimeout(() => {
      if (app?.hidden ?? true) revealStoreFailure("استغرق تحميل المتجر وقتًا أطول من المتوقع. أعد المحاولة.");
    }, STORE_LOADING_TIMEOUT_MS);
  }

  async function resetStaleCacheOnce() {
    try {
      if (localStorage.getItem(CACHE_RESET_MARKER) === "done") return;
      await clearUchihaCaches();
      localStorage.setItem(CACHE_RESET_MARKER, "done");
    } catch {
      await clearUchihaCaches();
    }
  }

  async function install() {
    if (await recoverWrongDocument()) return;
    installFinalDesignAssets();
    installDirectBuilderView();
    installStoreFailSafe();
    // PWA registration is owned exclusively by pwa.js. Keeping a second
    // registration here with another script URL caused controller churn and
    // repeated page reloads on Android browsers.
    await resetStaleCacheOnce();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
