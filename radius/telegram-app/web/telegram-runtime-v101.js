(() => {
  "use strict";
  window.__UCHIHA_PROVIDER_RUNTIME__ = true;
  const tg = window.Telegram && window.Telegram.WebApp;
  const originalFetch = window.fetch.bind(window);
  let authReadyResolve, authReadyReject;
  const authReady = new Promise((resolve, reject) => { authReadyResolve = resolve; authReadyReject = reject; });
  window.__UCHIHA_TELEGRAM_AUTH_READY__ = authReady;

  const pathOf = (input) => {
    try { return new URL(typeof input === "string" ? input : input.url, location.href).pathname; }
    catch { return ""; }
  };
  const requiresProviderAuth = (path) => path.startsWith("/api/catalog") || path.startsWith("/api/workflows") || path.startsWith("/api/operations") || path.startsWith("/api/radius-provider/");

  window.fetch = async (input, init = {}) => {
    const path = pathOf(input);
    if (requiresProviderAuth(path) && path !== "/api/radius-provider/auth/telegram" && path !== "/api/radius-provider/logout") {
      await authReady;
    }
    return originalFetch(input, { credentials: "same-origin", ...init });
  };

  function injectTelegramRuntimeCss() {
    const style = document.createElement("style");
    style.textContent = \`
      #uchiha-operator-login-v99,#uchiha-operator-chip-v99{display:none!important}
      html.uchiha-telegram-runtime body{padding-bottom:max(env(safe-area-inset-bottom),0px)}
    \`;
    document.head.appendChild(style);
    document.documentElement.classList.add("uchiha-telegram-runtime");
  }

  async function authenticate() {
    injectTelegramRuntimeCss();
    if (!tg || !tg.initData) throw new Error("telegram_webapp_required");
    try { tg.ready(); tg.expand(); } catch {}
    const response = await originalFetch("/api/radius-provider/auth/telegram", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ initData: tg.initData })
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok || body.ok !== true) throw new Error(body?.error?.code || \`telegram_auth_http_\${response.status}\`);
    window.__UCHIHA_PROVIDER_CONTEXT__ = body;
    authReadyResolve(body);
    try {
      const cat = await originalFetch("/api/catalog", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      if (cat.ok) {
        const catalog = await cat.json();
        localStorage.setItem("uchiha-radius-local-catalog", JSON.stringify(catalog));
        localStorage.setItem("uchiha-radius-provider-cache", "server-authoritative");
        window.dispatchEvent(new CustomEvent("uchiha-radius-provider-catalog-ready", { detail: { provider: body.provider } }));
      }
    } catch {}
    return body;
  }

  authenticate().catch((error) => {
    authReadyReject(error);
    window.__UCHIHA_PROVIDER_AUTH_ERROR__ = String(error && error.message || error);
    document.addEventListener("DOMContentLoaded", () => {
      const box = document.createElement("div");
      box.setAttribute("role", "alert");
      box.dir = "rtl";
      box.style.cssText = "position:fixed;z-index:2147483647;inset:16px 16px auto 16px;padding:14px 16px;border-radius:14px;background:#15171b;color:#fff;font:600 14px system-ui;box-shadow:0 12px 40px #0008";
      box.textContent = "تعذر التحقق من جلسة Telegram. افتح RADIUS من زر البوت الرسمي ثم حاول مجددًا.";
      document.body.appendChild(box);
    }, { once: true });
  });
})();
