import { createHash } from "node:crypto";
import { productionV41Document } from "./launch-assets.mjs";

const V41_DOCUMENT_PATHS = new Set([
  "/",
  "/index.html",
  "/services",
  "/services.html",
  "/payment-methods",
  "/payment-methods.html",
  "/orders",
  "/about",
  "/about.html",
  "/showcase",
  "/showcase.html"
]);

function pathOnly(request) {
  return String(request.raw?.url || request.url || "").split("?")[0].replace(/\/+$/, "") || "/";
}

function isV41Document(pathname) {
  return (
    V41_DOCUMENT_PATHS.has(pathname) ||
    /^\/category\/[^/]+(?:\/[^/]+)?$/.test(pathname) ||
    /^\/product\/[^/]+$/.test(pathname)
  );
}

function inlineRuntime(document) {
  const scripts = [...String(document).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((source) => source.length > 0);
  if (scripts.length !== 1) {
    throw new Error(`Expected one inline v41 runtime, found ${scripts.length}`);
  }
  return scripts[0];
}

export const V41_PRODUCTION_SCRIPT_HASH = `sha256-${createHash("sha256")
  .update(inlineRuntime(productionV41Document()))
  .digest("base64")}`;

export function installV41ProductionCsp(app) {
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method !== "GET") return payload;
    const pathname = pathOnly(request);
    if (!isV41Document(pathname)) return payload;

    const current = String(reply.getHeader?.("content-security-policy") || "");
    if (!current || current.includes(V41_PRODUCTION_SCRIPT_HASH)) return payload;

    const next = current.replace(
      /script-src\s+([^;]+)/,
      (_match, sources) => `script-src ${sources.trim()} '${V41_PRODUCTION_SCRIPT_HASH}'`
    );
    if (next === current) {
      throw new Error("UCHIHA v41 CSP is missing a script-src directive");
    }
    reply.header("content-security-policy", next);
    return payload;
  });
}
