(() => {
  "use strict";

  const RELEASE = "2026.08.07.11";
  const root = document.documentElement;
  if (root.dataset.adminPolishV2 === RELEASE) return;
  root.dataset.adminPolishV2 = RELEASE;

  function iconButton(className, label, path) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
    return button;
  }

  function installMobileDrawer() {
    const sidebar = document.querySelector(".dashboard-sidebar");
    const header = document.querySelector(".dashboard-header");
    const actions = header?.querySelector(".dashboard-actions");
    if (!sidebar || !header || !actions || document.querySelector(".admin-mobile-menu-trigger")) return;

    sidebar.id ||= "adminNavigation";
    const trigger = iconButton("admin-mobile-menu-trigger", "فتح قائمة الإدارة", "M4 7h16M4 12h16M4 17h16");
    trigger.setAttribute("aria-controls", sidebar.id);
    trigger.setAttribute("aria-expanded", "false");

    const close = iconButton("admin-mobile-menu-close", "إغلاق قائمة الإدارة", "M7 7l10 10M17 7 7 17");
    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "admin-mobile-backdrop";
    backdrop.tabIndex = -1;
    backdrop.setAttribute("aria-label", "إغلاق قائمة الإدارة");

    actions.prepend(trigger);
    sidebar.prepend(close);
    sidebar.insertAdjacentElement("afterend", backdrop);

    const mobile = window.matchMedia("(max-width: 820px)");

    const setOpen = (open, { restoreFocus = false } = {}) => {
      const shouldOpen = Boolean(open && mobile.matches);
      if (!shouldOpen && sidebar.contains(document.activeElement)) trigger.focus({ preventScroll: true });
      document.body.classList.toggle("admin-mobile-nav-open", shouldOpen);
      trigger.setAttribute("aria-expanded", String(shouldOpen));
      if (mobile.matches) {
        if (shouldOpen) {
          sidebar.removeAttribute("aria-hidden");
          sidebar.inert = false;
        } else {
          sidebar.setAttribute("aria-hidden", "true");
          sidebar.inert = true;
        }
      } else {
        sidebar.removeAttribute("aria-hidden");
        sidebar.inert = false;
      }
      if (!shouldOpen && restoreFocus) trigger.focus({ preventScroll: true });
    };

    trigger.addEventListener("click", () => {
      const open = !document.body.classList.contains("admin-mobile-nav-open");
      setOpen(open);
      if (open) close.focus({ preventScroll: true });
    });
    close.addEventListener("click", () => setOpen(false, { restoreFocus: true }));
    backdrop.addEventListener("click", () => setOpen(false, { restoreFocus: true }));
    sidebar.querySelector("nav")?.addEventListener("click", (event) => {
      if (event.target.closest(".nav-item")) setOpen(false);
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("admin-mobile-nav-open")) {
        event.preventDefault();
        setOpen(false, { restoreFocus: true });
      }
    });

    const syncViewport = () => setOpen(document.body.classList.contains("admin-mobile-nav-open"));
    if (typeof mobile.addEventListener === "function") mobile.addEventListener("change", syncViewport);
    else mobile.addListener(syncViewport);
    setOpen(false);
  }

  function improveAdminSemantics() {
    document.querySelectorAll(".stat-grid > article").forEach((card) => {
      const label = card.querySelector("span")?.textContent?.trim();
      const value = card.querySelector("strong")?.textContent?.trim();
      if (label) card.setAttribute("aria-label", value ? `${label}: ${value}` : label);
    });
  }

  function install() {
    installMobileDrawer();
    improveAdminSemantics();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
