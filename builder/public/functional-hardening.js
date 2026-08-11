(() => {
  "use strict";

  const RELEASE_VERSION = "2026.08.11.1";
  const protectedFormIds = new Set(["registerForm", "loginForm", "storeForm", "orderForm"]);
  const writePathPattern = /^\/api\/(?:stores$|storefront\/[^/]+\/orders$)/;
  let activeSubmission = null;

  function installFunctionalStyles() {
    if (document.querySelector('style[data-functional-hardening="true"]')) return;
    const style = document.createElement("style");
    style.dataset.functionalHardening = "true";
    style.textContent = `
      .password-control{position:relative;display:grid;min-width:0}
      .password-control input{width:100%;min-width:0;padding-inline-end:5rem}
      .password-toggle{position:absolute;inset-inline-end:.45rem;top:50%;transform:translateY(-50%);min-width:3.9rem;min-height:36px;padding:.35rem .6rem;border:1px solid var(--border,#343844);border-radius:.65rem;background:var(--surface-soft,var(--surface,#17191f));color:var(--text,#fff);font:inherit;cursor:pointer;touch-action:manipulation}
      .password-toggle:focus-visible{outline:3px solid color-mix(in srgb,var(--primary,#dc3545) 35%,transparent);outline-offset:2px}
      input[type="email"],input[type="tel"],input[type="url"],.technical-ltr,a[href^="mailto:"],a[href^="tel:"]{direction:ltr;unicode-bidi:plaintext;text-align:left;overflow-wrap:anywhere;word-break:normal}
      .topbar>*,.topbar-actions,.hero>*,.hero-actions>*,.builder-shell>*,.form-grid>*,.field,.input-suffix,.input-suffix>*{min-width:0}
      button[aria-busy="true"]{cursor:progress;touch-action:none}
    `;
    document.head.append(style);
  }

  function submitControl(form) {
    if (form.id === "orderForm") return form.querySelector('button[value="submit"]');
    return form.querySelector('button[type="submit"],input[type="submit"]');
  }

  function setBusy(form, busy) {
    const control = submitControl(form);
    if (busy) {
      form.dataset.submitting = "true";
      control?.setAttribute("aria-busy", "true");
      if (control) control.disabled = true;
      return;
    }
    delete form.dataset.submitting;
    control?.removeAttribute("aria-busy");
    if (control) control.disabled = false;
  }

  function releaseSubmission(form, { clearKey = false } = {}) {
    if (!form) return;
    if (clearKey) delete form.dataset.requestKey;
    setBusy(form, false);
    if (activeSubmission?.form === form) activeSubmission = null;
  }

  function installSubmissionGuard() {
    if (window.__uchihaSubmissionGuardInstalled) return;
    window.__uchihaSubmissionGuardInstalled = true;

    document.addEventListener("submit", (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !protectedFormIds.has(form.id)) return;
      if (form.dataset.submitting === "true") {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (form.id === "orderForm" && event.submitter?.value === "cancel") return;
      form.dataset.requestKey ||= crypto.randomUUID();
      setBusy(form, true);
      activeSubmission = { form, fetchStarted: false };
      queueMicrotask(() => {
        if (activeSubmission?.form === form && !activeSubmission.fetchStarted) {
          releaseSubmission(form);
        }
      });
    }, true);

    if (typeof window.fetch !== "function") return;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const requestUrl = typeof input === "string" ? input : input?.url || "";
      let pathname = requestUrl;
      try {
        pathname = new URL(requestUrl, window.location.origin).pathname;
      } catch {
        pathname = String(requestUrl).split("?")[0];
      }
      const form = activeSubmission?.form || null;
      const protectedWrite = Boolean(form && writePathPattern.test(pathname));
      let requestInit = init;

      if (form) activeSubmission.fetchStarted = true;
      if (protectedWrite) {
        const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
        headers.set("idempotency-key", form.dataset.requestKey || crypto.randomUUID());
        form.dataset.requestKey = headers.get("idempotency-key");
        requestInit = { ...init, headers };
      }

      try {
        const response = await nativeFetch(input, requestInit);
        if (form) {
          if (response.ok) {
            delete form.dataset.requestKey;
            if (activeSubmission?.form === form) activeSubmission = null;
            if (["registerForm", "loginForm"].includes(form.id)) {
              window.setTimeout(() => {
                if (document.body.contains(form) && !form.hidden) setBusy(form, false);
              }, 5000);
            }
          } else {
            releaseSubmission(form, {
              clearKey: response.status >= 400 && response.status < 500
            });
          }
        }
        return response;
      } catch (error) {
        if (form) releaseSubmission(form);
        throw error;
      }
    };
  }

  function enhanceTechnicalInputs(root = document) {
    root.querySelectorAll('input[type="email"],input[type="tel"],input[type="url"]')
      .forEach((input) => {
        input.dir = "ltr";
        if (input.type === "email") {
          input.inputMode = "email";
          input.autocapitalize = "none";
          input.spellcheck = false;
        }
      });

    root.querySelectorAll('input[type="password"]:not([data-password-enhanced])')
      .forEach((input, index) => {
        input.dataset.passwordEnhanced = "true";
        input.dir = "ltr";
        if (!input.id) input.id = `uchihaPassword${index + 1}`;
        const wrapper = document.createElement("div");
        wrapper.className = "password-control";
        input.before(wrapper);
        wrapper.append(input);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "password-toggle";
        button.textContent = "إظهار";
        button.setAttribute("aria-controls", input.id);
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => {
          const reveal = input.type === "password";
          input.type = reveal ? "text" : "password";
          button.textContent = reveal ? "إخفاء" : "إظهار";
          button.setAttribute("aria-pressed", String(reveal));
          input.focus({ preventScroll: true });
        });
        wrapper.append(button);
      });
  }

  function selectRequestedAuthTab() {
    if (!document.body.matches('[data-page="builder"]')) return;
    if (!["/login", "/account"].includes(window.location.pathname)) return;
    const loginTab = document.querySelector('[data-auth-tab="login"]');
    const registerTab = document.querySelector('[data-auth-tab="register"]');
    const loginForm = document.querySelector("#loginForm");
    const registerForm = document.querySelector("#registerForm");
    if (!loginTab || !loginForm || !registerForm) return;
    registerTab?.classList.remove("active");
    registerTab?.setAttribute("aria-selected", "false");
    loginTab.classList.add("active");
    loginTab.setAttribute("aria-selected", "true");
    registerForm.hidden = true;
    loginForm.hidden = false;
    document.title = "تسجيل الدخول — UCHIHA Builder";
    requestAnimationFrame(() => document.querySelector("#authStep")?.scrollIntoView({ block: "start" }));
  }

  function install() {
    installFunctionalStyles();
    installSubmissionGuard();
    enhanceTechnicalInputs();
    selectRequestedAuthTab();
  }

  window.__uchihaFunctionalHardening = {
    release: RELEASE_VERSION,
    install,
    enhanceTechnicalInputs
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
