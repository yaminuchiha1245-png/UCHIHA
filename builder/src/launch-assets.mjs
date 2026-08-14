import { readFileSync } from "node:fs";

const RELEASE = "2026.08.14.3";
const ACCOUNT_DOCUMENT = readFileSync(new URL("../public/account-unified.html", import.meta.url), "utf8");
const V41_DOCUMENT = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const PUBLIC_DOCUMENT = readFileSync(new URL("../public/platform-v5.html", import.meta.url), "utf8");
const V41_STYLES = [`/assets/v41-responsive.css?v=${RELEASE}`];
const V41_SCRIPTS = [`/assets/v41-production-bridge.js?v=${RELEASE}`];
const STOREFRONT_STYLES = [`/assets/store-desktop-responsive.css?v=${RELEASE}`];
const PLATFORM_STYLES = [
  `/assets/platform-v5.css?v=${RELEASE}`,
  `/assets/platform-v5-responsive.css?v=${RELEASE}`,
  `/assets/platform-v5-polish.css?v=${RELEASE}`
];
const PLATFORM_SCRIPTS = [
  `/assets/platform-v5-recovery.js?v=${RELEASE}`,
  `/assets/platform-v5.js?v=${RELEASE}`,
  `/assets/platform-v5-stability.js?v=${RELEASE}`,
  `/assets/platform-v5-polish.js?v=${RELEASE}`
];

const PUBLIC_DOCUMENT_PATHS = new Set([
  "/",
  "/login",
  "/register",
  "/services",
  "/showcase",
  "/payment-methods",
  "/api-services",
  "/support",
  "/contact",
  "/about",
  "/privacy",
  "/terms",
  "/refund-policy",
  "/add-balance",
  "/orders",
  "/index.html",
  "/login.html",
  "/register.html",
  "/services.html",
  "/showcase.html",
  "/payment-methods.html",
  "/api-services.html",
  "/support.html",
  "/contact.html",
  "/about.html",
  "/privacy.html",
  "/terms.html",
  "/refund-policy.html"
]);

const PLATFORM_ALIAS_ROUTES = [
  "/index.html",
  "/login.html",
  "/register",
  "/register.html",
  "/services.html",
  "/showcase.html",
  "/payment-methods.html",
  "/api-services",
  "/api-services.html",
  "/support.html",
  "/contact.html",
  "/about",
  "/about.html",
  "/privacy.html",
  "/terms.html",
  "/refund-policy",
  "/refund-policy.html"
];

function pagePath(request) {
  return String(request.raw?.url || request.url || "").split("?")[0].replace(/\/+$/, "") || "/";
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

function productionV41Document() {
  return V41_DOCUMENT
    .replace("<title>UCHIHA Platform — v41 Final Demo</title>", "<title>UCHIHA Platform</title>");
}

function normalizeStorefrontRelease(html) {
  return html
    .replaceAll("2026.08.11.2", RELEASE)
    .replaceAll("20260801-platform", RELEASE)
    .replace('href="/assets/styles.css"', `href="/assets/styles.css?v=${RELEASE}"`)
    .replace('href="/assets/ui-v2.css"', `href="/assets/ui-v2.css?v=${RELEASE}"`)
    .replace('src="/assets/i18n.js"', `src="/assets/i18n.js?v=${RELEASE}"`)
    .replace('src="/assets/payments-links.js"', `src="/assets/payments-links.js?v=${RELEASE}"`);
}

function documentResponse(reply, document) {
  reply.removeHeader("content-length");
  reply.header("content-type", "text/html; charset=utf-8");
  reply.header("cache-control", "no-store, max-age=0");
  reply.header("pragma", "no-cache");
  reply.header("expires", "0");
  return document;
}

function responseHtml(payload) {
  if (Buffer.isBuffer(payload)) return payload.toString("utf8");
  if (typeof payload === "string") return payload;
  return null;
}

function registerPlatformRoutes(app) {
  const handler = async (_request, reply) => documentResponse(reply, PUBLIC_DOCUMENT);
  app.get("/category/:categorySlug", handler);
  app.get("/category/:categorySlug/:subcategorySlug", handler);
  app.get("/product/:productSlug", handler);
  app.get("/add-balance", handler);
  app.get("/add-balance/:methodKey", handler);
  app.get("/orders", handler);
  for (const path of PLATFORM_ALIAS_ROUTES) app.get(path, handler);
}

export function installLaunchAssetInjection(app) {
  registerPlatformRoutes(app);

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method !== "GET") return payload;
    const pathname = pagePath(request);

    if (pathname === "/account") {
      return documentResponse(
        reply,
        injectAssets(ACCOUNT_DOCUMENT, {
          styles: [...PLATFORM_STYLES, `/assets/account-renewals.css?v=${RELEASE}`],
          scripts: [...PLATFORM_SCRIPTS, `/assets/account-renewals.js?v=${RELEASE}`]
        })
      );
    }

    if (pathname === "/" || pathname === "/index.html") {
      return documentResponse(
        reply,
        injectAssets(productionV41Document(), { styles: V41_STYLES, scripts: V41_SCRIPTS })
      );
    }

    if (PUBLIC_DOCUMENT_PATHS.has(pathname)) {
      return documentResponse(reply, PUBLIC_DOCUMENT);
    }

    if (pathname === "/create-store") {
      const html = responseHtml(payload);
      if (!html || !/<\/body>/i.test(html)) return payload;
      return documentResponse(
        reply,
        injectAssets(html, {
          styles: [...PLATFORM_STYLES, `/assets/platform-unified-compat.css?v=${RELEASE}`],
          scripts: [
            `/assets/platform-v5-builder.js?v=${RELEASE}`,
            `/assets/launch-builder-sales.js?v=${RELEASE}`,
            `/assets/launch-payment-method-guard.js?v=${RELEASE}`
          ]
        })
      );
    }

    if (/^\/store\/[^/]+$/.test(pathname)) {
      const html = responseHtml(payload);
      if (!html || !/<\/body>/i.test(html)) return payload;
      const currentStorefront = normalizeStorefrontRelease(html);
      return documentResponse(
        reply,
        injectAssets(currentStorefront, { styles: STOREFRONT_STYLES, scripts: [] })
      );
    }

    if (/^\/admin\/[^/]+$/.test(pathname)) {
      const html = responseHtml(payload);
      if (!html || !/<\/body>/i.test(html)) return payload;
      return documentResponse(
        reply,
        injectAssets(html, {
          styles: [`/assets/admin-bot-link-v1.css?v=${RELEASE}`],
          scripts: [`/assets/admin-bot-link-v1.js?v=${RELEASE}`]
        })
      );
    }

    if (pathname === "/platform-admin") {
      const html = responseHtml(payload);
      if (!html || !/<\/body>/i.test(html)) return payload;
      return documentResponse(
        reply,
        injectAssets(html, {
          styles: [],
          scripts: [
            `/assets/launch-admin-sales.js?v=${RELEASE}`,
            `/assets/launch-admin-renewals.js?v=${RELEASE}`
          ]
        })
      );
    }

    return payload;
  });
}
