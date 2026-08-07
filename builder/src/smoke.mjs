import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 15_000;
const SERVICE_WORKER_RELEASE = "2026.08.07.6";
const PUBLIC_HTML_PATHS = [
  "/create-store",
  "/login",
  "/account",
  "/services",
  "/payment-methods",
  "/contact",
  "/uchiha-api",
  "/platform-admin",
  "/showcase",
  "/store/demo"
];

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("SMOKE_BASE_URL is required");
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol)) throw new Error("SMOKE_BASE_URL must use HTTP or HTTPS");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function safeJson(text, path) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} did not return valid JSON`);
  }
}

function assertNoSensitiveKeys(value, path = "response") {
  const forbidden = /(?:database.?url|password|secret|token.?cipher|credentials|encryption.?key)/i;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.test(key)) throw new Error(`${path} exposed forbidden key: ${key}`);
    assertNoSensitiveKeys(item, `${path}.${key}`);
  }
}

async function request(fetchImpl, baseUrl, path, { timeoutMs, accept = "*/*" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      redirect: "follow",
      cache: "no-store",
      headers: { accept, "user-agent": "UCHIHA-Production-Smoke/2.0" },
      signal: controller.signal
    });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${path} timed out`);
    throw new Error(`${path} request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function securityHeaderChecks(response) {
  const expected = [
    ["x-content-type-options", "nosniff"],
    ["x-frame-options", "DENY"],
    ["referrer-policy", "strict-origin-when-cross-origin"]
  ];
  for (const [name, value] of expected) {
    if (response.headers.get(name) !== value) throw new Error(`Missing or invalid security header: ${name}`);
  }
  const csp = response.headers.get("content-security-policy") || "";
  if (!csp.includes("default-src 'self'")) throw new Error("Content-Security-Policy is missing");
}

export async function runSmoke({
  baseUrl,
  fetchImpl = globalThis.fetch,
  allowDegraded = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  checkPublicRoutes = false,
  checkDemo = false
}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const checks = [];
  const pass = (name, details = {}) => checks.push({ name, ok: true, ...details });

  const root = await request(fetchImpl, normalizedBaseUrl, "/", { timeoutMs, accept: "text/html" });
  if (root.response.status !== 200) throw new Error(`/ returned HTTP ${root.response.status}`);
  if (!root.response.headers.get("content-type")?.includes("text/html")) throw new Error("/ did not return HTML");
  if (!/<html[\s>]/i.test(root.text)) throw new Error("/ returned an invalid HTML document");
  securityHeaderChecks(root.response);
  pass("homepage", { status: root.response.status });
  pass("security_headers");

  if (checkPublicRoutes) {
    for (const path of PUBLIC_HTML_PATHS) {
      const page = await request(fetchImpl, normalizedBaseUrl, path, { timeoutMs, accept: "text/html" });
      if (page.response.status === 404) throw new Error(`${path} returned HTTP 404`);
      if (page.response.status < 200 || page.response.status >= 400) throw new Error(`${path} returned HTTP ${page.response.status}`);
      if (!page.response.headers.get("content-type")?.includes("text/html") || !/<html[\s>]/i.test(page.text)) {
        throw new Error(`${path} did not return a valid HTML document`);
      }
    }
    pass("public_routes", { count: PUBLIC_HTML_PATHS.length });
  }

  const healthResponse = await request(fetchImpl, normalizedBaseUrl, "/health", { timeoutMs, accept: "application/json" });
  if (healthResponse.response.status !== 200) throw new Error(`/health returned HTTP ${healthResponse.response.status}`);
  const health = safeJson(healthResponse.text, "/health");
  assertNoSensitiveKeys(health, "/health");
  if (health.status !== "ok" || health.service !== "uchiha-builder") throw new Error("/health returned an unexpected payload");
  pass("health", { database: health.database });

  const readyResponse = await request(fetchImpl, normalizedBaseUrl, "/ready", { timeoutMs, accept: "application/json" });
  const readiness = safeJson(readyResponse.text, "/ready");
  assertNoSensitiveKeys(readiness, "/ready");
  const persistent = readyResponse.response.status === 200 && readiness.persistent === true;
  const previewReady = readyResponse.response.status === 200 && readiness.persistent === false && readiness.preview === true && readiness.status === "demo-ready";
  if (!persistent && !previewReady && !allowDegraded) {
    throw new Error(`/ready is degraded (${readyResponse.response.status}, ${readiness.database || "unknown database"})`);
  }
  if (!persistent && !previewReady && readyResponse.response.status !== 503) {
    throw new Error(`/ready returned unexpected HTTP ${readyResponse.response.status}`);
  }
  pass("readiness", {
    persistent,
    preview: previewReady,
    status: readyResponse.response.status,
    database: readiness.database,
    migrationCount: Number(readiness.migrationCount || 0)
  });

  const configResponse = await request(fetchImpl, normalizedBaseUrl, "/api/public/config", { timeoutMs, accept: "application/json" });
  if (configResponse.response.status !== 200) throw new Error(`/api/public/config returned HTTP ${configResponse.response.status}`);
  const publicConfig = safeJson(configResponse.text, "/api/public/config");
  assertNoSensitiveKeys(publicConfig, "/api/public/config");
  if (!Array.isArray(publicConfig.templates) || publicConfig.templates.length < 3) {
    throw new Error("Public configuration does not expose the three required templates");
  }
  pass("public_config", { templateCount: publicConfig.templates.length });

  if (checkDemo) {
    const demoCatalogPath = "/api/storefront/demo?catalogOnly=1&limit=1&offset=0";
    const demoCatalog = await request(fetchImpl, normalizedBaseUrl, demoCatalogPath, {
      timeoutMs,
      accept: "application/json"
    });
    if (demoCatalog.response.status !== 200) throw new Error(`${demoCatalogPath} returned HTTP ${demoCatalog.response.status}`);
    const demo = safeJson(demoCatalog.text, demoCatalogPath);
    assertNoSensitiveKeys(demo, demoCatalogPath);
    if (demo.store?.slug !== "demo") throw new Error("Demo catalog did not resolve the demo store");
    pass("demo_catalog");

    const demoLinkScript = await request(fetchImpl, normalizedBaseUrl, "/assets/preview-banner.js", {
      timeoutMs,
      accept: "application/javascript"
    });
    if (demoLinkScript.response.status !== 200 || !demoLinkScript.text.includes("/store/demo")) {
      throw new Error("Demo button script does not point to /store/demo");
    }
    pass("demo_button");

    const serviceWorker = await request(fetchImpl, normalizedBaseUrl, "/sw.js", {
      timeoutMs,
      accept: "application/javascript"
    });
    if (serviceWorker.response.status !== 200 || !serviceWorker.text.includes(SERVICE_WORKER_RELEASE)) {
      throw new Error("Service worker release version is not current");
    }
    if (!serviceWorker.text.includes('cache: "no-store"') || !serviceWorker.text.includes('key.startsWith("uchiha-")')) {
      throw new Error("Service worker does not enforce network-first freshness and old-cache deletion");
    }
    pass("service_worker_release", { release: SERVICE_WORKER_RELEASE });
  }

  return {
    ok: true,
    baseUrl: normalizedBaseUrl,
    persistent,
    checks,
    completedAt: new Date().toISOString()
  };
}

async function main() {
  try {
    const result = await runSmoke({
      baseUrl: process.env.SMOKE_BASE_URL,
      allowDegraded: ["1", "true", "yes", "on"].includes(String(process.env.SMOKE_ALLOW_DEGRADED || "").toLowerCase()),
      timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
      checkPublicRoutes: true,
      checkDemo: true
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  }
}

const executedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (executedFile === fileURLToPath(import.meta.url)) await main();