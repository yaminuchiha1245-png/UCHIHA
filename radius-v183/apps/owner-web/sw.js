const CACHE = "uchiha-owner-1.0.0-rc.1-operations";
const SHELL = ["/owner/", "/owner/src/styles.css", "/provider/src/styles.css", "/owner/src/app.js", "/owner/src/api.js", "/owner/public/icons/icon.svg", "/owner/public/icons/icon-192.png", "/owner/public/icons/icon-512.png"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("uchiha-owner-") && key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok && !/no-store/i.test(response.headers.get("cache-control") ?? "")) {
      const copy = response.clone(); event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});
