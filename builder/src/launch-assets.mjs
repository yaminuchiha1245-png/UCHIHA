const RELEASE = "2026.08.03.2";

function pagePath(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

function assetsFor(pathname) {
  if (pathname === "/create-store") {
    return { styles: [], scripts: [`/assets/launch-builder-sales.js?v=${RELEASE}`] };
  }
  if (pathname === "/platform-admin") {
    return { styles: [], scripts: [`/assets/launch-admin-sales.js?v=${RELEASE}`] };
  }
  if (pathname === "/account") {
    return {
      styles: [`/assets/platform-account-core.css?v=${RELEASE}`],
      scripts: [`/assets/platform-account-core.js?v=${RELEASE}`]
    };
  }
  return null;
}

function injectAssets(html, assets) {
  let output = html;
  for (const source of assets.styles) {
    if (output.includes(source)) continue;
    output = output.replace(/<\/head>/i, `<link rel="stylesheet" href="${source}"></head>`);
  }
  for (const source of assets.scripts) {
    if (output.includes(source)) continue;
    output = output.replace(/<\/body>/i, `<script src="${source}" defer></script></body>`);
  }
  return output;
}

export function installLaunchAssetInjection(app) {
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method !== "GET") return payload;
    const assets = assetsFor(pagePath(request));
    if (!assets) return payload;
    const html = Buffer.isBuffer(payload)
      ? payload.toString("utf8")
      : typeof payload === "string"
        ? payload
        : null;
    if (!html || !/<\/body>/i.test(html)) return payload;
    const injected = injectAssets(html, assets);
    if (injected === html) return payload;
    reply.removeHeader("content-length");
    reply.header("cache-control", "no-cache, max-age=0, must-revalidate");
    return injected;
  });
}
