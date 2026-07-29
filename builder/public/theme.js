(() => {
  const storageKey = "uchiha-ui-theme";
  const root = document.documentElement;
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");

  function savedTheme() {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }

  function preferredTheme() {
    const saved = savedTheme();
    if (saved === "light" || saved === "dark") return saved;
    return media?.matches ? "dark" : "light";
  }

  function syncButtons(theme) {
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const dark = theme === "dark";
      button.setAttribute("aria-pressed", String(dark));
      button.setAttribute("aria-label", dark ? "استخدام الوضع الفاتح" : "استخدام الوضع الداكن");
      button.dataset.currentTheme = theme;
      const label = button.querySelector("[data-theme-label]");
      if (label) label.textContent = dark ? "فاتح" : "داكن";
    });
  }

  function setTheme(theme, persist = true) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    if (persist) {
      try {
        localStorage.setItem(storageKey, theme);
      } catch {
        // The selected theme still applies for this page when storage is unavailable.
      }
    }
    syncButtons(theme);
    window.dispatchEvent(new CustomEvent("uchiha:theme-change", { detail: { theme } }));
  }

  setTheme(preferredTheme(), false);

  function bind() {
    syncButtons(root.dataset.theme);
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        setTheme(root.dataset.theme === "dark" ? "light" : "dark");
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();

  media?.addEventListener?.("change", (event) => {
    if (!savedTheme()) setTheme(event.matches ? "dark" : "light", false);
  });
})();
