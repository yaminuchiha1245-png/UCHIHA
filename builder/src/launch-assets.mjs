import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

// Keep the legacy asset release synchronized with sw/theme/pwa/app.
// V60 has its own independent UI release marker and cache identity.
const RELEASE = "2026.08.14.3";
const V60_RELEASE = "60.0.0";
const ACCOUNT_DOCUMENT = readFileSync(new URL("../public/account-unified.html", import.meta.url), "utf8");
const PUBLIC_DOCUMENT = readFileSync(new URL("../public/platform-v5.html", import.meta.url), "utf8");
const V60_DOCUMENT = gunzipSync(
  readFileSync(new URL("../public/platform-v60.html.gz", import.meta.url))
).toString("utf8");
const V60_SCRIPT_GZIP = readFileSync(new URL("../public/platform-v60.js.gz", import.meta.url));
const V60_SCRIPT = gunzipSync(V60_SCRIPT_GZIP);
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

// V60 becomes the primary public/customer shell. Operational surfaces that still
// contain capabilities not present in V60 (/account renewals and /create-store
// tenant wizard) intentionally remain on the existing Builder UI.
const V60_DOCUMENT_PATHS = new Set([
  "/",
  "/login",
  "/register",
  "/services",
  "/payment-methods",
  "/support",
  "/contact",
  "/about",
  "/add-balance",
  "/orders",
  "/wallet",
  "/builder",
  "/pricing",
  "/domain",
  "/notifications",
  "/index.html",
  "/login.html",
  "/register.html",
  "/services.html",
  "/payment-methods.html",
  "/support.html",
  "/contact.html",
  "/about.html"
]);

const PUBLIC_DOCUMENT_PATHS = new Set([
  "/showcase",
  "/api-services",
  "/privacy",
  "/terms",
  "/refund-policy",
  "/showcase.html",
  "/api-services.html",
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

const V60_EXTRA_ROUTES = ["/wallet", "/builder", "/pricing", "/domain", "/notifications"];

function pagePath(request) {
  return String(request.raw?.url || request.url || "").split("?")[0].replace(/\/+$/, "") || "/";
}

function isPlatformPublicPath(pathname) {
  return PUBLIC_DOCUMENT_PATHS.has(pathname)
    || /^\/category\/[^/]+(?:\/[^/]+)?$/.test(pathname)
    || /^\/product\/[^/]+$/.test(pathname)
    || /^\/add-balance\/[^/]+$/.test(pathname);
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

function normalizeStorefrontRelease(html) {
  return html
    .replaceAll("2026.08.11.2", RELEASE)
    .replaceAll("20260801-platform", RELEASE)
    .replace('href="/assets/styles.css"', `href="/assets/styles.css?v=${RELEASE}"`)
    .replace('href="/assets/ui-v2.css"', `href="/assets/ui-v2.css?v=${RELEASE}"`)
    .replace('src="/assets/i18n.js"', `src="/assets/i18n.js?v=${RELEASE}"`)
    .replace('src="/assets/payments-links.js"', `src="/assets/payments-links.js?v=${RELEASE}"`);
}

function documentResponse(reply, document, release = null) {
  reply.removeHeader("content-length");
  reply.header("content-type", "text/html; charset=utf-8");
  reply.header("cache-control", "no-store, max-age=0");
  reply.header("pragma", "no-cache");
  reply.header("expires", "0");
  if (release) reply.header("x-uchiha-ui-release", release);
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

function registerV60Routes(app) {
  const handler = async (_request, reply) => documentResponse(reply, V60_DOCUMENT, "v60");
  for (const path of V60_EXTRA_ROUTES) app.get(path, handler);

  const scriptHandler = async (request, reply) => {
    reply.header("content-type", "application/javascript; charset=utf-8");
    reply.header("cache-control", "public, max-age=31536000, immutable");
    reply.header("vary", "Accept-Encoding");
    reply.header("x-uchiha-ui-release", "v60");
    const encoding = String(request.headers["accept-encoding"] || "");
    if (/\bgzip\b/i.test(encoding)) {
      reply.header("content-encoding", "gzip");
      return V60_SCRIPT_GZIP;
    }
    return V60_SCRIPT;
  };

  // Keep both paths during rollout. The final V60 HTML uses /assets/ while
  // earlier rollout artifacts used the root path; both must remain functional
  // while browser/service-worker caches converge.
  app.get("/platform-v60.js", scriptHandler);
  app.get("/assets/platform-v60.js", scriptHandler);
}

export function installLaunchAssetInjection(app) {
  registerPlatformRoutes(app);
  registerV60Routes(app);

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

    if (V60_DOCUMENT_PATHS.has(pathname)) {
      return documentResponse(reply, V60_DOCUMENT, "v60");
    }

    if (isPlatformPublicPath(pathname)) {
      return documentResponse(reply, PUBLIC_DOCUMENT);
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
