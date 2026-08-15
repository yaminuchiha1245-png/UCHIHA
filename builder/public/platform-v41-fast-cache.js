(() => {
  "use strict";

  const nativeFetch = window.fetch.bind(window);
  const CACHE_PREFIX = "uchiha:v41:fast-nav:";
  const PAYMENT_ROUTE = /^\/add-balance(?:\/|$)/;
  const CACHE_RULES = new Map([
    ["/api/public/portal", 30000],
    ["/api/me", 12000],
    ["/api/platform/account", 12000]
  ]);

  function storageAvailable() {
    try {
      const key = `${CACHE_PREFIX}probe`;
      sessionStorage.setItem(key, "1");
      sessionStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  const canStore = storageAvailable();

  function requestInfo(input, init) {
    try {
      const request = input instanceof Request ? input : null;
      const method = String(init?.method || request?.method || "GET").toUpperCase();
      const rawUrl = request?.url || String(input || "");
      const url = new URL(rawUrl, location.href);
      return { method, url };
    } catch {
      return null;
    }
  }

  function storageKey(pathname) {
    return `${CACHE_PREFIX}${pathname}`;
  }

  function removeCached(pathname) {
    if (!canStore) return;
    try {
      sessionStorage.removeItem(storageKey(pathname));
    } catch {
      // Cache is only an optimization; failures must never block navigation.
    }
  }

  function clearPrivateCache() {
    removeCached("/api/me");
    removeCached("/api/platform/account");
  }

  function readCached(pathname, ttl) {
    if (!canStore || !PAYMENT_ROUTE.test(location.pathname)) return null;
    try {
      const raw = sessionStorage.getItem(storageKey(pathname));
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry || typeof entry.body !== "string" || !Number.isFinite(entry.savedAt)) {
        removeCached(pathname);
        return null;
      }
      if ((Date.now() - entry.savedAt) > ttl) {
        removeCached(pathname);
        return null;
      }
      return new Response(entry.body, {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "x-uchiha-fast-cache": "hit" }
      });
    } catch {
      return null;
    }
  }

  function storeResponse(pathname, response) {
    if (!canStore || !response?.ok) return;
    const contentType = String(response.headers.get("content-type") || "");
    if (!contentType.includes("application/json")) return;
    response.clone().text().then((body) => {
      try {
        sessionStorage.setItem(storageKey(pathname), JSON.stringify({ savedAt: Date.now(), body }));
      } catch {
        // Ignore quota/private-mode failures. The network response remains authoritative.
      }
    }).catch(() => undefined);
  }

  window.fetch = function uchihaFastFetch(input, init) {
    const info = requestInfo(input, init);
    if (!info || info.url.origin !== location.origin) return nativeFetch(input, init);

    if (info.method !== "GET") {
      if (info.url.pathname.startsWith("/api/auth/") || info.url.pathname.startsWith("/api/platform/")) {
        clearPrivateCache();
      }
      return nativeFetch(input, init);
    }

    const ttl = CACHE_RULES.get(info.url.pathname);
    if (!ttl) return nativeFetch(input, init);

    const cached = readCached(info.url.pathname, ttl);
    if (cached) return Promise.resolve(cached);

    return nativeFetch(input, init).then((response) => {
      storeResponse(info.url.pathname, response);
      return response;
    });
  };

  window.addEventListener("pagehide", () => {
    // Keep the very short-lived cache across the document reload used by payment routes.
  });
})();
