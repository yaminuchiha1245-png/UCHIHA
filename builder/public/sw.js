const RELEASE_VERSION = "2026.08.02.1";
const CACHE_NAME = `uchiha-shell-${RELEASE_VERSION}`;
const STATIC_ASSETS = [
  "/",
  `/assets/styles.css?v=${RELEASE_VERSION}`,
  `/assets/ui-v2.css?v=${RELEASE_VERSION}`,
  `/assets/platform-v3.css?v=${RELEASE_VERSION}`,
  `/assets/uchiha-showcase-preview.css?v=${RELEASE_VERSION}`,
  `/assets/theme.js?v=${RELEASE_VERSION}`,
  `/assets/i18n.js?v=${RELEASE_VERSION}`,
  `/assets/i18n.css?v=${RELEASE_VERSION}`,
  `/assets/preview-banner.js?v=${RELEASE_VERSION}`,
  `/assets/marketing.css?v=${RELEASE_VERSION}`,
  `/assets/marketing.js?v=${RELEASE_VERSION}`,
  `/assets/app.js?v=${RELEASE_VERSION}`,
  `/assets/pwa.js?v=${RELEASE_VERSION}`,
  "/assets/brand/platform-mark.svg",
  "/assets/brand/storefront-mark.svg",
  "/assets/brand/uchiha-mark.svg",
  "/assets/brand/app-icon-192.png",
  "/assets/brand/app-icon-512.png",
  "/assets/manifest.webmanifest"
];

async function fresh(request) {
  return fetch(request, { cache: "no-store" });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
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
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fresh(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match("/"))
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
