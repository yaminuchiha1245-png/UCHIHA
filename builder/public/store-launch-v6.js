(function () {
  "use strict";

  var RELEASE = "2026.08.08.20";
  var WHATSAPP_URL = "https://wa.me/963942586044";
  var SOCIAL_ROOT = "/assets/social-icons/";
  var DEMO_ROOT = "/assets/demo-assets/";
  var isDemo = String(window.location.hostname || "").toLowerCase().startsWith("demo.") ||
    /^\/store\/demo(?:\/|$)/.test(String(window.location.pathname || ""));
  var pathParts = String(window.location.pathname || "").split("/").filter(Boolean);
  var storeSlug = isDemo ? "demo" : (pathParts[0] === "store" && pathParts[1] ? pathParts[1] : "demo");
  var supportUrl = "/store/" + encodeURIComponent(storeSlug) + "/support";
  var bannerImage = null;
  var bannerLink = null;
  var lastBannerSource = "";
  var bannerAnimationTimer = 0;
  var pointerStartX = null;
  var suppressBannerClick = false;
  var enhancementQueued = false;
  var preloadInstalled = false;

  var demoBannerMap = {
    "uchiha-slide-main.svg": "uchiha-banner-madara.webp",
    "uchiha-slide-account.svg": "uchiha-banner-obito.webp",
    "uchiha-slide-support.svg": "uchiha-banner-itachi.webp"
  };

  var demoCategoryMap = [
    { match: /الألعاب|الشحن/, asset: "uchiha-category-games-v2.svg" },
    { match: /الاشتراك|المشاهدة|عضويات/, asset: "uchiha-category-subscriptions-v2.svg" },
    { match: /الرقمية|بطاقات|أكواد/, asset: "uchiha-category-digital-v2.svg" },
    { match: /البرمجة|التصميم|أدوات العمل/, asset: "uchiha-category-services-v2.svg" }
  ];

  var currencyMeta = {
    USD: ["الدولار الأمريكي", "$"],
    EUR: ["اليورو", "€"],
    GBP: ["الجنيه الإسترليني", "£"],
    TRY: ["الليرة التركية", "₺"],
    SAR: ["الريال السعودي", "ر.س"],
    AED: ["الدرهم الإماراتي", "د.إ"],
    JOD: ["الدينار الأردني", "د.أ"],
    IQD: ["الدينار العراقي", "د.ع"],
    EGP: ["الجنيه المصري", "ج.م"],
    SYP: ["الليرة السورية", "ل.س"],
    QAR: ["الريال القطري", "ر.ق"],
    KWD: ["الدينار الكويتي", "د.ك"],
    BHD: ["الدينار البحريني", "د.ب"],
    YER: ["الريال اليمني", "ر.ي"]
  };

  var drawerIconPaths = {
    home: ["M3 11.5 12 4l9 7.5", "M5.5 10.5V20h13v-9.5", "M9.5 20v-6h5v6"],
    "add-funds": ["M4 7h16v12H4z", "M4 10h16", "M12 13v4M10 15h4"],
    payments: ["M5 4h14v16H5z", "M8 9h8M8 13h5", "M16.5 16.5h.01"],
    wallet: ["M3.5 6.5h17v13h-17z", "M3.5 9.5h17", "M16 13h4v3h-4z"],
    orders: ["M6 3.5h12v17H6z", "M9 8h6M9 12h6M9 16h4"],
    support: ["M5 13v-2a7 7 0 0 1 14 0v2", "M5 13H3v4h3v-4ZM19 13h2v4h-3v-4Z", "M18 18c-1 2-3 2-5 2"],
    telegram: ["m3 11 18-7-5 16-4-5-3 2 .5-5.5Z", "m9.5 14.5 7-6"],
    security: ["M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6Z", "m9 12 2 2 4-5"],
    identity: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4.5 21c.7-4.2 3-6.5 7.5-6.5s6.8 2.3 7.5 6.5", "m16 13 1.5 1.5 3-3"],
    developer: ["m8.5 8-4 4 4 4M15.5 8l4 4-4 4M14 5l-4 14"],
    about: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 10v6M12 7h.01"],
    notifications: ["M6 9a6 6 0 0 1 12 0v4l2 3H4l2-3Z", "M10 20h4"]
  };

  function createSvg(paths, className) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    if (className) svg.setAttribute("class", className);
    for (var index = 0; index < paths.length; index += 1) {
      var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", paths[index]);
      svg.appendChild(path);
    }
    return svg;
  }

  function createImage(src, alt) {
    var image = document.createElement("img");
    image.src = src;
    image.alt = alt || "";
    image.decoding = "async";
    return image;
  }

  function socialItems() {
    return [
      { key: "whatsapp", label: "واتساب", href: WHATSAPP_URL, external: true },
      { key: "telegram", label: "تيليجرام", href: supportUrl },
      { key: "instagram", label: "إنستغرام", href: supportUrl },
      { key: "facebook", label: "فيسبوك", href: supportUrl },
      { key: "youtube", label: "يوتيوب", href: supportUrl },
      { key: "tiktok", label: "تيك توك", href: supportUrl }
    ];
  }

  function applyLinkTarget(anchor, item) {
    anchor.href = item.href;
    anchor.setAttribute("aria-label", item.label);
    if (item.external) {
      anchor.target = "_blank";
      anchor.rel = "noopener";
    }
  }

  function moveSearchAfterBanner() {
    var intro = document.querySelector(".store-home-intro");
    var search = document.querySelector(".store-search-shell");
    if (intro && search && intro.nextElementSibling !== search) intro.after(search);
  }

  function enhanceHeader() {
    var tools = document.querySelector(".store-account-tools");
    var menu = document.querySelector("#storeMoreTrigger");
    var profile = document.querySelector("#storeProfileLink");
    var balance = document.querySelector("#storeBalanceLink");
    if (!tools || !menu || !profile || !balance) return;

    var login = document.querySelector("#storeGuestLogin");
    if (!login) {
      login = document.createElement("a");
      login.id = "storeGuestLogin";
      login.className = "launch-login-chip";
      login.textContent = "تسجيل دخول";
      login.setAttribute("aria-label", "تسجيل الدخول إلى حساب المتجر");
      menu.after(login);
    }
    var loginHref = profile.getAttribute("href") || ("/store/" + encodeURIComponent(storeSlug) + "/account");
    if (login.getAttribute("href") !== loginHref) login.href = loginHref;

    if (!balance.querySelector(".launch-balance-icon")) {
      balance.prepend(createSvg(["M4 7h16v13H4z", "M4 10h16", "M16 14h4v3h-4z", "M7 7V5h10v2"], "launch-balance-icon"));
    }

    var close = document.querySelector("#closeStoreMore");
    if (close && close.dataset.launchIcon !== "true") {
      close.replaceChildren(createSvg(["M6 6l12 12M18 6 6 18"]));
      close.dataset.launchIcon = "true";
    }
    syncGuestLogin();
  }

  function syncGuestLogin() {
    var login = document.querySelector("#storeGuestLogin");
    var profile = document.querySelector("#storeProfileLink");
    var logout = document.querySelector("#drawerLogout");
    if (!login || !profile || !logout) return;
    var hasSession = !logout.hidden;
    document.body.classList.toggle("launch-has-session", hasSession);
    login.hidden = hasSession;
    if (!hasSession) {
      var profileHref = profile.getAttribute("href") || login.getAttribute("href");
      if (profileHref && login.getAttribute("href") !== profileHref) login.href = profileHref;
    }
  }

  function mappedBannerSource(source) {
    if (!isDemo || !source) return source;
    var keys = Object.keys(demoBannerMap);
    for (var index = 0; index < keys.length; index += 1) {
      if (source.includes(keys[index])) return DEMO_ROOT + demoBannerMap[keys[index]];
    }
    return source;
  }

  function responsiveBannerCandidates(source) {
    if (!isDemo || !source) return null;
    var match = String(source).match(/uchiha-banner-(madara|obito|itachi)\.webp(?:\?.*)?$/);
    if (!match) return null;
    var name = match[1];
    return {
      fallback: DEMO_ROOT + "uchiha-banner-" + name + ".webp",
      srcset: [
        DEMO_ROOT + "uchiha-banner-" + name + "-1280.webp 1280w",
        DEMO_ROOT + "uchiha-banner-" + name + "-1920.webp 1920w",
        DEMO_ROOT + "uchiha-banner-" + name + ".webp 3840w"
      ].join(", ")
    };
  }

  function preloadDemoBanners() {
    if (!isDemo || preloadInstalled) return;
    preloadInstalled = true;
    ["madara", "obito", "itachi"].forEach(function (name) {
      var link = document.createElement("link");
      link.rel = "preload";
      link.setAttribute("as", "image");
      link.href = DEMO_ROOT + "uchiha-banner-" + name + "-1280.webp";
      link.setAttribute("imagesrcset", [
        DEMO_ROOT + "uchiha-banner-" + name + "-1280.webp 1280w",
        DEMO_ROOT + "uchiha-banner-" + name + "-1920.webp 1920w",
        DEMO_ROOT + "uchiha-banner-" + name + ".webp 3840w"
      ].join(", "));
      link.setAttribute("imagesizes", "(max-width: 680px) calc(100vw - 20px), min(1180px, calc(100vw - 24px))");
      document.head.appendChild(link);
    });
  }

  function animateBanner(source) {
    if (!bannerImage || !source || source === lastBannerSource) return;
    if (!lastBannerSource || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      lastBannerSource = source;
      return;
    }
    var old = createImage(lastBannerSource, "");
    old.className = "store-banner-ghost";
    bannerImage.before(old);
    bannerImage.classList.remove("store-banner-enter");
    void bannerImage.offsetWidth;
    bannerImage.classList.add("store-banner-enter");
    window.clearTimeout(bannerAnimationTimer);
    bannerAnimationTimer = window.setTimeout(function () {
      old.remove();
      bannerImage.classList.remove("store-banner-enter");
    }, 680);
    lastBannerSource = source;
  }

  function enhanceBanner() {
    bannerImage = document.querySelector("#storeBannerImage");
    bannerLink = document.querySelector("#storeMediaLink");
    if (!bannerImage || !bannerLink) return;
    var raw = bannerImage.getAttribute("src") || "";
    var mapped = mappedBannerSource(raw) || (isDemo ? DEMO_ROOT + "uchiha-banner-madara.webp" : raw);
    if (mapped && mapped !== raw) {
      bannerImage.src = mapped;
    }
    var responsive = responsiveBannerCandidates(mapped);
    if (responsive) {
      if (bannerImage.getAttribute("srcset") !== responsive.srcset) bannerImage.srcset = responsive.srcset;
      bannerImage.sizes = "(max-width: 680px) calc(100vw - 20px), min(1180px, calc(100vw - 24px))";
      bannerImage.decoding = "async";
      bannerImage.fetchPriority = "high";
    }
    if (mapped) {
      var label = mapped.includes("madara") ? "مادارا أوتشيها" : mapped.includes("obito") ? "أوبيتو أوتشيها" : "إيتاتشي أوتشيها";
      var bannerAlt = isDemo ? label : (bannerImage.alt || "");
      if (bannerImage.alt !== bannerAlt) bannerImage.alt = bannerAlt;
      animateBanner(bannerImage.currentSrc || bannerImage.src || mapped);
    }
    if (isDemo) {
      if (bannerLink.getAttribute("href") !== WHATSAPP_URL) bannerLink.href = WHATSAPP_URL;
      if (bannerLink.target !== "_blank") bannerLink.target = "_blank";
      if (bannerLink.rel !== "noopener") bannerLink.rel = "noopener";
      if (bannerLink.getAttribute("aria-label") !== "التواصل عبر واتساب") {
        bannerLink.setAttribute("aria-label", "التواصل عبر واتساب");
      }
    }
    if (bannerLink.dataset.launchSwipe !== "true") {
      bannerLink.dataset.launchSwipe = "true";
      bannerLink.addEventListener("pointerdown", function (event) {
        pointerStartX = event.clientX;
        suppressBannerClick = false;
      });
      bannerLink.addEventListener("pointerup", function (event) {
        if (pointerStartX === null) return;
        var distance = event.clientX - pointerStartX;
        pointerStartX = null;
        if (Math.abs(distance) < 45) return;
        suppressBannerClick = true;
        var target = document.querySelector(distance < 0 ? "#storeBannerNext" : "#storeBannerPrevious");
        if (target) target.click();
      });
      bannerLink.addEventListener("click", function (event) {
        if (!suppressBannerClick) return;
        event.preventDefault();
        suppressBannerClick = false;
      }, true);
    }
  }

  function enhanceDemoCategories() {
    if (!isDemo) return;
    var title = document.querySelector("#categorySectionTitle");
    if (title && title.textContent !== "الأقسام") title.textContent = "الأقسام";
    document.querySelectorAll("#storeCategories .store-category-card").forEach(function (card) {
      var name = String(card.querySelector("strong")?.textContent || "").trim();
      var image = card.querySelector("img");
      if (!image) return;
      for (var index = 0; index < demoCategoryMap.length; index += 1) {
        var entry = demoCategoryMap[index];
        if (entry.match.test(name)) {
          var expected = DEMO_ROOT + entry.asset;
          if (image.getAttribute("src") !== expected) image.src = expected;
          image.alt = "";
          break;
        }
      }
    });
  }

  function enhanceDrawerLinks() {
    document.querySelectorAll(".store-drawer nav a").forEach(function (anchor) {
      if (anchor.dataset.launchDrawerLink === "true") return;
      var route = anchor.dataset.accountRoute || (anchor.hasAttribute("data-store-home") ? "home" : "about");
      var paths = drawerIconPaths[route] || drawerIconPaths.about;
      var icon = document.createElement("span");
      icon.className = "launch-drawer-icon";
      icon.appendChild(createSvg(paths));
      var copy = document.createElement("span");
      copy.className = "launch-drawer-copy";
      while (anchor.firstChild) copy.appendChild(anchor.firstChild);
      anchor.append(icon, copy);
      anchor.dataset.launchDrawerLink = "true";
    });
  }

  function buildSocialRow(className) {
    var row = document.createElement("div");
    row.className = className;
    socialItems().forEach(function (item) {
      var anchor = document.createElement("a");
      applyLinkTarget(anchor, item);
      anchor.appendChild(createImage(SOCIAL_ROOT + item.key + ".svg", ""));
      row.appendChild(anchor);
    });
    return row;
  }

  function enhanceDrawerFooter() {
    var drawer = document.querySelector(".store-drawer");
    if (!drawer || drawer.querySelector(".launch-drawer-footer")) return;
    var footer = document.createElement("footer");
    footer.className = "launch-drawer-footer";
    var signature = document.createElement("div");
    signature.className = "launch-drawer-signature";
    var copy = document.createElement("span");
    var name = document.createElement("b");
    name.textContent = "UCHIHA";
    var detail = document.createElement("small");
    detail.textContent = "برمجة وتصميم المتاجر الرقمية";
    copy.append(name, detail);
    signature.append(createImage(DEMO_ROOT + "uchiha-transparent-mark.svg", ""), copy);
    footer.append(signature, buildSocialRow("launch-social-row"));
    drawer.appendChild(footer);
  }

  function moveDemoNotice() {
    if (!isDemo) return;
    document.querySelector(".reference-login-overlay")?.remove();
    var note = document.querySelector(".reference-demo-bar");
    var preferences = document.querySelector(".drawer-preferences");
    if (note && preferences && !note.classList.contains("launch-demo-note")) {
      note.classList.add("launch-demo-note");
      preferences.before(note);
    }
  }

  function removeDevelopmentPreview() {
    if (!isDemo) return;
    document.querySelector(".demo-development-card")?.remove();
    document.querySelector(".demo-development-dialog")?.remove();
  }

  function renderCurrencyDialog(force) {
    var selector = document.querySelector("#storeCurrencySelector");
    var dialog = document.querySelector("#storeCurrencyDialog");
    if (!selector || !dialog) return;
    var list = dialog.querySelector(".launch-currency-list");
    if (!list) return;
    var signature = selector.value + "|" + Array.from(selector.options).map(function (option) {
      return option.value + ":" + option.textContent;
    }).join("|");
    if (!force && dialog.dataset.currencySignature === signature) return;
    dialog.dataset.currencySignature = signature;
    list.replaceChildren();
    Array.from(selector.options).forEach(function (option) {
      var code = String(option.value || "").toUpperCase();
      if (!code) return;
      var meta = currencyMeta[code] || [code, code];
      var button = document.createElement("button");
      button.type = "button";
      button.className = "launch-currency-option";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(selector.value === code));
      var symbol = document.createElement("span");
      symbol.className = "launch-currency-symbol";
      symbol.textContent = meta[1];
      var copy = document.createElement("span");
      copy.className = "launch-currency-copy";
      var name = document.createElement("b");
      name.textContent = meta[0];
      var detail = document.createElement("small");
      detail.textContent = code + (option.textContent.includes("الأساسية") ? " — العملة الأساسية" : " — سعر عرض المتجر");
      var check = document.createElement("span");
      check.className = "launch-currency-check";
      if (selector.value === code) check.appendChild(createSvg(["m5 12 4 4L19 6"]));
      copy.append(name, detail);
      button.append(symbol, copy, check);
      button.addEventListener("click", function () {
        selector.value = code;
        selector.dispatchEvent(new Event("change", { bubbles: true }));
        dialog.close();
        renderCurrencyDialog(true);
      });
      list.appendChild(button);
    });
  }

  function enhanceCurrencyDialog() {
    var selector = document.querySelector("#storeCurrencySelector");
    var balance = document.querySelector("#storeBalanceLink");
    if (!selector || !balance) return;
    var dialog = document.querySelector("#storeCurrencyDialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "storeCurrencyDialog";
      dialog.className = "launch-currency-dialog";
      var shell = document.createElement("section");
      shell.className = "launch-currency-shell";
      var head = document.createElement("header");
      head.className = "launch-currency-head";
      var title = document.createElement("h2");
      title.textContent = "اختر عملة العرض";
      var close = document.createElement("button");
      close.type = "button";
      close.className = "launch-dialog-close";
      close.setAttribute("aria-label", "إغلاق قائمة العملات");
      close.appendChild(createSvg(["M6 6l12 12M18 6 6 18"]));
      close.addEventListener("click", function () { dialog.close(); });
      var list = document.createElement("div");
      list.className = "launch-currency-list";
      list.setAttribute("role", "radiogroup");
      head.append(title, close);
      shell.append(head, list);
      dialog.appendChild(shell);
      document.body.appendChild(dialog);
      dialog.addEventListener("click", function (event) {
        if (event.target === dialog) dialog.close();
      });
    }
    if (balance.dataset.launchCurrencyBound !== "true") {
      balance.dataset.launchCurrencyBound = "true";
      balance.addEventListener("click", function (event) {
        event.preventDefault();
        renderCurrencyDialog();
        if (typeof dialog.showModal === "function") dialog.showModal();
      });
    }
    if (selector.dataset.launchCurrencyBound !== "true") {
      selector.dataset.launchCurrencyBound = "true";
      selector.addEventListener("change", function () { renderCurrencyDialog(true); });
    }
    renderCurrencyDialog();
  }

  function enhanceFloatingControls() {
    var container = document.querySelector("#storeFloatingSupport");
    if (!container || container.dataset.launchFab === "true") return;
    var originalWhatsapp = document.querySelector("#storeFloatingWhatsapp")?.getAttribute("href") || WHATSAPP_URL;
    container.hidden = false;
    container.replaceChildren();
    var menu = document.createElement("div");
    menu.className = "launch-fab-menu";
    socialItems().forEach(function (item, index) {
      var anchor = document.createElement("a");
      anchor.className = "launch-fab-item";
      anchor.style.setProperty("--fab-index", String(index));
      if (item.key === "whatsapp") {
        anchor.id = "storeFloatingWhatsapp";
        applyLinkTarget(anchor, {
          key: item.key,
          label: item.label,
          href: originalWhatsapp === "#" ? WHATSAPP_URL : originalWhatsapp,
          external: true
        });
      } else {
        applyLinkTarget(anchor, item);
      }
      anchor.appendChild(createImage(SOCIAL_ROOT + item.key + ".svg", ""));
      menu.appendChild(anchor);
    });
    var support = document.createElement("a");
    support.className = "launch-fab-support";
    support.href = supportUrl;
    support.setAttribute("aria-label", "الدعم الفني");
    support.appendChild(createSvg(drawerIconPaths.support, "launch-fab-support-icon"));
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "launch-fab-toggle";
    toggle.setAttribute("aria-label", "إظهار وسائل التواصل");
    toggle.setAttribute("aria-expanded", "false");
    toggle.appendChild(createSvg(["M6 12h.01M12 12h.01M18 12h.01"]));
    toggle.addEventListener("click", function () {
      var open = container.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "إخفاء وسائل التواصل" : "إظهار وسائل التواصل");
      toggle.replaceChildren(createSvg(open
        ? ["M6 6l12 12M18 6 6 18"]
        : ["M6 12h.01M12 12h.01M18 12h.01"]));
    });
    container.append(menu, support, toggle);
    container.dataset.launchFab = "true";
  }

  function enhanceFooter() {
    var footer = document.querySelector(".store-footer");
    if (!footer || footer.dataset.launchFooter === "true") return;
    footer.replaceChildren();
    var brand = document.createElement("div");
    brand.className = "launch-footer-brand";
    var copy = document.createElement("span");
    var name = document.createElement("b");
    name.id = "footerStoreName";
    name.textContent = "UCHIHA";
    var detail = document.createElement("small");
    detail.textContent = "برمجة وتصميم المتاجر الرقمية";
    copy.append(name, detail);
    brand.append(createImage(DEMO_ROOT + "uchiha-transparent-mark.svg", ""), copy);
    var rights = document.createElement("small");
    rights.textContent = "جميع الحقوق محفوظة";
    footer.append(brand, rights);
    footer.dataset.launchFooter = "true";
  }

  function enhanceLoader() {
    if (!isDemo) return;
    var image = document.querySelector(".store-loader-orbit img");
    if (image && !image.src.includes("uchiha-transparent-mark.svg")) image.src = DEMO_ROOT + "uchiha-transparent-mark.svg";
  }

  function enhanceCloseButtons() {
    document.querySelectorAll("button.dialog-close, button#closeStoreCart, button#closeOrderDialog").forEach(function (button) {
      if (button.dataset.launchIcon === "true") return;
      if (button.querySelector("svg")) {
        button.dataset.launchIcon = "true";
        return;
      }
      button.replaceChildren(createSvg(["M6 6l12 12M18 6 6 18"]));
      button.dataset.launchIcon = "true";
    });
  }

  function closeDrawerFromBackdrop() {
    var dialog = document.querySelector("#storeMoreDialog");
    if (!dialog || dialog.dataset.launchBackdrop === "true") return;
    dialog.dataset.launchBackdrop = "true";
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });
  }

  function enhance() {
    enhancementQueued = false;
    if (!document.body || document.body.dataset.page !== "store") return;
    document.documentElement.dataset.storeLaunchRelease = RELEASE;
    moveSearchAfterBanner();
    enhanceHeader();
    enhanceCloseButtons();
    enhanceLoader();
    preloadDemoBanners();
    enhanceBanner();
    enhanceDemoCategories();
    enhanceDrawerLinks();
    enhanceDrawerFooter();
    moveDemoNotice();
    removeDevelopmentPreview();
    enhanceCurrencyDialog();
    enhanceFloatingControls();
    enhanceFooter();
    closeDrawerFromBackdrop();
  }

  function queueEnhancement() {
    if (enhancementQueued) return;
    enhancementQueued = true;
    window.requestAnimationFrame(enhance);
  }

  function start() {
    enhance();
    var observer = new MutationObserver(queueEnhancement);
    observer.observe(document.body, {
      subtree: true,
      childList: true
    });
    [
      [document.querySelector("#storeBannerImage"), ["src"]],
      [document.querySelector("#storeMediaLink"), ["href"]],
      [document.querySelector("#drawerLogout"), ["hidden"]],
      [document.querySelector("#storeProfileLink"), ["href"]]
    ].forEach(function (entry) {
      if (!entry[0]) return;
      var attributes = new MutationObserver(queueEnhancement);
      attributes.observe(entry[0], { attributes: true, attributeFilter: entry[1] });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
