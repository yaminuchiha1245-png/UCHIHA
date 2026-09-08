(() => {
  "use strict";

  const RELEASE_VERSION = "2026.08.05.2";
  const DEMO_SLUG = "demo";
  const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

  function isDemoHostname() {
    return location.hostname.toLowerCase().startsWith(`${DEMO_SLUG}.`);
  }

  function normalizeDemoPath() {
    if (!isDemoHostname() || (location.pathname !== "/" && location.pathname !== "")) return;
    history.replaceState(history.state, "", `/store/${DEMO_SLUG}${location.search}${location.hash}`);
    if (document.body) document.body.dataset.page = "store";
  }

  // This script is deferred immediately before app.js. Restore the canonical store
  // route synchronously so app.js resolves the slug as "demo", not "undefined".
  normalizeDemoPath();

  const COPY = {
    ar: {
      eyebrow: "متجر UCHIHA الجاهز",
      title: "نسخة تجريبية قيد التطوير",
      summary: "هذا هو المتجر الجاهز الذي سيُطرح داخل المنصة. ستشاهد التعديلات هنا أولًا بأول قبل إطلاقه للزبائن.",
      current: "المرحلة الحالية",
      currentValue: "تحسين الواجهة وتجربة الهاتف",
      progress: "نسبة الإنجاز الحالية",
      openStages: "عرض مراحل التطوير",
      copyLink: "نسخ رابط المتجر",
      copied: "تم نسخ الرابط",
      fallbackCopied: "انسخ الرابط من شريط المتصفح",
      safeNotice: "المتجر للعرض فقط حاليًا؛ الطلبات والمدفوعات الحقيقية معطلة حتى موعد الإطلاق.",
      dialogTitle: "مراحل تطوير المتجر الجاهز",
      dialogDescription: "تتحدث هذه المراحل مع كل دفعة تطوير على نفس رابط المعاينة.",
      close: "إغلاق",
      done: "مكتملة",
      active: "قيد التنفيذ",
      planned: "قادمة",
      canonical: "رابط المعاينة الدائم",
      stages: [
        ["البنية وقاعدة البيانات", "متجر PostgreSQL حقيقي مع حماية كاملة لوضع العرض.", "done"],
        ["الأقسام والمنتجات والبحث", "أقسام رئيسية وفرعية ومنتجات وبحث قابل للتوسع.", "done"],
        ["الحساب والمحفظة والطلبات", "تجربة الحساب والمحفظة والطلبات والدعم جاهزة للمعاينة.", "done"],
        ["التصميم وتجربة الهاتف", "توحيد الواجهة وتحسين الهيدر والتنقل والبطاقات على الهاتف.", "active"],
        ["الدفع والربط والتجهيز للبيع", "تجهيز الدفع والاشتراك وإعدادات كل متجر بأمان.", "planned"],
        ["إطلاقه كمنتج داخل المنصة", "تحديد السعر والشراء المباشر ونشر القالب داخل UCHIHA Builder.", "planned"]
      ]
    },
    en: {
      eyebrow: "UCHIHA ready-made store",
      title: "Demo currently in development",
      summary: "This ready-made storefront will be released inside the platform. New changes appear here before customer launch.",
      current: "Current stage",
      currentValue: "Interface and mobile experience refinement",
      progress: "Current completion",
      openStages: "View development stages",
      copyLink: "Copy store link",
      copied: "Link copied",
      fallbackCopied: "Copy the link from your browser",
      safeNotice: "This store is display-only for now; real orders and payments remain disabled until launch.",
      dialogTitle: "Ready-made store development stages",
      dialogDescription: "These stages update with every development batch on the same preview link.",
      close: "Close",
      done: "Completed",
      active: "In progress",
      planned: "Upcoming",
      canonical: "Permanent preview link",
      stages: [
        ["Architecture and database", "A real PostgreSQL storefront with strict display-only safeguards.", "done"],
        ["Categories, products, and search", "Scalable categories, products, and search are available.", "done"],
        ["Account, wallet, and orders", "Account, wallet, order, and support flows are ready for preview.", "done"],
        ["Design and mobile experience", "Unifying navigation, cards, header, and mobile usability.", "active"],
        ["Payments and sales readiness", "Preparing payments, subscriptions, and secure per-store settings.", "planned"],
        ["Platform product launch", "Adding pricing and direct purchase, then publishing it in UCHIHA Builder.", "planned"]
      ]
    }
  };

  function locale() {
    return document.documentElement.lang === "en" ? "en" : "ar";
  }

  function isDemoStore() {
    const pathMatch = new RegExp(`^/store/${DEMO_SLUG}/?$`).test(location.pathname);
    return pathMatch || location.hostname.toLowerCase().startsWith(`${DEMO_SLUG}.`);
  }

  function validBaseDomain(value) {
    const domain = String(value || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
    if (!domain || domain === "localhost" || domain.endsWith(".localhost")) return "";
    return DOMAIN_PATTERN.test(domain) ? domain : "";
  }

  function canonicalDemoUrl(config) {
    const baseDomain = validBaseDomain(config?.storeBaseDomain);
    if (baseDomain) return `https://${DEMO_SLUG}.${baseDomain}/`;
    return `${location.origin}/store/${DEMO_SLUG}`;
  }

  async function loadConfig() {
    try {
      const response = await fetch("/api/public/config", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" }
      });
      return response.ok ? await response.json() : {};
    } catch {
      return {};
    }
  }

  function updateGlobalDemoLinks(url) {
    document.querySelectorAll("[data-demo-store]").forEach((link) => {
      link.href = url;
    });
  }

  function installStyles() {
    if (document.querySelector("style[data-demo-development]")) return;
    const style = document.createElement("style");
    style.dataset.demoDevelopment = RELEASE_VERSION;
    style.textContent = `
      .demo-development-card{width:min(1180px,calc(100% - 24px));margin:14px auto 4px;padding:16px;display:grid;gap:13px;border:1px solid color-mix(in srgb,var(--store-primary,#8f3044) 34%,var(--store-border,#2b2e3a));border-radius:max(16px,var(--store-radius,16px));background:radial-gradient(circle at 88% 0%,color-mix(in srgb,var(--store-primary,#8f3044) 18%,transparent),transparent 42%),var(--store-surface,#151822);color:var(--store-text,#f7f6fb);box-shadow:0 18px 44px rgba(0,0,0,.14)}
      .demo-development-card__head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.demo-development-card h2{margin:3px 0 5px;font-size:clamp(20px,5vw,30px)}.demo-development-card p{margin:0;color:var(--store-muted,#aaa);line-height:1.75}.demo-development-eyebrow{font-size:12px;font-weight:900;color:var(--store-primary,#d74768)}.demo-development-badge{flex:0 0 auto;padding:7px 10px;border-radius:999px;background:color-mix(in srgb,var(--store-primary,#8f3044) 18%,transparent);font-size:12px;font-weight:900}
      .demo-development-progress{display:grid;gap:8px}.demo-development-progress__labels{display:flex;justify-content:space-between;gap:10px;font-size:13px}.demo-development-progress__track{height:9px;overflow:hidden;border-radius:999px;background:color-mix(in srgb,var(--store-border,#2b2e3a) 75%,transparent)}.demo-development-progress__track i{display:block;width:58%;height:100%;border-radius:inherit;background:var(--store-primary,#d74768)}
      .demo-development-card__actions{display:flex;flex-wrap:wrap;gap:9px}.demo-development-card button{min-height:42px;padding:9px 13px;border:1px solid var(--store-border,#343743);border-radius:11px;background:transparent;color:inherit;font:inherit;font-weight:900}.demo-development-card button.primary{border-color:var(--store-primary,#d74768);background:var(--store-primary,#d74768);color:var(--store-on-primary,#fff)}.demo-development-notice{padding:10px 12px;border-radius:11px;background:color-mix(in srgb,var(--store-warning,#d97706) 12%,transparent);font-size:13px}
      .demo-development-dialog{width:min(680px,calc(100% - 22px));max-height:min(760px,calc(100dvh - 28px));padding:0;border:1px solid #343743;border-radius:18px;background:#11131a;color:#f7f6fb}.demo-development-dialog::backdrop{background:rgba(4,5,8,.72);backdrop-filter:blur(5px)}.demo-development-dialog__inner{padding:17px;display:grid;gap:14px}.demo-development-dialog__header{display:flex;justify-content:space-between;gap:12px}.demo-development-dialog__header h2,.demo-development-dialog__header p{margin:0}.demo-development-dialog__header p{margin-top:5px;color:#aaa;line-height:1.6}.demo-development-dialog__close{width:42px;height:42px;border:1px solid #343743;border-radius:12px;background:#1c1f29;color:#fff;font-size:25px}.demo-development-stage-list{display:grid;gap:9px;margin:0;padding:0;list-style:none}.demo-development-stage{display:grid;grid-template-columns:34px 1fr auto;gap:10px;align-items:start;padding:11px;border:1px solid #30333f;border-radius:13px}.demo-development-stage__number{width:32px;height:32px;display:grid;place-items:center;border-radius:10px;background:#222631;font-weight:900}.demo-development-stage__copy{display:grid;gap:4px}.demo-development-stage__copy small{color:#aaa;line-height:1.55}.demo-development-stage__status{padding:5px 8px;border-radius:999px;background:#242833;font-size:11px;font-weight:900}.demo-development-stage[data-status="active"]{border-color:#a23d55}.demo-development-stage[data-status="done"] .demo-development-stage__status{color:#80e0a7}.demo-development-canonical{display:grid;gap:5px;padding:11px;border-radius:12px;background:#1b1e27}.demo-development-canonical a{direction:ltr;color:#bfc8ff;overflow-wrap:anywhere}
      @media(max-width:520px){.demo-development-card__head{display:grid}.demo-development-badge{justify-self:start}.demo-development-progress__labels{display:grid}.demo-development-stage{grid-template-columns:32px 1fr}.demo-development-stage__status{grid-column:2;justify-self:start}}
    `;
    document.head.append(style);
  }

  function statusLabel(copy, status) {
    return copy[status] || status;
  }

  function installDemoExperience(url) {
    if (!isDemoStore() || document.querySelector(".demo-development-card")) return;
    installStyles();

    const main = document.querySelector("#storeApp main") || document.querySelector("main");
    if (!main) return;

    const card = document.createElement("section");
    card.className = "demo-development-card";
    card.setAttribute("aria-label", "Demo development status");

    const dialog = document.createElement("dialog");
    dialog.className = "demo-development-dialog";

    const render = () => {
      const copy = COPY[locale()];
      card.innerHTML = `
        <div class="demo-development-card__head">
          <div><span class="demo-development-eyebrow">${copy.eyebrow}</span><h2>${copy.title}</h2><p>${copy.summary}</p></div>
          <span class="demo-development-badge">${copy.active}</span>
        </div>
        <div class="demo-development-progress">
          <div class="demo-development-progress__labels"><span>${copy.current}: <b>${copy.currentValue}</b></span><strong>58%</strong></div>
          <div class="demo-development-progress__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="58" aria-label="${copy.progress}"><i></i></div>
        </div>
        <div class="demo-development-card__actions"><button class="primary" type="button" data-open-demo-stages>${copy.openStages}</button><button type="button" data-copy-demo-link>${copy.copyLink}</button></div>
        <p class="demo-development-notice">${copy.safeNotice}</p>`;

      dialog.innerHTML = `
        <div class="demo-development-dialog__inner">
          <header class="demo-development-dialog__header"><div><h2>${copy.dialogTitle}</h2><p>${copy.dialogDescription}</p></div><button class="demo-development-dialog__close" type="button" data-close-demo-stages aria-label="${copy.close}">×</button></header>
          <ol class="demo-development-stage-list">${copy.stages.map(([title, description, status], index) => `<li class="demo-development-stage" data-status="${status}"><span class="demo-development-stage__number">${index + 1}</span><span class="demo-development-stage__copy"><b>${title}</b><small>${description}</small></span><span class="demo-development-stage__status">${statusLabel(copy, status)}</span></li>`).join("")}</ol>
          <div class="demo-development-canonical"><small>${copy.canonical}</small><a href="${url}">${url}</a></div>
        </div>`;

      card.querySelector("[data-open-demo-stages]")?.addEventListener("click", () => dialog.showModal());
      card.querySelector("[data-copy-demo-link]")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        try {
          await navigator.clipboard.writeText(url);
          button.textContent = copy.copied;
        } catch {
          button.textContent = copy.fallbackCopied;
        }
        window.setTimeout(() => { button.textContent = copy.copyLink; }, 1800);
      });
      dialog.querySelector("[data-close-demo-stages]")?.addEventListener("click", () => dialog.close());
    };

    render();
    main.prepend(card);
    document.body.append(dialog);
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.append(robots);
    }
    robots.content = "noindex,nofollow,noarchive";
  }

  async function initialize() {
    const config = await loadConfig();
    const url = canonicalDemoUrl(config);
    updateGlobalDemoLinks(url);
    installDemoExperience(url);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
