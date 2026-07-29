const CACHE_NAME = "uchiha-shell-v5";
const STATIC_ASSETS = [
  "/",
  "/assets/styles.css",
  "/assets/ui-v2.css",
  "/assets/platform-v3.css",
  "/assets/theme.js",
  "/assets/app.js",
  "/assets/pwa.js",
  "/assets/payments-links.js",
  "/assets/brand/uchiha-mark.svg",
  "/assets/brand/app-icon.svg",
  "/assets/brand/app-icon-192.png",
  "/assets/brand/app-icon-512.png",
  "/assets/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(request)) || caches.match("/"))
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    if (/\.(?:css|js|webmanifest)$/.test(url.pathname)) {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(async () => (await caches.match(request)) || Response.error())
      );
      return;
    }

    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
