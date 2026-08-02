const RELEASE = "2026.08.03.1";

function pagePath(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

function scriptFor(pathname) {
  if (pathname === "/create-store") return `/assets/launch-builder-sales.js?v=${RELEASE}`;
  if (pathname === "/platform-admin") return `/assets/launch-admin-sales.js?v=${RELEASE}`;
  return null;
}

export function installLaunchAssetInjection(app) {
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method !== "GET") return payload;
    const source = scriptFor(pagePath(request));
    if (!source) return payload;
    const html = Buffer.isBuffer(payload)
      ? payload.toString("utf8")
      : typeof payload === "string"
        ? payload
        : null;
    if (!html || !/<\/body>/i.test(html) || html.includes(source)) return payload;
    reply.removeHeader("content-length");
    reply.header("cache-control", "no-cache, max-age=0, must-revalidate");
    return html.replace(/<\/body>/i, `<script src="${source}" defer></script></body>`);
  });
}
