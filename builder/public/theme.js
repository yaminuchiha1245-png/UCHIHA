(function () {
  "use strict";

  var RELEASE = "2026.08.07.2-reference";
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
    if (/^\/admin\/[^/]+\/?$/.test(path)) return "admin";
    return document.body && document.body.dataset ? document.body.dataset.page || "" : "";
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
      installStyle("/assets/store-reference.css?v=20260807-2", "data-store-reference-style");
      installStyle("/assets/store-reference-runtime.css?v=20260807-2", "data-store-reference-runtime-style");
      installScript("/assets/store-reference.js?v=20260807-2", "data-store-reference-script");
    }
    if (kind === "admin") {
      installStyle("/assets/admin-reference.css?v=20260807-2", "data-admin-reference-style");
      installScript("/assets/admin-reference.js?v=20260807-2", "data-admin-reference-script");
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
