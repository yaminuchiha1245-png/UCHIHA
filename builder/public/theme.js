(function () {
  "use strict";

  var RELEASE = "2026.08.07.4-reference";
  var ASSET_VERSION = "2026.08.07.4";
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
  }

  function pageKind() {
    var path = String(window.location.pathname || "");
    if (/^\/store\/[^/]+\/?$/.test(path)) return "store";
    if (/^\/admin\/[^/]+\/(?:payments|support|account-settings)\/?$/.test(path)) return "owner-subadmin";
    if (/^\/admin\/[^/]+\/?$/.test(path)) return "admin";
    var bodyPage = document.body && document.body.dataset ? document.body.dataset.page || "" : "";
    if (["payments-admin", "support-admin", "account-admin"].includes(bodyPage)) return "owner-subadmin";
    return bodyPage;
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

  function installReferenceAssets(kind) {
    if (kind === "store") {
      installStyle(versioned("/assets/store-reference.css"), "data-store-reference-style");
      installStyle(versioned("/assets/store-reference-runtime.css"), "data-store-reference-runtime-style");
      installStyle(versioned("/assets/store-reference-welcome.css"), "data-store-reference-welcome-style");
      installScript(versioned("/assets/store-reference.js"), "data-store-reference-script");
    }
    if (kind === "admin") {
      installStyle(versioned("/assets/admin-reference.css"), "data-admin-reference-style");
      installScript(versioned("/assets/admin-reference.js"), "data-admin-reference-script");
    }
    if (kind === "owner-subadmin") {
      installStyle(versioned("/assets/admin-subpages-reference.css"), "data-admin-subpages-reference-style");
    }
  }

  setTheme(preferredTheme(), false);
  installReferenceAssets(pageKind());

  function bind() {
    installReferenceAssets(pageKind());
    syncThemeButtons(root.getAttribute("data-theme") || preferredTheme());
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
    media.addEventListener("change", function (event) {
      if (!savedTheme()) setTheme(event.matches ? "dark" : "light", false);
    });
  }

  window.__uchihaStoreBoot = {
    release: RELEASE,
    phase: "reference-runtime",
    errors: []
  };
})();
