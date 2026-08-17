import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const RELEASE = "2026.08.17-v60";
const PUBLIC_DOCUMENT = readFileSync(new URL("../public/platform-v5.html", import.meta.url), "utf8");
const V60_DOCUMENT = gunzipSync(
  readFileSync(new URL("../public/platform-v60.html.gz", import.meta.url))
).toString("utf8");
const V60_SCRIPT_GZIP = readFileSync(new URL("../public/platform-v60.js.gz", import.meta.url));
const V60_SCRIPT = gunzipSync(V60_SCRIPT_GZIP);

const STOREFRONT_STYLES = [`/assets/store-desktop-responsive.css?v=${RELEASE}`];

const V60_DOCUMENT_PATHS = new Set([
  "/",
  "/login",
  "/register",
  "/services",
  "/payment-methods",
  "/add-balance",
  "/orders",
  "/wallet",
  "/account",
  "/create-store",
  "/builder",
  "/pricing",
  "/domain",
  "/support",
  "/contact",
  "/notifications",
  "/about"
]);

const V60_EXTRA_ROUTES = [
  "/register",
  "/add-balance",
  "/orders",
  "/wallet",
  "/builder",
  "/pricing",
  "/domain",
  "/notifications",
  "/about"
];

const V60_ALIASES = new Map([
  ["/index.html", "/"],
  ["/login.html", "/login"],
  ["/register.html", "/register"],
  ["/services.html", "/services"],
  ["/payment-methods.html", "/payment-methods"],
  ["/support.html", "/support"],
  ["/contact.html", "/contact"],
  ["/about.html", "/about"]
]);

const LEGACY_PUBLIC_ROUTES = [
  "/showcase.html",
  "/api-services",
  "/api-services.html",
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
  for (const source of assets.styles || []) {
    if (output.includes(source)) continue;
    output = output.replace(/<\/head>/i, `<link rel="stylesheet" href="${source}"></head>`);
  }
  for (const source of assets.scripts || []) {
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

function documentResponse(reply, document) {
  reply.removeHeader("content-length");
  reply.header("content-type", "text/html; charset=utf-8");
  reply.header("cache-control", "no-store, max-age=0");
  reply.header("pragma", "no-cache");
  reply.header("expires", "0");
  reply.header("x-uchiha-ui-release", "v60");
  return document;
}

function responseHtml(payload) {
  if (Buffer.isBuffer(payload)) return payload.toString("utf8");
  if (typeof payload === "string") return payload;
  return null;
}

function registerV60Routes(app) {
  const handler = async (_request, reply) => documentResponse(reply, V60_DOCUMENT);
  for (const path of V60_EXTRA_ROUTES) app.get(path, handler);
  for (const [alias, canonical] of V60_ALIASES) {
    app.get(alias, async (_request, reply) => reply.redirect(canonical));
  }

  app.get("/platform-v60.js", async (request, reply) => {
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
  });
}

function registerLegacyPublicRoutes(app) {
  const legacyHandler = async (_request, reply) => documentResponse(reply, PUBLIC_DOCUMENT);
  app.get("/category/:categorySlug", legacyHandler);
  app.get("/category/:categorySlug/:subcategorySlug", legacyHandler);
  app.get("/product/:productSlug", legacyHandler);
  app.get("/add-balance/:methodKey", async (_request, reply) => reply.redirect("/add-balance"));
  for (const path of LEGACY_PUBLIC_ROUTES) app.get(path, legacyHandler);
}

export function installLaunchAssetInjection(app) {
  registerV60Routes(app);
  registerLegacyPublicRoutes(app);

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method !== "GET") return payload;
    const pathname = pagePath(request);

    if (V60_DOCUMENT_PATHS.has(pathname)) {
      return documentResponse(reply, V60_DOCUMENT);
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
