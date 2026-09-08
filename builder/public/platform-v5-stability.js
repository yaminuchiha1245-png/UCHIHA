(() => {
  "use strict";

  const drawerRoot = document.getElementById("appDrawerRoot");
  const pageMount = document.getElementById("platformPage");
  if (!drawerRoot && !pageMount) return;

  const NativeMutationObserver = window.MutationObserver;
  let scheduled = false;

  function stabilizeDrawerClose(scope = document) {
    scope.querySelectorAll?.("[data-drawer-close]").forEach((button) => {
      if (button.querySelector("[data-stable-close-label]")) return;
      const label = document.createElement("span");
      label.dataset.stableCloseLabel = "";
      label.hidden = true;
      label.textContent = "إغلاق";
      button.append(label);
    });
  }

  function stabilizeCategoryCards(scope = document) {
    scope.querySelectorAll?.(".v5-category-card .v5-card-media.empty").forEach((media) => {
      if (media.dataset.stableCategoryMedia === "true") return;
      media.dataset.stableCategoryMedia = "true";
      media.setAttribute("aria-hidden", "true");
    });
  }

  function stabilize() {
    scheduled = false;
    stabilizeDrawerClose(drawerRoot || document);
    stabilizeCategoryCards(pageMount || document);
  }

  function scheduleStabilize() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(stabilize);
  }

  // The polish layer installs its own observer after this file. Run the guard
  // synchronously before any later observer callback so a freshly re-rendered
  // close button can never trigger the polish layer's self-rewriting loop.
  window.MutationObserver = class StableMutationObserver extends NativeMutationObserver {
    constructor(callback) {
      super((mutations, observer) => {
        stabilize();
        callback(mutations, observer);
      });
    }
  };

  const observer = new NativeMutationObserver((mutations) => {
    if (!mutations.some((mutation) => mutation.addedNodes.length || mutation.removedNodes.length)) return;
    scheduleStabilize();
  });

  if (drawerRoot) observer.observe(drawerRoot, { childList: true, subtree: true });
  if (pageMount) observer.observe(pageMount, { childList: true, subtree: true });
  stabilize();
})();
