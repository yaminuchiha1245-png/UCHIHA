import { readFileSync } from "node:fs";

const RELEASE = "2026.08.05.1";
const ACCOUNT_DOCUMENT = readFileSync(new URL("../public/account-unified.html", import.meta.url), "utf8");
const PUBLIC_DOCUMENT = readFileSync(new URL("../public/platform-v5.html", import.meta.url), "utf8");
const PLATFORM_STYLES = [`/assets/platform-v5.css?v=${RELEASE}`];
const PLATFORM_SCRIPTS = [`/assets/platform-v5.js?v=${RELEASE}`];

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

function documentResponse(reply, document) {
  reply.removeHeader("content-length");
  reply.header("content-type", "text/html; charset=utf-8");
  reply.header("cache-control", "no-cache, max-age=0, must-revalidate");
  return document;
}

function registerPlatformRoutes(app) {
  const handler = async (_request, reply) => documentResponse(reply, PUBLIC_DOCUMENT);
  app.get("/category/:categorySlug", handler);
  app.get("/category/:categorySlug/:subcategorySlug", handler);
  app.get("/product/:productSlug", handler);
  app.get("/add-balance", handler);
  app.get("/add-balance/:methodKey", handler);
  app.get("/orders", handler);
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
          styles: PLATFORM_STYLES,
          scripts: PLATFORM_SCRIPTS
        })
      );
    }

    if (PUBLIC_DOCUMENT_PATHS.has(pathname)) {
      return documentResponse(reply, PUBLIC_DOCUMENT);
    }

    if (pathname === "/create-store") {
      const html = Buffer.isBuffer(payload)
        ? payload.toString("utf8")
        : typeof payload === "string"
          ? payload
          : null;
      if (!html || !/<\/body>/i.test(html)) return payload;
      return documentResponse(
        reply,
        injectAssets(html, {
          styles: [...PLATFORM_STYLES, `/assets/platform-unified-compat.css?v=${RELEASE}`],
          scripts: [
            `/assets/platform-v5-builder.js?v=${RELEASE}`,
            `/assets/launch-builder-sales.js?v=${RELEASE}`
          ]
        })
      );
    }

    if (pathname === "/platform-admin") {
      const html = Buffer.isBuffer(payload)
        ? payload.toString("utf8")
        : typeof payload === "string"
          ? payload
          : null;
      if (!html || !/<\/body>/i.test(html)) return payload;
      return documentResponse(
        reply,
        injectAssets(html, {
          styles: [],
          scripts: [`/assets/launch-admin-sales.js?v=${RELEASE}`]
        })
      );
    }

    return payload;
  });
}
