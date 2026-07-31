(() => {
  "use strict";

  const realCategoryReferences = [
    {
      title: "قسم الألعاب",
      description: "شحن الألعاب والخدمات الرقمية",
      chips: ["PUBG", "FF", "G", "PS"]
    },
    {
      title: "قسم الاشتراكات",
      description: "اشتراكات ترفيه وأدوات عمل",
      chips: ["N", "D+", "TV", "SP"]
    },
    {
      title: "قسم العملات الرقمية",
      description: "خدمات العملات والمحافظ الرقمية",
      chips: ["BTC", "USDT", "BNB", "ETH"]
    }
  ];

  const demoCategories = [
    {
      title: "قسم بطاقات الاتصال",
      description: "واتساب وتيليجرام وخدمات التواصل",
      chips: ["WA", "TG", "IMO", "VB"]
    },
    {
      title: "قسم الرصيد والاتصالات",
      description: "شحن الرصيد والباقات المحلية",
      chips: ["MTN", "STC", "Zain", "As"]
    },
    {
      title: "قسم مواقع التواصل",
      description: "خدمات المنصات والحسابات الرقمية",
      chips: ["f", "IG", "YT", "TT"]
    },
    {
      title: "قسم الألعاب السوني",
      description: "ألعاب وبطاقات ومنصات رقمية",
      chips: ["PS", "X", "Steam", "Epic"]
    },
    {
      title: "قسم المشاهدة",
      description: "أفلام ومسلسلات واشتراكات",
      chips: ["N", "D+", "TV", "OSN"]
    },
    {
      title: "خدمات البرمجة",
      description: "مواقع وتطبيقات وبوتات",
      chips: ["</>", "WEB", "APP", "BOT"]
    },
    {
      title: "الخدمات التقنية",
      description: "حماية وإعدادات وأدوات",
      chips: ["SEC", "VPN", "API", "SYS"]
    },
    {
      title: "التصميم والجرافيك",
      description: "تصميم احترافي وهوية بصرية",
      chips: ["UI", "UX", "3D", "LOGO"]
    },
    {
      title: "الدعم والمساعدة",
      description: "نحن هنا لمساعدتك",
      chips: ["24/7", "WA", "TG", "HELP"]
    }
  ];

  function installStylesheet(href, marker) {
    if (document.querySelector(`link[data-${marker}="true"]`)) return;
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = href;
    stylesheet.setAttribute(`data-${marker}`, "true");
    document.head.append(stylesheet);
  }

  function installShowcaseStyles() {
    installStylesheet(
      "/assets/uchiha-showcase-preview.css?v=20260731-showcase",
      "uchiha-showcase"
    );
    installStylesheet(
      "/assets/uchiha-reference-design.css?v=20260731-reference-1",
      "uchiha-reference"
    );
  }

  function showDemoToast(message = "هذا عنصر تجريبي للمعاينة، وستتم إدارته من لوحة التحكم لاحقًا.") {
    document.querySelector(".showcase-demo-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "showcase-demo-toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.append(toast);
    window.setTimeout(() => toast.remove(), 2800);
  }

  function createLogoCluster(chips) {
    const cluster = document.createElement("span");
    cluster.className = "showcase-logo-cluster";
    cluster.setAttribute("aria-hidden", "true");
    for (const chipText of chips) {
      const chip = document.createElement("span");
      chip.className = "showcase-logo-chip";
      chip.textContent = chipText;
      cluster.append(chip);
    }
    return cluster;
  }

  function decorateRealCategories() {
    const grid = document.querySelector("#storeCategories");
    if (!grid) return false;
    const cards = [...grid.children].filter(
      (item) => !item.classList.contains("showcase-demo-category")
    );

    cards.slice(0, realCategoryReferences.length).forEach((card, index) => {
      const reference = realCategoryReferences[index];
      card.classList.add("showcase-real-category");
      if (!card.querySelector(".showcase-logo-cluster")) {
        card.prepend(createLogoCluster(reference.chips));
      }
      const title = card.querySelector("h2, h3, strong, b");
      const description = card.querySelector("p, small");
      if (title) title.textContent = reference.title;
      if (description) description.textContent = reference.description;
    });
    return cards.length > 0;
  }

  function appendShowcaseCategories() {
    if (document.body.dataset.page !== "store") return false;
    const grid = document.querySelector("#storeCategories");
    if (!grid) return false;
    decorateRealCategories();
    if (grid.querySelector(".showcase-demo-category")) return true;

    for (const category of demoCategories) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "showcase-demo-category";
      button.setAttribute("aria-label", category.title);
      button.append(createLogoCluster(category.chips));

      const title = document.createElement("strong");
      title.textContent = category.title;
      const description = document.createElement("small");
      description.textContent = category.description;
      button.append(title, description);
      button.addEventListener("click", () => {
        showDemoToast("هذا قسم تجريبي بصري، وستُربط منتجاته من لوحة الإدارة لاحقًا.");
      });
      grid.append(button);
    }
    return true;
  }

  function enhanceStoreCopy() {
    if (document.body.dataset.page !== "store") return;
    const eyebrow = document.querySelector("#storeBannerEyebrow");
    const title = document.querySelector("#storeHeroTitle");
    const description = document.querySelector("#storeDescription");
    const action = document.querySelector("#storeBannerAction");
    const categoryTitle = document.querySelector("#categorySectionTitle");
    const categoryDescription = document.querySelector("#categorySectionDescription");
    const announcement = document.querySelector(".store-announcement > div");

    if (eyebrow) eyebrow.textContent = "أهلًا بك في عالم الأوتشيها";
    if (title) title.textContent = "كل ما تحتاجه في مكان واحد";
    if (description) {
      description.textContent = "منتجات وخدمات رقمية مختارة بعناية، تنفيذ سريع ودعم مستمر.";
    }
    if (action) action.textContent = "تسوّق الآن";
    if (categoryTitle) categoryTitle.textContent = "أقسام المتجر";
    if (categoryDescription) categoryDescription.textContent = "اختر القسم المناسب وابدأ طلبك مباشرة.";

    if (announcement && !announcement.dataset.referenceCopy) {
      announcement.dataset.referenceCopy = "true";
      announcement.replaceChildren();
      for (const text of [
        "عروض حصرية لفترة محدودة 🔥",
        "سرعة وجودة في جميع الطلبات ✓",
        "دعم فني متواصل 24/7 ☾"
      ]) {
        const item = document.createElement("span");
        item.textContent = text;
        announcement.append(item);
      }
    }
  }

  function enhanceWalletPreview() {
    if (document.body.dataset.page !== "account") return;
    const stats = document.querySelector('[data-section="wallet"] .stats-grid');
    if (stats && !stats.querySelector("[data-preview-net-balance]")) {
      const card = document.createElement("article");
      card.className = "stat-card";
      card.dataset.previewNetBalance = "true";
      const label = document.createElement("span");
      label.textContent = "الرصيد الصافي";
      const value = document.createElement("strong");
      value.textContent = "$ 20.793";
      card.append(label, value);
      stats.append(card);
    }

    const actions = document.querySelector('[data-section="wallet"] .wallet-actions');
    if (actions && !actions.querySelector("[data-preview-wallet-action]")) {
      for (const action of [
        ["⇄", "تحويل داخلي"],
        ["↑", "سحب رصيد"]
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.previewWalletAction = "true";
        const icon = document.createElement("span");
        icon.textContent = action[0];
        const label = document.createElement("b");
        label.textContent = action[1];
        button.append(icon, label);
        button.addEventListener("click", () => {
          showDemoToast("هذه العملية محاكاة آمنة في نسخة المعاينة ولا تنقل أموالًا حقيقية.");
        });
        actions.append(button);
      }
    }
  }

  function decorateAccountPages() {
    if (document.body.dataset.page !== "account") return;
    document.querySelectorAll(".page-section[data-section]").forEach((section) => {
      section.classList.add(`showcase-section-${section.dataset.section}`);
    });
    enhanceWalletPreview();
  }

  function watchRenderedContent() {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      enhanceStoreCopy();
      appendShowcaseCategories();
      decorateAccountPages();
      if (attempts >= 70) window.clearInterval(timer);
    }, 180);

    const observer = new MutationObserver(() => {
      enhanceStoreCopy();
      appendShowcaseCategories();
      decorateAccountPages();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function installPreviewBanner() {
    if (document.querySelector(".uchiha-preview-banner")) return;
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
      document.body.classList.add("uchiha-showcase-preview", "uchiha-reference-ready");
      installShowcaseStyles();
      installPreviewBanner();
      watchRenderedContent();
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
