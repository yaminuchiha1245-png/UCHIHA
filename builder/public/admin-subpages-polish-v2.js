(() => {
  "use strict";

  const RELEASE = "2026.08.07.13";
  const root = document.documentElement;
  if (root.dataset.adminSubpagesPolishV2 === RELEASE) return;
  root.dataset.adminSubpagesPolishV2 = RELEASE;

  function prefersReducedMotion() {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function installSupportMobileFlow() {
    if (document.body?.dataset.page !== "support-admin") return;
    const sidebar = document.querySelector(".support-sidebar");
    const conversation = document.querySelector(".support-conversation");
    const active = document.querySelector("#supportActiveConversation");
    const header = active?.querySelector(":scope > header");
    if (!sidebar || !conversation || !active || !header || header.querySelector(".support-mobile-back")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-secondary button-compact support-mobile-back";
    button.textContent = "المحادثات";
    button.setAttribute("aria-label", "العودة إلى قائمة محادثات الدعم");
    header.prepend(button);

    const mobile = window.matchMedia("(max-width: 820px)");
    const scrollTo = (target) => {
      target.scrollIntoView({
        block: "start",
        inline: "nearest",
        behavior: prefersReducedMotion() ? "auto" : "smooth"
      });
    };

    button.addEventListener("click", () => scrollTo(sidebar));

    let wasHidden = active.hidden;
    const observer = new MutationObserver(() => {
      const isHidden = active.hidden;
      if (wasHidden && !isHidden && mobile.matches) {
        window.requestAnimationFrame(() => scrollTo(conversation));
      }
      wasHidden = isHidden;
    });
    observer.observe(active, { attributes: true, attributeFilter: ["hidden"] });
  }

  function improveIdentityDialog() {
    if (document.body?.dataset.page !== "account-admin") return;
    const dialog = document.querySelector("#identityAdminDialog");
    const close = document.querySelector("#closeIdentityAdminDialog");
    if (!dialog || !close) return;

    dialog.addEventListener("close", () => {
      const trigger = document.querySelector('[data-identity-dialog-trigger="true"]');
      trigger?.focus({ preventScroll: true });
      trigger?.removeAttribute("data-identity-dialog-trigger");
    });

    document.addEventListener("click", (event) => {
      const candidate = event.target.closest("button,a");
      if (!candidate || dialog.open || candidate === close) return;
      window.requestAnimationFrame(() => {
        if (!dialog.open) return;
        candidate.setAttribute("data-identity-dialog-trigger", "true");
      });
    }, true);
  }

  function install() {
    installSupportMobileFlow();
    improveIdentityDialog();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
