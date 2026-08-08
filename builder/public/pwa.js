(() => {
  "use strict";

  // Service-worker registration is intentionally owned by this file only.
  const RELEASE_VERSION = "2026.08.08.19";

  if (!window.__uchihaFetchInstrumented) {
    window.__uchihaFetchInstrumented = true;
    const originalFetch = window.fetch.bind(window);
    let activeRequests = 0;
    let revealTimer = null;
    let visibleSince = 0;

    const overlay = document.createElement("div");
    overlay.className = "network-activity";
    overlay.hidden = true;
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = `
      <span class="network-activity-orbit"><img src="/assets/brand/uchiha-mark.svg" alt=""></span>
      <strong>جارٍ إكمال العملية</strong>
      <small>لحظة واحدة…</small>`;
    document.body.append(overlay);

    const startActivity = () => {
      activeRequests += 1;
      if (activeRequests !== 1) return;
      revealTimer = window.setTimeout(() => {
        if (!activeRequests) return;
        overlay.hidden = false;
        visibleSince = Date.now();
      }, 180);
    };

    const endActivity = () => {
      activeRequests = Math.max(0, activeRequests - 1);
      if (activeRequests) return;
      window.clearTimeout(revealTimer);
      const remaining = Math.max(0, 260 - (Date.now() - visibleSince));
      window.setTimeout(() => {
        if (!activeRequests) overlay.hidden = true;
      }, overlay.hidden ? 0 : remaining);
    };

    window.fetch = async (input, init) => {
      let tracked = false;
      try {
        const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
        const method = String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
        tracked = target.origin === location.origin && target.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(method);
      } catch {
        tracked = false;
      }
      if (tracked) startActivity();
      try {
        return await originalFetch(input, init);
      } finally {
        if (tracked) endActivity();
      }
    };
  }

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => {
      // Register once and let the worker take control without forcing a page reload.
      // Calling location.reload() from controllerchange created a reload loop when an
      // older recovery script registered the same scope with a different script URL.
      navigator.serviceWorker
        .register(`/sw.js?v=${RELEASE_VERSION}`, { scope: "/", updateViaCache: "none" })
        .catch(() => undefined);
    }, { once: true });
  }

  let installPrompt = null;
  const installButtons = [];

  function makeButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pwa-install";
    button.textContent = "تثبيت UCHIHA";
    button.hidden = true;
    button.addEventListener("click", async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      installButtons.forEach((item) => { item.hidden = true; });
    });
    installButtons.push(button);
    return button;
  }

  function mountInstallButtons() {
    const topbar = document.querySelector('body[data-page="builder"] .topbar-actions');
    if (topbar) topbar.prepend(makeButton());
    const drawer = document.querySelector(".drawer-preferences");
    if (drawer) drawer.prepend(makeButton());
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installButtons.forEach((button) => { button.hidden = false; });
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installButtons.forEach((button) => { button.hidden = true; });
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountInstallButtons, { once: true });
  else mountInstallButtons();
})();
