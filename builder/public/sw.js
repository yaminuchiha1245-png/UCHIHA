// UCHIHA production service worker cache generation.
const RELEASE_VERSION = "2026.08.14.3";
const CACHE_NAME = `uchiha-shell-${RELEASE_VERSION}`;
const STATIC_ASSETS = [
  `/assets/styles.css?v=${RELEASE_VERSION}`,
  `/assets/ui-v2.css?v=${RELEASE_VERSION}`,
  `/assets/platform-v3.css?v=${RELEASE_VERSION}`,
  `/assets/v41-responsive.css?v=${RELEASE_VERSION}`,
  `/assets/platform-v5.css?v=${RELEASE_VERSION}`,
  `/assets/platform-v5-responsive.css?v=${RELEASE_VERSION}`,
  `/assets/platform-v5-polish.css?v=${RELEASE_VERSION}`,
  `/assets/platform-unified-compat.css?v=${RELEASE_VERSION}`,
  `/assets/platform-v5-recovery.js?v=${RELEASE_VERSION}`,
  `/assets/platform-v5.js?v=${RELEASE_VERSION}`,
  `/assets/platform-v5-stability.js?v=${RELEASE_VERSION}`,
  `/assets/platform-v5-polish.js?v=${RELEASE_VERSION}`,
  `/assets/platform-v5-builder.js?v=${RELEASE_VERSION}`,
  `/assets/launch-builder-sales.js?v=${RELEASE_VERSION}`,
  `/assets/launch-payment-method-guard.js?v=${RELEASE_VERSION}`,
  `/assets/launch-admin-sales.js?v=${RELEASE_VERSION}`,
  `/assets/account-renewals.css?v=${RELEASE_VERSION}`,
  `/assets/account-renewals.js?v=${RELEASE_VERSION}`,
  `/assets/launch-admin-renewals.js?v=${RELEASE_VERSION}`,
  `/assets/monochrome-v1.css?v=${RELEASE_VERSION}`,
  `/assets/store-reference.css?v=${RELEASE_VERSION}`,
  `/assets/store-reference-runtime.css?v=${RELEASE_VERSION}`,
  `/assets/store-reference-welcome.css?v=${RELEASE_VERSION}`,
  `/assets/store-polish-v2.css?v=${RELEASE_VERSION}`,
  `/assets/store-polish-v2-runtime.css?v=${RELEASE_VERSION}`,
  `/assets/store-commerce-v3.css?v=${RELEASE_VERSION}`,
  `/assets/store-checkout-v4.css?v=${RELEASE_VERSION}`,
  `/assets/store-catalog-v5.css?v=${RELEASE_VERSION}`,
  `/assets/store-launch-v6.css?v=${RELEASE_VERSION}`,
  `/assets/store-category-color-final.css?v=${RELEASE_VERSION}`,
  `/assets/store-launch-v6.js?v=${RELEASE_VERSION}`,
  `/assets/store-polish-v2.js?v=${RELEASE_VERSION}`,
  `/assets/store-boot-guard.js?v=${RELEASE_VERSION}`,
  `/assets/store-reference.js?v=${RELEASE_VERSION}`,
  `/assets/account-polish-v2.css?v=${RELEASE_VERSION}`,
  `/assets/account-polish-v2.js?v=${RELEASE_VERSION}`,
  `/assets/customer-shell-v1.css?v=${RELEASE_VERSION}`,
  `/assets/customer-shell-v1.js?v=${RELEASE_VERSION}`,
  `/assets/account-payment-method-placeholders-v3.css?v=${RELEASE_VERSION}`,
  `/assets/account-payment-method-placeholders-v3.js?v=${RELEASE_VERSION}`,
  `/assets/account-payment-proof-v3.css?v=${RELEASE_VERSION}`,
  `/assets/account-payment-proof-v3.js?v=${RELEASE_VERSION}`,
  `/assets/account-proof-history-v3.js?v=${RELEASE_VERSION}`,
  `/assets/store-direct-buy-v7.css?v=${RELEASE_VERSION}`,
  `/assets/store-direct-buy-v7.js?v=${RELEASE_VERSION}`,
  `/assets/admin-reference.css?v=${RELEASE_VERSION}`,
  `/assets/admin-polish-v2.css?v=${RELEASE_VERSION}`,
  `/assets/admin-catalog-v3.css?v=${RELEASE_VERSION}`,
  `/assets/admin-catalog-v3-runtime.css?v=${RELEASE_VERSION}`,
  `/assets/admin-launch-v4.css?v=${RELEASE_VERSION}`,
  `/assets/admin-reference.js?v=${RELEASE_VERSION}`,
  `/assets/admin-polish-v2.js?v=${RELEASE_VERSION}`,
  `/assets/admin-catalog-v3.js?v=${RELEASE_VERSION}`,
  `/assets/admin-subpages-reference.css?v=${RELEASE_VERSION}`,
  `/assets/admin-subpages-polish-v2.css?v=${RELEASE_VERSION}`,
  `/assets/admin-subpages-polish-v2.js?v=${RELEASE_VERSION}`,
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
  "/assets/marketing-assets/showcase-store.svg",
  "/assets/marketing-assets/slide-apps.svg",
  "/assets/marketing-assets/slide-commerce.svg",
  "/assets/marketing-assets/slide-infrastructure.svg",
  "/assets/catalog-assets/social-service.svg",
  "/assets/catalog-assets/programming.svg",
  "/assets/catalog-assets/ai-chatbot.svg",
  "/assets/catalog-assets/software.svg",
  "/assets/demo-assets/uchiha-slide-main.svg",
  "/assets/demo-assets/uchiha-slide-account.svg",
  "/assets/demo-assets/uchiha-slide-support.svg",
  "/assets/demo-assets/uchiha-category-games.svg",
  "/assets/demo-assets/uchiha-category-subscriptions.svg",
  "/assets/demo-assets/uchiha-category-digital.svg",
  "/assets/demo-assets/uchiha-category-services.svg",
  "/assets/demo-assets/uchiha-banner-madara.webp",
  "/assets/demo-assets/uchiha-banner-obito.webp",
  "/assets/demo-assets/uchiha-banner-itachi.webp",
  "/assets/demo-assets/uchiha-banner-madara-1280.webp",
  "/assets/demo-assets/uchiha-banner-madara-1920.webp",
  "/assets/demo-assets/uchiha-banner-obito-1280.webp",
  "/assets/demo-assets/uchiha-banner-obito-1920.webp",
  "/assets/demo-assets/uchiha-banner-itachi-1280.webp",
  "/assets/demo-assets/uchiha-banner-itachi-1920.webp",
  "/assets/demo-assets/uchiha-banner-konan.svg",
  "/assets/demo-assets/uchiha-banner-konan-1280.svg",
  "/assets/demo-assets/uchiha-banner-konan-1920.svg",
  "/assets/demo-assets/uchiha-category-games-v2.svg",
  "/assets/demo-assets/uchiha-category-subscriptions-v2.svg",
  "/assets/demo-assets/uchiha-category-digital-v2.svg",
  "/assets/demo-assets/uchiha-category-services-v2.svg",
  "/assets/demo-assets/uchiha-transparent-mark.svg",
  "/assets/social-icons/whatsapp.svg",
  "/assets/social-icons/telegram.svg",
  "/assets/social-icons/instagram.svg",
  "/assets/social-icons/facebook.svg",
  "/assets/social-icons/youtube.svg",
  "/assets/social-icons/tiktok.svg",
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
