(function () {
  "use strict";

  var RELEASE = "2026.08.05.6-store-boot";
  var storageKey = "uchiha-ui-theme";
  var root = document.documentElement;
  var media = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

  function memoryStorage() {
    var values = Object.create(null);
    var keys = [];
    return {
      get length() { return keys.length; },
      clear: function () { values = Object.create(null); keys = []; },
      getItem: function (key) {
        key = String(key);
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
      },
      key: function (index) { return keys[Number(index)] || null; },
      removeItem: function (key) {
        key = String(key);
        if (!Object.prototype.hasOwnProperty.call(values, key)) return;
        delete values[key];
        keys = keys.filter(function (item) { return item !== key; });
      },
      setItem: function (key, value) {
        key = String(key);
        if (!Object.prototype.hasOwnProperty.call(values, key)) keys.push(key);
        values[key] = String(value);
      }
    };
  }

  function ensureStorage(name) {
    try {
      var storage = window[name];
      var probe = "__uchiha_boot_probe__";
      storage.setItem(probe, "1");
      storage.removeItem(probe);
      return storage;
    } catch (error) {
      var fallback = memoryStorage();
      try {
        Object.defineProperty(window, name, {
          configurable: true,
          value: fallback
        });
      } catch (ignored) {
        // A visible boot diagnostic remains available when the browser forbids replacement.
      }
      return fallback;
    }
  }

  ensureStorage("sessionStorage");
  ensureStorage("localStorage");

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
  if (typeof window.queueMicrotask !== "function") {
    window.queueMicrotask = function (callback) {
      Promise.resolve().then(callback);
    };
  }

  var boot = window.__uchihaStoreBoot || {
    release: RELEASE,
    phase: "theme",
    errors: []
  };
  boot.release = RELEASE;
  window.__uchihaStoreBoot = boot;

  function errorText(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (value.message) return String(value.message);
    if (value.reason) return errorText(value.reason);
    try { return String(value); } catch (ignored) { return ""; }
  }

  function remember(message) {
    message = String(message || "تعذر تشغيل واجهة المتجر").slice(0, 500);
    boot.errors.push(message);
    if (boot.errors.length > 5) boot.errors.shift();
    return message;
  }

  function addRecoveryActions(target) {
    if (!target || target.querySelector("[data-store-boot-actions]")) return;
    var actions = document.createElement("span");
    actions.setAttribute("data-store-boot-actions", "true");
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.justifyContent = "center";
    actions.style.gap = "10px";
    actions.style.marginTop = "14px";

    var retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "إعادة المحاولة";
    retry.style.minHeight = "44px";
    retry.style.padding = "9px 16px";
    retry.style.border = "0";
    retry.style.borderRadius = "12px";
    retry.style.background = "#8f3044";
    retry.style.color = "#fff";
    retry.style.font = "inherit";
    retry.style.fontWeight = "800";
    retry.onclick = function () {
      var separator = location.search ? "&" : "?";
      location.replace(location.href + separator + "boot-refresh=" + Date.now());
    };

    actions.appendChild(retry);
    target.appendChild(actions);
  }

  function revealBootFailure(message) {
    if (!document.body || document.body.getAttribute("data-page") !== "store") return;
    var app = document.getElementById("storeApp");
    if (app && !app.hidden && window.getComputedStyle(app).display !== "none") return;

    var loading = document.getElementById("storeLoading");
    var errorNode = document.getElementById("storeLoadingError");
    if (!loading || !errorNode) return;

    var orbit = loading.querySelector(".store-loader-orbit");
    if (orbit) orbit.hidden = true;
    errorNode.hidden = false;
    errorNode.style.display = "grid";
    errorNode.style.gap = "8px";
    errorNode.style.maxWidth = "min(92vw, 620px)";
    errorNode.style.padding = "24px";
    errorNode.style.textAlign = "center";
    errorNode.style.lineHeight = "1.8";
    errorNode.textContent = String(message || "تعذر بدء واجهة المتجر");

    var code = document.createElement("small");
    code.dir = "ltr";
    code.textContent = "BOOT " + RELEASE;
    code.style.opacity = ".72";
    errorNode.appendChild(code);
    addRecoveryActions(errorNode);
  }

  window.addEventListener("error", function (event) {
    var message = errorText(event && event.error) || errorText(event && event.message);
    if (!message && event && event.target && event.target.tagName === "SCRIPT") {
      message = "تعذر تحميل ملف JavaScript: " + (event.target.src || "unknown");
    }
    if (!message) return;
    remember(message);
    window.setTimeout(function () { revealBootFailure(message); }, 0);
  }, true);

  window.addEventListener("unhandledrejection", function (event) {
    var message = remember(errorText(event && event.reason) || "فشل غير معالج أثناء تشغيل المتجر");
    window.setTimeout(function () { revealBootFailure(message); }, 0);
  });

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

  function syncButtons(theme) {
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

  function dispatchTheme(theme) {
    try {
      window.dispatchEvent(new CustomEvent("uchiha:theme-change", { detail: { theme: theme } }));
    } catch (error) {
      var event = document.createEvent("CustomEvent");
      event.initCustomEvent("uchiha:theme-change", false, false, { theme: theme });
      window.dispatchEvent(event);
    }
  }

  function setTheme(theme, persist) {
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
    if (persist !== false) {
      try { window.localStorage.setItem(storageKey, theme); } catch (error) { /* page theme still applies */ }
    }
    syncButtons(theme);
    dispatchTheme(theme);
  }

  setTheme(preferredTheme(), false);

  function bind() {
    boot.phase = "dom-ready";
    syncButtons(root.getAttribute("data-theme"));
    var buttons = document.querySelectorAll("[data-theme-toggle]");
    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener("click", function () {
        setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark", true);
      });
    });

    if (document.body && document.body.getAttribute("data-page") === "store") {
      window.setTimeout(function () {
        var app = document.getElementById("storeApp");
        var appHidden = !app || app.hidden || window.getComputedStyle(app).display === "none";
        if (!appHidden) {
          boot.phase = "ready";
          return;
        }
        var message = boot.errors.length
          ? boot.errors[0]
          : "تعذر بدء واجهة المتجر خلال المهلة المحددة";
        revealBootFailure(message);
      }, 18000);
    }
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
})();
