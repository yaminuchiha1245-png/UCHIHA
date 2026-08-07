(() => {
  "use strict";

  const RELEASE = "2026.08.07.14";
  const root = document.documentElement;
  if (root.dataset.accountPolishV2 === RELEASE) return;
  root.dataset.accountPolishV2 = RELEASE;

  const icons = {
    security: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.5 7.5 7 10 4.5-2.5 7-5.4 7-10V6Z"/><path d="M9.5 12 11 13.5 14.5 10"/></svg>',
    telegram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 17-7-4 16-5-5-3 3v-5Z"/><path d="m8 13 8-6"/></svg>',
    identity: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M7 15c.7-1.6 1.7-2.4 3-2.4S12.3 13.4 13 15M15 8h2M15 12h2"/></svg>',
    support: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 14v-3a7 7 0 0 1 14 0v3"/><path d="M5 13H3v5h4v-4a1 1 0 0 0-1-1Zm13 0h2a1 1 0 0 1 1 1v4h-4v-4a1 1 0 0 1 1-1ZM17 18c-1 2-2.7 3-5 3"/></svg>',
    addFunds: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v14H3zM3 9h18"/><path d="M12 12v5M9.5 14.5h5"/></svg>',
    payments: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>'
  };

  function installUtilityIcons() {
    const mapping = {
      security: "security",
      telegram: "telegram",
      identity: "identity",
      support: "support"
    };
    document.querySelectorAll(".quick-card[data-go] .quick-icon").forEach((icon) => {
      const key = mapping[icon.closest(".quick-card")?.dataset.go];
      if (key && icons[key]) icon.innerHTML = icons[key];
    });

    const walletIcons = document.querySelectorAll(".wallet-actions button > span:first-child");
    if (walletIcons[0]) walletIcons[0].innerHTML = icons.addFunds;
    if (walletIcons[1]) walletIcons[1].innerHTML = icons.payments;

    const totp = document.querySelector(".auth-step-icon");
    if (totp) totp.innerHTML = icons.security;
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
    nav.querySelectorAll("[data-go]").forEach((item) => observer.observe(item, { attributes: true, attributeFilter: ["class"] }));
    sync();
  }

  function improveDialogCloseLabels() {
    document.querySelectorAll("[data-dialog-close]").forEach((button) => {
      if (!button.getAttribute("aria-label")) button.setAttribute("aria-label", "إغلاق النافذة");
    });
  }

  function install() {
    installUtilityIcons();
    syncActiveNavigation();
    improveDialogCloseLabels();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
