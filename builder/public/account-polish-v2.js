(() => {
  "use strict";

  const RELEASE = "2026.08.11.1-account";
  const root = document.documentElement;
  if (root.dataset.accountPolishV2 === RELEASE) return;
  root.dataset.accountPolishV2 = RELEASE;

  const iconPaths = {
    home: ["m3 11 9-8 9 8v9H3Z", "M9 20v-6h6v6"],
    addFunds: ["M3 6h18v14H3z", "M3 9h18", "M12 12v5M9.5 14.5h5"],
    payments: ["M6 3h12v18H6z", "M9 8h6M9 12h6M9 16h4"],
    wallet: ["M3 6h18v14H3z", "M3 9h18M16 14h3"],
    orders: ["M6 3h12v18H6z", "M9 8h6M9 12h6M9 16h4"],
    support: ["M5 14v-3a7 7 0 0 1 14 0v3", "M5 13H3v5h4v-4a1 1 0 0 0-1-1Zm13 0h2a1 1 0 0 1 1 1v4h-4v-4a1 1 0 0 1 1-1ZM17 18c-1 2-2.7 3-5 3"],
    telegram: ["m3 11 17-7-4 16-5-5-3 3v-5Z", "m8 13 8-6"],
    security: ["M12 3 5 6v5c0 4.6 2.5 7.5 7 10 4.5-2.5 7-5.4 7-10V6Z", "M9.5 12 11 13.5 14.5 10"],
    identity: ["M4 3h16v18H4z", "M8 8h4M8 12h8M8 16h6"],
    developer: ["m8 5-5 7 5 7M16 5l5 7-5 7M14 3l-4 18"],
    about: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 11v6M12 7h.01"],
    notifications: ["M6 9a6 6 0 0 1 12 0v4l2 3H4l2-3Z", "M10 20h4"]
  };

  const routeColors = {
    home: "#ffffff",
    addFunds: "#4ade80",
    payments: "#fbbf24",
    wallet: "#38bdf8",
    orders: "#f59e0b",
    support: "#fb7185",
    telegram: "#38bdf8",
    security: "#4ade80",
    identity: "#c4b5fd",
    developer: "#22d3ee",
    about: "#f9a8d4"
  };

  function svg(paths, className = "") {
    const namespace = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(namespace, "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    if (className) icon.setAttribute("class", className);
    paths.forEach((value) => {
      const path = document.createElementNS(namespace, "path");
      path.setAttribute("d", value);
      icon.append(path);
    });
    return icon;
  }

  function installUtilityIcons() {
    const mapping = {
      security: "security",
      telegram: "telegram",
      identity: "identity",
      support: "support"
    };
    document.querySelectorAll(".quick-card[data-go] .quick-icon").forEach((container) => {
      const key = mapping[container.closest(".quick-card")?.dataset.go];
      if (!key || !iconPaths[key]) return;
      container.replaceChildren(svg(iconPaths[key]));
    });

    const walletIcons = document.querySelectorAll(".wallet-actions button > span:first-child");
    if (walletIcons[0]) walletIcons[0].replaceChildren(svg(iconPaths.addFunds));
    if (walletIcons[1]) walletIcons[1].replaceChildren(svg(iconPaths.payments));

    const totp = document.querySelector(".auth-step-icon");
    if (totp) totp.replaceChildren(svg(iconPaths.security));
  }

  function routeKey(item) {
    if (item.id === "drawerHome") return "home";
    return item.dataset.go || "about";
  }

  function enhanceDrawer() {
    const drawer = document.querySelector("#accountDrawer");
    if (!drawer) return;
    drawer.querySelectorAll("nav > a, nav > button").forEach((item, index) => {
      const key = routeKey(item);
      item.style.setProperty("--item-accent", routeColors[key] || "#ffffff");
      item.style.setProperty("--drawer-index", String(index));
      if (!item.querySelector(".account-drawer-icon")) {
        const holder = document.createElement("span");
        holder.className = "account-drawer-icon";
        holder.append(svg(iconPaths[key] || iconPaths.about));
        item.prepend(holder);
      }
      const chevron = item.querySelector(":scope > b");
      if (chevron) chevron.replaceChildren(svg(["m9 5 7 7-7 7"]));
    });
  }

  function syncActiveNavigation() {
    const nav = document.querySelector(".account-bottom-nav");
    if (!nav) return;
    const sync = () => {
      nav.querySelectorAll("[data-go]").forEach((item) => {
        if (item.classList.contains("active")) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      });
    };
    const observer = new MutationObserver(sync);
    nav.querySelectorAll("[data-go]").forEach((item) => {
      observer.observe(item, { attributes: true, attributeFilter: ["class"] });
    });
    sync();
  }

  function improveDialogCloseLabels() {
    document.querySelectorAll("[data-dialog-close]").forEach((button) => {
      if (!button.getAttribute("aria-label")) button.setAttribute("aria-label", "إغلاق النافذة");
    });
  }

  function syncLanguageControl() {
    const button = document.querySelector(".account-language-row");
    if (!button) return;
    const code = button.querySelector("[data-language-code]");
    if (code) code.textContent = root.lang === "en" ? "عربي" : "EN";
  }

  function install() {
    installUtilityIcons();
    enhanceDrawer();
    syncActiveNavigation();
    improveDialogCloseLabels();
    syncLanguageControl();
    document.querySelector(".global-language-toggle")?.remove();
    window.addEventListener("uchiha:language-change", syncLanguageControl);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
