(() => {
  "use strict";

  const demoCategories = [
    { icon: "💬", title: "بطاقات الاتصال", description: "واتساب وتيليجرام وخدمات التواصل" },
    { icon: "₿", title: "العملات الرقمية", description: "خدمات العملات والمحافظ الرقمية" },
    { icon: "📱", title: "الرصيد والاتصالات", description: "شحن الرصيد والباقات المحلية" },
    { icon: "▶", title: "مواقع التواصل", description: "خدمات المنصات والحسابات الرقمية" },
    { icon: "🎬", title: "المشاهدة والترفيه", description: "أفلام ومسلسلات واشتراكات" },
    { icon: "🎮", title: "ألعاب المنصات", description: "بطاقات وألعاب وخدمات المنصات" },
    { icon: "</>", title: "خدمات البرمجة", description: "مواقع وتطبيقات وبوتات" },
    { icon: "🛡", title: "الخدمات التقنية", description: "حماية وإعدادات وأدوات" },
    { icon: "✦", title: "التصميم والجرافيك", description: "تصميم احترافي وهوية بصرية" }
  ];

  function installShowcaseStyles() {
    if (document.querySelector('link[data-uchiha-showcase="true"]')) return;
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/assets/uchiha-showcase-preview.css?v=20260731-showcase";
    stylesheet.dataset.uchihaShowcase = "true";
    document.head.append(stylesheet);
  }

  function showDemoToast() {
    document.querySelector(".showcase-demo-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "showcase-demo-toast";
    toast.setAttribute("role", "status");
    toast.textContent = "هذا قسم تجريبي للمعاينة البصرية، وستُربط منتجاته من لوحة الإدارة لاحقًا.";
    document.body.append(toast);
    window.setTimeout(() => toast.remove(), 2800);
  }

  function appendShowcaseCategories() {
    if (document.body.dataset.page !== "store") return;
    const grid = document.querySelector("#storeCategories");
    if (!grid || grid.querySelector(".showcase-demo-category")) return;

    for (const category of demoCategories) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "showcase-demo-category";
      button.innerHTML = `
        <span class="showcase-demo-icon" aria-hidden="true">${category.icon}</span>
        <strong>${category.title}</strong>
        <small>${category.description}</small>
      `;
      button.addEventListener("click", showDemoToast);
      grid.append(button);
    }
  }

  function watchStoreGrid() {
    if (document.body.dataset.page !== "store") return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      appendShowcaseCategories();
      const grid = document.querySelector("#storeCategories");
      if (grid?.querySelector(".showcase-demo-category") || attempts >= 60) {
        window.clearInterval(timer);
        if (grid) {
          const observer = new MutationObserver(() => appendShowcaseCategories());
          observer.observe(grid, { childList: true });
        }
      }
    }, 200);
  }

  function installPreviewBanner() {
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
      document.body.classList.add("uchiha-showcase-preview");
      installShowcaseStyles();
      installPreviewBanner();
      watchStoreGrid();
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
