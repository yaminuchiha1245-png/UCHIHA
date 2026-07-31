(() => {
  "use strict";

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
      const style = document.createElement("style");
      style.textContent = `
        .uchiha-preview-banner {
          position: sticky;
          inset-block-start: 0;
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 30px;
          padding: 5px 14px;
          border-bottom: 1px solid rgba(240, 170, 53, .42);
          background: rgba(35, 27, 10, .96);
          color: #ffe7ae;
          font: 600 12px/1.5 Tajawal, Cairo, system-ui, sans-serif;
          text-align: center;
          backdrop-filter: blur(12px);
        }
        @media (max-width: 640px) {
          .uchiha-preview-banner { min-height: 34px; font-size: 11px; }
        }
      `;
      document.head.append(style);

      const banner = document.createElement("div");
      banner.className = "uchiha-preview-banner";
      banner.setAttribute("role", "status");
      banner.setAttribute("aria-live", "polite");
      banner.textContent = "نسخة تجريبية — البيانات مؤقتة وقد تُعاد تهيئتها عند إعادة تشغيل الخادم.";
      document.body.prepend(banner);
    } catch {
      // Preview decoration must never block the application UI.
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadPreviewState, { once: true });
  } else {
    loadPreviewState();
  }
})();
