const RELEASE_VERSION = "2026.08.11.2";

function pathOnly(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

function isSensitivePath(pathname) {
  return (
    pathname === "/health" ||
    pathname === "/ready" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/admin/") ||
    /^\/store\/[^/]+\/(?:wallet|account)(?:\/|$)/.test(pathname)
  );
}

function isUiCode(pathname) {
  return pathname === "/sw.js" || /\.(?:css|js|mjs|webmanifest)$/i.test(pathname);
}

function isUiDocument(request) {
  const accept = String(request.headers?.accept || "");
  return request.method === "GET" && accept.includes("text/html");
}

export function installHttpHardening(app, config) {
  app.addHook("onSend", async (request, reply, payload) => {
    const pathname = pathOnly(request);
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    reply.header("cross-origin-opener-policy", "same-origin");
    reply.header("cross-origin-resource-policy", "same-origin");
    reply.header("x-permitted-cross-domain-policies", "none");
    reply.header("x-uchiha-release", RELEASE_VERSION);

    if (config.nodeEnv === "production" && config.cookieSecure) {
      reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    }
    if (config.demoSeed) {
      reply.header("x-robots-tag", "noindex, nofollow, noarchive");
    }
    if (isSensitivePath(pathname) || isUiDocument(request)) {
      reply.header("cache-control", "no-store, max-age=0");
      reply.header("pragma", "no-cache");
      reply.header("expires", "0");
    } else if (isUiCode(pathname)) {
      reply.header("cache-control", "no-cache, max-age=0, must-revalidate");
      reply.header("pragma", "no-cache");
    }

    return payload;
  });
}
