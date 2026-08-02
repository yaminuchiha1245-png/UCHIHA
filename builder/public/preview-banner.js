(() => {
  "use strict";

  const RELEASE_VERSION = "2026.08.02.2";

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

  installFunctionalHardening();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", loadPreviewState, { once: true });
  else loadPreviewState();
})();
