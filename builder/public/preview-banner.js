(() => {
  "use strict";

  const COPY = {
    ar: "نسخة معاينة مؤقتة — قد تُعاد تهيئة البيانات عند إعادة تشغيل الخادم.",
    en: "Temporary preview — data may reset when the server restarts."
  };

  function locale() {
    return document.documentElement.lang === "en" ? "en" : "ar";
  }

  function installStylesheet() {
    if (document.querySelector('link[data-preview-styles="true"]')) return;
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/assets/uchiha-showcase-preview.css?v=20260801-neutral";
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
    const updateCopy = () => {
      banner.textContent = COPY[locale()];
    };
    updateCopy();
    new MutationObserver(updateCopy).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"]
    });
  }

  async function loadPreviewState() {
    try {
      const response = await fetch("/api/public/config", {
        credentials: "same-origin",
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadPreviewState, { once: true });
  } else {
    loadPreviewState();
  }
})();
