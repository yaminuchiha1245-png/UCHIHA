import { readFileSync } from "node:fs";

const RELEASE = "2026.08.04.1";
const ACCOUNT_DOCUMENT = readFileSync(new URL("../public/account-unified.html", import.meta.url), "utf8");
const PLATFORM_STYLES = [`/assets/platform-unified.css?v=${RELEASE}`];
const PLATFORM_SCRIPTS = [`/assets/platform-unified.js?v=${RELEASE}`];
const UNIFIED_PUBLIC_PATHS = new Set([
  "/login",
  "/register",
  "/create-store",
  "/services",
  "/showcase",
  "/payment-methods",
  "/api-services",
  "/support",
  "/about",
  "/privacy",
  "/terms",
  "/refund-policy"
]);

function pagePath(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

function assetsFor(pathname) {
  if (pathname === "/create-store") {
    return {
      styles: PLATFORM_STYLES,
      scripts: [`/assets/launch-builder-sales.js?v=${RELEASE}`, ...PLATFORM_SCRIPTS]
    };
  }
  if (pathname === "/platform-admin") {
    return { styles: [], scripts: [`/assets/launch-admin-sales.js?v=${RELEASE}`] };
  }
  if (UNIFIED_PUBLIC_PATHS.has(pathname)) {
    return { styles: PLATFORM_STYLES, scripts: PLATFORM_SCRIPTS };
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
    const pathname = pagePath(request);

    if (pathname === "/account") {
      reply.removeHeader("content-length");
      reply.header("content-type", "text/html; charset=utf-8");
      reply.header("cache-control", "no-cache, max-age=0, must-revalidate");
      return injectAssets(ACCOUNT_DOCUMENT, {
        styles: PLATFORM_STYLES,
        scripts: PLATFORM_SCRIPTS
      });
    }

    const assets = assetsFor(pathname);
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
