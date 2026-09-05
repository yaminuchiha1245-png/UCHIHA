const CACHE="game-zone-v1-rc13-static";
const STATIC=[
  "/","/styles.css","/app.js","/manifest.webmanifest",
  "/privacy.html","/terms.html","/account-deletion.html","/legal.css",
  "/icon-192.png","/icon-512.png","/assets/game-zone-logo.jpg"
];
const STATIC_SET=new Set(STATIC);

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch",event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=="GET"||url.origin!==self.location.origin)return;

  // Never let the storefront Service Worker cache/control Admin or API content.
  if(url.pathname.startsWith("/api/")||url.pathname.startsWith("/admin"))return;

  const isStatic=STATIC_SET.has(url.pathname);
  if(!isStatic)return;

  event.respondWith(
    fetch(req).then(res=>{
      if(res.ok){
        const copy=res.clone();
        caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});
      }
      return res;
    }).catch(()=>caches.match(req).then(r=>r||(url.pathname==="/"?caches.match("/"):Response.error())))
  );
});
