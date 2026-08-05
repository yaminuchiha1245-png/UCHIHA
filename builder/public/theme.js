(function () {
  "use strict";

  var RELEASE = "2026.08.05.8-demo-isolated";
  var isDemoHost = String(window.location.hostname || "").toLowerCase().indexOf("demo.") === 0;
  var isDemoPath = /^\/store\/demo\/?$/.test(window.location.pathname || "");
  if (isDemoHost || isDemoPath) {
    window.location.replace("/assets/demo-store.html?source=demo-store&release=20260805-8");
    return;
  }

  var storageKey = "uchiha-ui-theme";
  var root = document.documentElement;
  var media = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

  var staticFirstStyle = document.createElement("style");
  staticFirstStyle.id = "uchiha-store-static-first";
  staticFirstStyle.setAttribute("data-release", RELEASE);
  staticFirstStyle.textContent = [
    "html body[data-page='store'] #storeLoading{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}",
    "html body[data-page='store'] #storeApp[hidden]{display:block!important;visibility:visible!important;opacity:1!important}",
    "html body[data-page='store'] #storeApp{min-height:100dvh}",
    ".store-static-status{margin:12px auto 0;width:min(1180px,calc(100% - 24px));padding:10px 14px;border:1px solid rgba(215,71,104,.38);border-radius:14px;background:rgba(215,71,104,.09);color:inherit;text-align:center;font:700 13px/1.7 system-ui}",
    ".store-static-category{cursor:default}",
    ".store-static-category img{display:block;width:100%;height:100%;object-fit:contain}"
  ].join("");
  (document.head || root).appendChild(staticFirstStyle);

  if (typeof Array.prototype.at !== "function") {
    Object.defineProperty(Array.prototype, "at", {
      configurable: true,
      writable: true,
      value: function (index) {
        var length = this == null ? 0 : Number(this.length) || 0;
        var relative = Number(index) || 0;
        var position = relative < 0 ? length + relative : relative;
        return position < 0 || position >= length ? undefined : this[position];
      }
    });
  }

  function savedTheme() {
    try {
      return window.localStorage.getItem(storageKey);
    } catch (error) {
      return null;
    }
  }

  function preferredTheme() {
    var saved = savedTheme();
    if (saved === "light" || saved === "dark") return saved;
    return media && media.matches ? "dark" : "light";
  }

  function syncThemeButtons(theme) {
    var buttons = document.querySelectorAll("[data-theme-toggle]");
    Array.prototype.forEach.call(buttons, function (button) {
      var dark = theme === "dark";
      button.setAttribute("aria-pressed", String(dark));
      button.setAttribute("aria-label", dark ? "استخدام الوضع الفاتح" : "استخدام الوضع الداكن");
      button.setAttribute("data-current-theme", theme);
      var label = button.querySelector("[data-theme-label]");
      if (label) label.textContent = dark ? "فاتح" : "داكن";
    });
  }

  function setTheme(theme, persist) {
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
    if (persist !== false) {
      try {
        window.localStorage.setItem(storageKey, theme);
      } catch (error) {
        /* Theme still applies for the current page. */
      }
    }
    syncThemeButtons(theme);
  }

  setTheme(preferredTheme(), false);

  function setText(id, value, replacePlaceholder) {
    var node = document.getElementById(id);
    if (!node) return;
    var current = String(node.textContent || "").trim();
    if (!current || (replacePlaceholder && (current === "المتجر" || current === "م"))) {
      node.textContent = value;
    }
  }

  function createFallbackCategory(name, subtitle, imageUrl) {
    var card = document.createElement("article");
    card.className = "store-category-card store-static-category";
    card.setAttribute("data-static-category", "true");

    var visual = document.createElement("div");
    visual.className = "store-category-visual";
    var image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "";
    visual.appendChild(image);

    var body = document.createElement("div");
    body.className = "store-category-body";
    var title = document.createElement("strong");
    title.textContent = name;
    var small = document.createElement("small");
    small.textContent = subtitle;
    body.appendChild(title);
    body.appendChild(small);

    card.appendChild(visual);
    card.appendChild(body);
    return card;
  }

  function revealStaticStore() {
    if (!document.body || document.body.getAttribute("data-page") !== "store") return;

    var loading = document.getElementById("storeLoading");
    if (loading) {
      loading.hidden = true;
      loading.style.display = "none";
      loading.setAttribute("aria-hidden", "true");
    }

    var app = document.getElementById("storeApp");
    if (app) {
      app.hidden = false;
      app.removeAttribute("hidden");
      app.style.display = "block";
      app.setAttribute("data-static-first-release", RELEASE);
    }

    setText("storeName", "Nova Digital", true);
    setText("drawerStoreName", "Nova Digital", true);
    setText("footerStoreName", "Nova Digital", true);
    setText("storeTextLogo", "N", true);
    setText("drawerLogo", "N", true);
    setText("storeHeroTitle", "كل خدماتك الرقمية في مكان واحد", false);
    setText("storeDescription", "متجر تجريبي يعرض الأقسام والمنتجات الرقمية بتجربة سريعة وواضحة على الهاتف.", false);

    var header = app ? app.querySelector(".store-header") : null;
    if (header && !document.querySelector("[data-store-static-status]")) {
      var status = document.createElement("div");
      status.className = "store-static-status";
      status.setAttribute("data-store-static-status", "true");
      status.textContent = "نسخة تجريبية قيد التطوير — التصفح متاح والطلبات الحقيقية معطّلة";
      if (header.nextSibling) header.parentNode.insertBefore(status, header.nextSibling);
      else header.parentNode.appendChild(status);
    }

    var categories = document.getElementById("storeCategories");
    if (categories && categories.children.length === 0) {
      var items = [
        ["الألعاب", "شحن وأكواد الألعاب", "/assets/catalog-assets/game-topup.svg"],
        ["البطاقات الرقمية", "بطاقات ومتاجر عالمية", "/assets/catalog-assets/digital-card.svg"],
        ["الرصيد والاتصالات", "تعبئة وخدمات اتصال", "/assets/catalog-assets/mobile-credit.svg"],
        ["المشاهدة والاشتراكات", "اشتراكات ومنصات رقمية", "/assets/catalog-assets/subscription.svg"],
        ["البرامج والذكاء الاصطناعي", "أدوات وبرامج احترافية", "/assets/catalog-assets/software.svg"],
        ["الخدمات الرقمية", "حسابات وخدمات متنوعة", "/assets/catalog-assets/social-service.svg"]
      ];
      for (var index = 0; index < items.length; index += 1) {
        categories.appendChild(createFallbackCategory(items[index][0], items[index][1], items[index][2]));
      }
    }
  }

  function bind() {
    revealStaticStore();
    syncThemeButtons(root.getAttribute("data-theme") || preferredTheme());
    var buttons = document.querySelectorAll("[data-theme-toggle]");
    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener("click", function () {
        setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark", true);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind, { once: true });
  } else {
    bind();
  }

  window.addEventListener("pageshow", revealStaticStore);

  if (media && typeof media.addEventListener === "function") {
    media.addEventListener("change", function (event) {
      if (!savedTheme()) setTheme(event.matches ? "dark" : "light", false);
    });
  }

  window.__uchihaStoreBoot = {
    release: RELEASE,
    phase: "static-first",
    errors: []
  };
})();
