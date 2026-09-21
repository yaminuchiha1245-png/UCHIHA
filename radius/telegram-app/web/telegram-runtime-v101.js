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
  const requiresProviderAuth = (path) =>
    path.startsWith("/api/catalog") ||
    path.startsWith("/api/workflows") ||
    path.startsWith("/api/operations") ||
    path.startsWith("/api/radius-provider/") ||
    path.startsWith("/api/connectors/radius");

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
      const [cat, sessions] = await Promise.all([
        originalFetch("/api/catalog", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } }),
        originalFetch("/api/radius-provider/sessions", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } })
      ]);
      if (cat.ok) {
        const catalog = await cat.json();
        localStorage.setItem("uchiha-radius-local-catalog", JSON.stringify(catalog));
        localStorage.setItem("uchiha-radius-provider-cache", "server-authoritative");
        window.dispatchEvent(new CustomEvent("uchiha-radius-provider-catalog-ready", { detail: { provider: body.provider } }));
      }
      if (sessions.ok) {
        const data = await sessions.json();
        const seed = window.__UCHIHA_RADIUS_SESSION_SEED__ || (window.__UCHIHA_RADIUS_SESSION_SEED__ = []);
        const bytes = (n) => {
          const v = Number(n || 0);
          if (v >= 1073741824) return (v / 1073741824).toFixed(1) + " GB";
          if (v >= 1048576) return (v / 1048576).toFixed(1) + " MB";
          if (v >= 1024) return (v / 1024).toFixed(1) + " KB";
          return String(v) + " B";
        };
        const duration = (started, stopped) => {
          const start = Number(started || 0);
          if (!start) return "—";
          const end = Number(stopped || 0) || Math.floor(Date.now() / 1000);
          const seconds = Math.max(0, end - start);
          const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
          const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
          const s = String(seconds % 60).padStart(2, "0");
          return h + ":" + m + ":" + s;
        };
        seed.splice(0, seed.length, ...(Array.isArray(data.items) ? data.items : []).map((item) => ({
          id: String(item.id || ""),
          user: String(item.username || ""),
          provider: String(item.provider_name || body?.provider?.name || ""),
          nas: String(item.nas || item.router_name || ""),
          ip: String(item.framed_ip || "—"),
          kind: String(item.access_kind || "RADIUS"),
          duration: duration(item.started_at, item.stopped_at),
          down: "—",
          up: "—",
          traffic: bytes(Number(item.input_octets || 0) + Number(item.output_octets || 0)),
          latencyMs: null,
          authServer: "Backend v37",
          startedAt: item.started_at ? new Date(Number(item.started_at) * 1000).toISOString() : new Date().toISOString(),
          state: String(item.status || "") === "online" ? "healthy" : "disconnected",
          tone: String(item.status || "") === "online" ? "green" : "red"
        })));
        window.dispatchEvent(new CustomEvent("uchiha-radius-session-change"));
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
