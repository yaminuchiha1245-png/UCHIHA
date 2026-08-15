(function () {
  "use strict";

  var RELEASE = "2026.08.15.1-production-shell";
  var ASSET_VERSION = "2026.08.15.1";
  var storageKey = "uchiha-ui-theme";
  var root = document.documentElement;
  var media = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

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
    } catch (_error) {
      return null;
    }
  }

  function preferredTheme() {
    var saved = savedTheme();
    if (saved === "light" || saved === "dark") return saved;
    return media && media.matches ? "dark" : "light";
  }

  function syncThemeButtons(theme) {
    document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
      var dark = theme === "dark";
      button.setAttribute("aria-pressed", String(dark));
      button.setAttribute("aria-label", dark ? "استخدام الوضع الفاتح" : "استخدام الوضع الداكن");
      button.setAttribute("data-current-theme", theme);
      var label = button.querySelector("[data-theme-label]");
      if (label) label.textContent = dark ? "فاتح" : "داكن";
    });
  }

  function announceTheme(theme) {
    if (typeof window.CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("uchiha:theme-change", { detail: { theme: theme } }));
      return;
    }
    window.dispatchEvent(new Event("uchiha:theme-change"));
  }

  function setTheme(theme, persist) {
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
    if (persist !== false) {
      try {
        window.localStorage.setItem(storageKey, theme);
      } catch (_error) {
        // The selected theme still applies to the current page.
      }
    }
    syncThemeButtons(theme);
    announceTheme(theme);
  }

  function pageKind() {
    var path = String(window.location.pathname || "");
    if (/^\/store\/[^/]+\/(?:account|wallet|payments|add-funds|orders|support|telegram|security|identity|developer|about)\/?$/.test(path)) return "account";
    if (/^\/store\/[^/]+\/?$/.test(path) || window.location.hostname.toLowerCase().startsWith("demo.")) return "store";
    if (/^\/admin\/[^/]+\/(?:payments|support|account-settings)\/?$/.test(path)) return "owner-subadmin";
    if (/^\/admin\/[^/]+\/?$/.test(path)) return "admin";
    var bodyPage = document.body && document.body.dataset ? document.body.dataset.page || "" : "";
    if (["payments-admin", "support-admin", "account-admin"].includes(bodyPage)) return "owner-subadmin";
    return bodyPage;
  }

  function initialTheme(kind) {
    var saved = savedTheme();
    if (saved === "light" || saved === "dark") return saved;
    if (["store", "account", "admin", "owner-subadmin"].includes(kind)) return "dark";
    return preferredTheme();
  }

  function shouldInstallMonochrome(kind) {
    return kind !== "store" && kind !== "account";
  }

  function versioned(path) {
    return path + "?v=" + ASSET_VERSION;
  }

  function installStyle(href, marker) {
    if (document.querySelector('link[' + marker + '="true"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute(marker, "true");
    (document.head || root).appendChild(link);
  }

  function installScript(src, marker) {
    if (document.querySelector('script[' + marker + '="true"]')) return;
    var script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.async = false;
    script.setAttribute(marker, "true");
    (document.head || root).appendChild(script);
  }

  function installProductionPlatformStyle(kind) {
    var path = String(window.location.pathname || "");
    var tenantAccount = /^\/store\/[^/]+\//.test(path);
    if (kind === "account" && !tenantAccount) {
      installStyle(versioned("/assets/platform-v41-production.css"), "data-platform-production-style");
    }
  }

  function installReferenceAssets(kind) {
    installProductionPlatformStyle(kind);
    if (kind === "store") {
      installScript(versioned("/assets/store-boot-guard.js"), "data-store-boot-guard-script");
      installStyle(versioned("/assets/store-reference.css"), "data-store-reference-style");
      installStyle(versioned("/assets/store-reference-runtime.css"), "data-store-reference-runtime-style");
      installStyle(versioned("/assets/store-reference-welcome.css"), "data-store-reference-welcome-style");
      installStyle(versioned("/assets/store-polish-v2.css"), "data-store-polish-v2-style");
      installStyle(versioned("/assets/store-polish-v2-runtime.css"), "data-store-polish-v2-runtime-style");
      installStyle(versioned("/assets/store-commerce-v3.css"), "data-store-commerce-v3-style");
      installStyle(versioned("/assets/store-checkout-v4.css"), "data-store-checkout-v4-style");
      installStyle(versioned("/assets/store-catalog-v5.css"), "data-store-catalog-v5-style");
      installScript(versioned("/assets/store-reference.js"), "data-store-reference-script");
      installScript(versioned("/assets/store-polish-v2.js"), "data-store-polish-v2-script");
    }
    if (kind === "account") {
      installStyle(versioned("/assets/account-polish-v2.css"), "data-account-polish-v2-style");
      installScript(versioned("/assets/account-polish-v2.js"), "data-account-polish-v2-script");
    }
    if (kind === "store" || kind === "account") {
      installStyle(versioned("/assets/customer-shell-v1.css"), "data-customer-shell-style");
      installScript(versioned("/assets/customer-shell-v1.js"), "data-customer-shell-script");
    }
    if (kind === "admin") {
      installStyle(versioned("/assets/admin-reference.css"), "data-admin-reference-style");
      installStyle(versioned("/assets/admin-polish-v2.css"), "data-admin-polish-v2-style");
      installStyle(versioned("/assets/admin-catalog-v3.css"), "data-admin-catalog-v3-style");
      installStyle(versioned("/assets/admin-catalog-v3-runtime.css"), "data-admin-catalog-v3-runtime-style");
      installScript(versioned("/assets/admin-reference.js"), "data-admin-reference-script");
      installScript(versioned("/assets/admin-polish-v2.js"), "data-admin-polish-v2-script");
      installScript(versioned("/assets/admin-catalog-v3.js"), "data-admin-catalog-v3-script");
    }
    if (kind === "owner-subadmin") {
      installStyle(versioned("/assets/admin-subpages-reference.css"), "data-admin-subpages-reference-style");
      installStyle(versioned("/assets/admin-subpages-polish-v2.css"), "data-admin-subpages-polish-v2-style");
      installScript(versioned("/assets/admin-subpages-polish-v2.js"), "data-admin-subpages-polish-v2-script");
    }
    if (shouldInstallMonochrome(kind)) {
      installStyle(versioned("/assets/monochrome-v1.css"), "data-monochrome-v1-style");
    }
    if (kind === "admin") {
      installStyle(versioned("/assets/admin-launch-v4.css"), "data-admin-launch-v4-style");
    }
    if (kind === "store") {
      installStyle(versioned("/assets/store-launch-v6.css"), "data-store-launch-v6-style");
      installStyle(versioned("/assets/store-category-color-final.css"), "data-store-category-color-final-style");
      installScript(versioned("/assets/store-launch-v6.js"), "data-store-launch-v6-script");
    }
  }

  var initialKind = pageKind();
  setTheme(initialTheme(initialKind), false);
  installReferenceAssets(initialKind);

  function bind() {
    installReferenceAssets(pageKind());
    syncThemeButtons(root.getAttribute("data-theme") || initialTheme(pageKind()));
    document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
      if (button.dataset.themeBound === "true") return;
      button.dataset.themeBound = "true";
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

  if (media && typeof media.addEventListener === "function") {
    media.addEventListener("change", function () {
      if (!savedTheme()) setTheme(initialTheme(pageKind()), false);
    });
  }

  window.__uchihaStoreBoot = window.__uchihaStoreBoot || {
    release: RELEASE,
    phase: "reference-runtime",
    errors: []
  };
  window.__uchihaStoreBoot.release = RELEASE;
})();
