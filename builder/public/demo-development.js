(() => {
  "use strict";

  const RELEASE_VERSION = "2026.08.05.1";
  const DEMO_SLUG = "demo";
  const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

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
      dialogDescription: "هذه المراحل ستتحدث مع كل دفعة تطوير على نفس رابط المعاينة.",
      close: "إغلاق",
      done: "مكتملة",
      active: "قيد التنفيذ",
      planned: "قادمة",
      canonical: "رابط المعاينة الدائم",
      stages: [
        ["البنية وقاعدة البيانات", "المتجر التجريبي مرتبط بقاعدة PostgreSQL حقيقية مع حماية كاملة للعرض.", "done"],
        ["الأقسام والمنتجات والبحث", "عرض الأقسام الرئيسية والفرعية والمنتجات والبحث بطريقة قابلة للتوسع.", "done"],
        ["الحساب والمحفظة والطلبات", "تجربة الحساب والمحفظة والطلبات والدعم موجودة مع تعطيل العمليات المالية في العرض.", "done"],
        ["التصميم وتجربة الهاتف", "توحيد الواجهة، إزالة التداخلات، وتحسين الهيدر والتنقل والبطاقات على الهاتف.", "active"],
        ["الدفع والربط والتجهيز للبيع", "تجهيز طرق الدفع والاشتراك وربط إعدادات كل متجر دون كشف أي بيانات حساسة.", "planned"],
        ["إطلاقه كمنتج داخل المنصة", "إضافة السعر والشراء المباشر ثم نشر القالب ضمن خدمات UCHIHA Builder.", "planned"]
      ]
    },
    en: {
      eyebrow: "UCHIHA ready-made store",
      title: "Demo currently in development",
      summary: "This is the ready-made storefront that will be released inside the platform. New changes will appear here before customer launch.",
      current: "Current stage",
      currentValue: "Interface and mobile experience refinement",
      progress: "Current completion",
      openStages: "View development stages",
      copyLink: "Copy store link",
      copied: "Link copied",
      fallbackCopied: "Copy the link from your browser",
      safeNotice: "This store is display-only for now; real orders and payments remain disabled until launch.",
      dialogTitle: "Ready-made store development stages",
      dialogDescription: "These stages will be updated with every development batch on the same preview link.",
      close: "Close",
      done: "Completed",
      active: "In progress",
      planned: "Upcoming",
      canonical: "Permanent preview link",
      stages: [
        ["Architecture and database", "The demo uses a real PostgreSQL store with strict display-only safeguards.", "done"],
        ["Categories, products, and search", "Scalable main categories, subcategories, products, and search are available.", "done"],
        ["Account, wallet, and orders", "Account, wallet, order, and support flows exist while real financial operations are disabled.", "done"],
        ["Design and mobile experience", "Unifying the interface and improving navigation, cards, header, and mobile usability.", "active"],
        ["Payments and sales readiness", "Preparing payments, subscription activation, and per-store configuration without exposing secrets.", "planned"],
        ["Platform product launch", "Adding pricing and direct purchase, then publishing the template in UCHIHA Builder.", "planned"]
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
      if (!response.ok) return {};
      return await response.json();
    } catch {
      return {};
    }
  }

  function installStyles() {
    if (document.querySelector("style[data-demo-development]")) return;
    const style = document.createElement("style");
    style.dataset.demoDevelopment = RELEASE_VERSION;
    style.textContent = `
      .demo-development-card {
        width: min(1180px, calc(100% - 24px));
        margin: 14px auto 4px;
        padding: 16px;
        display: grid;
        gap: 14px;
        border: 1px solid color-mix(in srgb, var(--store-primary, #8f3044) 34%, var(--store-border, #2b2e3a));
        border-radius: max(16px, var(--store-radius, 16px));
        background:
          radial-gradient(circle at 85% 0%, color-mix(in srgb, var(--store-primary, #8f3044) 18%, transparent), transparent 38%),
          color-mix(in srgb, var(--store-surface, #151822) 97%, transparent);
        color: var(--store-text, #f7f6fb);
        box-shadow: 0 18px 44px rgba(0,0,0,.14);
      }
      .demo-development-card__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
      .demo-development-card__copy { min-width: 0; display: grid; gap: 5px; }
      .demo-development-card__copy small { color: var(--store-primary, #d74768); font-weight: 900; letter-spacing: .02em; }
      .demo-development-card__copy strong { font-size: clamp(18px, 4.8vw, 26px); line-height: 1.25; }
      .demo-development-card__copy p { margin: 0; max-width: 760px; color: var(--store-muted, #b9aab6); line-height: 1.75; }
      .demo-development-badge { flex: 0 0 auto; padding: 7px 10px; border-radius: 999px; background: color-mix(in srgb, var(--store-primary, #8f3044) 18%, transparent); color: var(--store-primary, #d74768); font-size: 12px; font-weight: 900; white-space: nowrap; }
      .demo-development-progress { display: grid; gap: 8px; }
      .demo-development-progress__labels { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; }
      .demo-development-progress__labels span { color: var(--store-muted, #b9aab6); }
      .demo-development-progress__labels b { color: var(--store-text, #f7f6fb); }
      .demo-development-progress__track { height: 9px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--store-border, #2b2e3a) 76%, transparent); }
      .demo-development-progress__track i { display: block; width: 58%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--store-primary, #8f3044), color-mix(in srgb, var(--store-primary, #8f3044) 58%, #ffffff)); }
      .demo-development-card__actions { display: flex; flex-wrap: wrap; gap: 9px; }
      .demo-development-card__actions button,
      .demo-development-card__actions a {
        min-height: 43px;
        padding: 9px 13px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid color-mix(in srgb, var(--store-primary, #8f3044) 34%, var(--store-border, #2b2e3a));
        border-radius: 12px;
        background: transparent;
        color: var(--store-text, #f7f6fb);
        text-decoration: none;
        font: inherit;
        font-weight: 850;
        cursor: pointer;
      }
      .demo-development-card__actions .primary { border-color: var(--store-primary, #8f3044); background: var(--store-primary, #8f3044); color: #fff; }
      .demo-development-notice { margin: 0; padding: 10px 12px; border-radius: 12px; background: color-mix(in srgb, #d78b24 13%, transparent); color: color-mix(in srgb, #d78b24 82%, var(--store-text, #fff)); font-size: 13px; line-height: 1.65; }
      .demo-development-dialog { width: min(680px, calc(100vw - 24px)); max-height: min(760px, calc(100dvh - 24px)); padding: 0; overflow: hidden; border: 1px solid var(--store-border, #2b2e3a); border-radius: 20px; background: var(--store-surface, #151822); color: var(--store-text, #f7f6fb); box-shadow: 0 30px 90px rgba(0,0,0,.42); }
      .demo-development-dialog::backdrop { background: rgba(5,7,12,.72); backdrop-filter: blur(7px); }
      .demo-development-dialog__inner { max-height: inherit; overflow: auto; padding: 18px; display: grid; gap: 16px; }
      .demo-development-dialog__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
      .demo-development-dialog__header div { display: grid; gap: 5px; }
      .demo-development-dialog__header h2 { margin: 0; font-size: clamp(20px, 5vw, 28px); }
      .demo-development-dialog__header p { margin: 0; color: var(--store-muted, #b9aab6); line-height: 1.7; }
      .demo-development-dialog__close { width: 42px; height: 42px; flex: 0 0 42px; border: 1px solid var(--store-border, #2b2e3a); border-radius: 12px; background: transparent; color: inherit; font: inherit; font-size: 24px; cursor: pointer; }
      .demo-development-stage-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
      .demo-development-stage { padding: 13px; display: grid; grid-template-columns: 36px minmax(0,1fr) auto; gap: 11px; align-items: start; border: 1px solid var(--store-border, #2b2e3a); border-radius: 14px; background: color-mix(in srgb, var(--store-background, #0c0e14) 54%, transparent); }
      .demo-development-stage__number { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 11px; background: color-mix(in srgb, var(--store-primary, #8f3044) 14%, transparent); color: var(--store-primary, #d74768); font-weight: 900; }
      .demo-development-stage__copy { min-width: 0; display: grid; gap: 4px; }
      .demo-development-stage__copy b { line-height: 1.35; }
      .demo-development-stage__copy small { color: var(--store-muted, #b9aab6); line-height: 1.65; }
      .demo-development-stage__status { padding: 5px 8px; border-radius: 999px; font-size: 11px; font-weight: 900; white-space: nowrap; }
      .demo-development-stage[data-status="done"] .demo-development-stage__status { background: rgba(37,164,99,.14); color: #49c986; }
      .demo-development-stage[data-status="active"] { border-color: color-mix(in srgb, var(--store-primary, #8f3044) 55%, var(--store-border, #2b2e3a)); }
      .demo-development-stage[data-status="active"] .demo-development-stage__status { background: color-mix(in srgb, var(--store-primary, #8f3044) 17%, transparent); color: var(--store-primary, #d74768); }
      .demo-development-stage[data-status="planned"] .demo-development-stage__status { background: rgba(128,137,156,.13); color: var(--store-muted, #b9aab6); }
      .demo-development-canonical { padding: 11px 12px; display: grid; gap: 5px; border: 1px dashed var(--store-border, #2b2e3a); border-radius: 12px; overflow-wrap: anywhere; }
      .demo-development-canonical small { color: var(--store-muted, #b9aab6); }
      .demo-development-canonical a { color: var(--store-primary, #d74768); direction: ltr; text-align: left; }
      @media (max-width: 620px) {
        .demo-development-card { width: calc(100% - 16px); margin-top: 8px; padding: 13px; }
        .demo-development-card__head { display: grid; }
        .demo-development-badge { justify-self: start; }
        .demo-development-card__actions { display: grid; grid-template-columns: 1fr; }
        .demo-development-stage { grid-template-columns: 34px minmax(0,1fr); }
        .demo-development-stage__status { grid-column: 2; justify-self: start; }
      }
    `;
    document.head.append(style);
  }

  function statusLabel(copy, status) {
    if (status === "done") return copy.done;
    if (status === "active") return copy.active;
    return copy.planned;
  }

  function updateGlobalDemoLinks(url) {
    document.querySelectorAll("[data-demo-store]").forEach((link) => {
      link.href = url;
      link.dataset.demoCanonical = url;
    });
  }

  function installDemoExperience(url) {
    if (!isDemoStore() || document.querySelector("[data-demo-development-card]")) return;
    installStyles();
    document.documentElement.dataset.demoDevelopment = "true";

    const card = document.createElement("section");
    card.className = "demo-development-card";
    card.dataset.demoDevelopmentCard = "true";
    card.setAttribute("aria-labelledby", "demoDevelopmentTitle");

    const dialog = document.createElement("dialog");
    dialog.className = "demo-development-dialog";
    dialog.id = "demoDevelopmentDialog";

    function render() {
      const copy = COPY[locale()];
      card.innerHTML = `
        <div class="demo-development-card__head">
          <div class="demo-development-card__copy">
            <small>${copy.eyebrow}</small>
            <strong id="demoDevelopmentTitle">${copy.title}</strong>
            <p>${copy.summary}</p>
          </div>
          <span class="demo-development-badge">${copy.active}</span>
        </div>
        <div class="demo-development-progress">
          <div class="demo-development-progress__labels"><span>${copy.current}: <b>${copy.currentValue}</b></span><strong>58%</strong></div>
          <div class="demo-development-progress__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="58" aria-label="${copy.progress}"><i></i></div>
        </div>
        <div class="demo-development-card__actions">
          <button class="primary" type="button" data-open-demo-stages>${copy.openStages}</button>
          <button type="button" data-copy-demo-link>${copy.copyLink}</button>
        </div>
        <p class="demo-development-notice">${copy.safeNotice}</p>
      `;

      dialog.innerHTML = `
        <div class="demo-development-dialog__inner">
          <header class="demo-development-dialog__header">
            <div><h2>${copy.dialogTitle}</h2><p>${copy.dialogDescription}</p></div>
            <button class="demo-development-dialog__close" type="button" data-close-demo-stages aria-label="${copy.close}">×</button>
          </header>
          <ol class="demo-development-stage-list">
            ${copy.stages.map(([title, description, status], index) => `
              <li class="demo-development-stage" data-status="${status}">
                <span class="demo-development-stage__number">${index + 1}</span>
                <span class="demo-development-stage__copy"><b>${title}</b><small>${description}</small></span>
                <span class="demo-development-stage__status">${statusLabel(copy, status)}</span>
              </li>
            `).join("")}
          </ol>
          <div class="demo-development-canonical"><small>${copy.canonical}</small><a href="${url}">${url}</a></div>
        </div>
      `;

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
    }

    const main = document.querySelector("#storeApp main") || document.querySelector("main");
    if (!main) return;
    render();
    main.prepend(card);
    document.body.append(dialog);

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    new MutationObserver(render).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"]
    });

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
