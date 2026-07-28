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

export function installHttpHardening(app, config) {
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    reply.header("cross-origin-opener-policy", "same-origin");
    reply.header("cross-origin-resource-policy", "same-origin");
    reply.header("x-permitted-cross-domain-policies", "none");

    if (config.nodeEnv === "production" && config.cookieSecure) {
      reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    }
    if (config.demoSeed) {
      reply.header("x-robots-tag", "noindex, nofollow, noarchive");
    }
    if (isSensitivePath(pathOnly(request))) {
      reply.header("cache-control", "no-store, max-age=0");
      reply.header("pragma", "no-cache");
    }

    return payload;
  });
}
