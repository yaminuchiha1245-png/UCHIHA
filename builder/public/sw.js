// Retired cache generation marker retained for upgrade audits: uchiha-shell-v11.
const RELEASE_VERSION = "2026.08.07.11";
const CACHE_NAME = `uchiha-shell-${RELEASE_VERSION}`;
const STATIC_ASSETS = [
  `/assets/styles.css?v=${RELEASE_VERSION}`,
  `/assets/ui-v2.css?v=${RELEASE_VERSION}`,
  `/assets/platform-v3.css?v=${RELEASE_VERSION}`,
  `/assets/store-reference.css?v=${RELEASE_VERSION}`,
  `/assets/store-reference-runtime.css?v=${RELEASE_VERSION}`,
  `/assets/store-reference-welcome.css?v=${RELEASE_VERSION}`,
  `/assets/store-polish-v2.css?v=${RELEASE_VERSION}`,
  `/assets/store-polish-v2-runtime.css?v=${RELEASE_VERSION}`,
  `/assets/store-commerce-v3.css?v=${RELEASE_VERSION}`,
  `/assets/store-checkout-v4.css?v=${RELEASE_VERSION}`,
  `/assets/store-polish-v2.js?v=${RELEASE_VERSION}`,
  `/assets/store-boot-guard.js?v=${RELEASE_VERSION}`,
  `/assets/store-reference.js?v=${RELEASE_VERSION}`,
  `/assets/admin-reference.css?v=${RELEASE_VERSION}`,
  `/assets/admin-polish-v2.css?v=${RELEASE_VERSION}`,
  `/assets/admin-reference.js?v=${RELEASE_VERSION}`,
  `/assets/admin-polish-v2.js?v=${RELEASE_VERSION}`,
  `/assets/admin-subpages-reference.css?v=${RELEASE_VERSION}`,
  `/assets/uchiha-showcase-preview.css?v=${RELEASE_VERSION}`,
  `/assets/theme.js?v=${RELEASE_VERSION}`,
  `/assets/i18n.js?v=${RELEASE_VERSION}`,
  `/assets/i18n.css?v=${RELEASE_VERSION}`,
  `/assets/preview-banner.js?v=${RELEASE_VERSION}`,
  `/assets/runtime-recovery.js?v=${RELEASE_VERSION}`,
  `/assets/functional-hardening.js?v=${RELEASE_VERSION}`,
  `/assets/marketing.css?v=${RELEASE_VERSION}`,
  `/assets/marketing.js?v=${RELEASE_VERSION}`,
  `/assets/app.js?v=${RELEASE_VERSION}`,
  `/assets/pwa.js?v=${RELEASE_VERSION}`,
  "/assets/brand/platform-mark.svg",
  "/assets/brand/storefront-mark.svg",
  "/assets/brand/uchiha-mark.svg",
  "/assets/brand/app-icon-192.png",
  "/assets/brand/app-icon-512.png",
  "/assets/demo-assets/uchiha-slide-main.svg",
  "/assets/demo-assets/uchiha-slide-account.svg",
  "/assets/demo-assets/uchiha-slide-support.svg",
  "/assets/demo-assets/uchiha-category-games.svg",
  "/assets/demo-assets/uchiha-category-subscriptions.svg",
  "/assets/demo-assets/uchiha-category-digital.svg",
  "/assets/demo-assets/uchiha-category-services.svg",
  "/assets/manifest.webmanifest"
];

async function fresh(request) {
  return fetch(request, { cache: "no-store" });
}

async function warmStaticCache() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(STATIC_ASSETS.map(async (asset) => {
    try {
      const response = await fresh(asset);
      if (response.ok) await cache.put(asset, response);
    } catch {
      // A single optional asset must not prevent the new worker from activating.
    }
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(warmStaticCache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME && key.startsWith("uchiha-")).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
  if (event.data === "CLEAR_UCHIHA_CACHES") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("uchiha-")).map((key) => caches.delete(key))
    )));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fresh(request).catch(() => new Response(
        "<!doctype html><html lang=\"ar\" dir=\"rtl\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>تعذر الاتصال</title><body style=\"font-family:system-ui;padding:32px;text-align:center\"><h1>تعذر الاتصال بالخادم</h1><p>تحقق من الإنترنت ثم أعد تحميل الصفحة.</p><button onclick=\"location.reload()\" style=\"padding:12px 20px\">إعادة المحاولة</button></body></html>",
        { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
      ))
    );
    return;
  }

  if (/\.(?:css|js|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      fresh(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(async () => (await caches.match(request)) || Response.error())
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fresh(request)
          .then((response) => {
            if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
            return response;
          })
          .catch(() => cached || Response.error());
        return cached || network;
      })
    );
  }
});