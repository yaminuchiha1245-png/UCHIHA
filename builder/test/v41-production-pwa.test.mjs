import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { productionV41Document } from "../src/launch-assets.mjs";

const bridgeUrl = new URL("../public/v41-production-bridge.js", import.meta.url);

test("v41 production bridge attaches the production manifest before install flows", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /function installManifestLink\(\)/);
  assert.match(source, /link\.rel = "manifest"/);
  assert.match(source, /link\.href = "\/assets\/manifest\.webmanifest"/);
  assert.match(source, /installManifestLink\(\)/);
});

test("v41 production bridge registers release 2026.08.14.4 without cache reuse", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /const ASSET_RELEASE = "2026\.08\.14\.4"/);
  assert.match(source, /navigator\.serviceWorker/);
  assert.match(source, /\.register\(`\/sw\.js\?v=\$\{ASSET_RELEASE\}`/);
  assert.match(source, /updateViaCache: "none"/);
  assert.match(source, /scope: "\/"/);
});

test("production root injects the trusted synchronized adapter inside the private v41 runtime", () => {
  const html = productionV41Document();
  const runtimeIndex = html.indexOf("window.__UCHIHA_V41_RUNTIME__");
  const iifeCloseIndex = html.lastIndexOf("})();");
  assert.ok(runtimeIndex > 0, "production runtime adapter must be injected");
  assert.ok(iifeCloseIndex > runtimeIndex, "adapter must remain inside the original v41 IIFE");
  assert.match(html, /persistDemoState=function\(\)\{\}/);
  assert.match(html, /chatUnreadCount=function\(\)\{return 0\}/);
  assert.match(html, /CONFIG\.demoAdminMode=false/);
  assert.match(html, /services\.splice\(0,services\.length\)/);
  assert.match(html, /paymentMethods\.splice\(0,paymentMethods\.length\)/);
  assert.match(html, /syncAccount:v41ProductionSetAccount/);
  assert.match(html, /syncPortal:v41ProductionSyncPortal/);
  assert.match(html, /v41ProductionResetSession\(true\)/);
  assert.match(html, /v41ProductionResetCatalog\(\)/);
});

test("external bridge uses only the narrow v41 runtime API and fails closed", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /const runtime = window\.__UCHIHA_V41_RUNTIME__/);
  assert.match(source, /COMPATIBLE_RUNTIME_RELEASES\.has/);
  assert.match(source, /runtime\.setGuest\(\)/);
  assert.match(source, /runtime\.syncPortal/);
  assert.match(source, /runtime\.syncAccount/);
  assert.match(source, /window\.location\.replace\("\/services"\)/);
  assert.doesNotMatch(source, /window\.(?:state|DEMO_USER|CONFIG|money)/);
});

test("v41 production bridge hydrates account identity from authenticated production APIs", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /fetch\("\/api\/platform\/account"/);
  assert.match(source, /fetch\("\/api\/platform\/orders"/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /applyProductionAccount\(accountPayload\?\.account, orders\)/);
  assert.match(source, /typeof runtime\.syncAccount === "function"/);
  assert.match(source, /clearLegacyDemoStorage\(\)/);
});

test("v41 portal snapshot replaces demo services and payment methods", async () => {
  const html = productionV41Document();
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /fetch\("\/api\/public\/portal"/);
  assert.match(source, /runtime\.syncPortal\(portal\)/);
  assert.match(html, /portal\.services/);
  assert.match(html, /portal\.paymentMethods/);
  assert.match(html, /startingPriceMinor/);
  assert.match(html, /accountIdentifier/);
  assert.match(html, /minimumAmountMinor/);
  assert.match(html, /maximumAmountMinor/);
  assert.match(html, /ensureCatalogOrder\(\)/);
  assert.match(html, /ensurePaymentOrder\(\)/);
});

test("v41 production data refreshes while the app is active", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /const SYNC_INTERVAL_MS = 60000/);
  assert.match(source, /window\.setInterval/);
  assert.match(source, /document\.visibilityState === "visible"/);
  assert.match(source, /window\.addEventListener\("focus"/);
  assert.match(source, /document\.addEventListener\("visibilitychange"/);
  assert.match(source, /refreshProductionState\(\)/);
});

test("v41 keeps production-backed browsing inside the approved interface", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /function canBrowseInsideV41\(action, page\)/);
  assert.match(source, /action === "category" \|\| action === "service"/);
  assert.match(source, /\["all", "search", "payments"\]/);
  assert.match(source, /\["account", "orders", "order-detail", "notifications"\]/);
  assert.match(source, /if \(canBrowseInsideV41\(action, page\)\) return/);
});

test("v41 root does not expose account fragments before account resolution", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /accountResponse\.status === 401 \|\| accountResponse\.status === 403/);
  assert.match(source, /if \(!accountResponse\.ok\) return "error"/);
  assert.match(source, /function revealResolvedAccountState\(status\)/);
  assert.match(source, /if \(status === "error"\)[\s\S]*window\.location\.replace\("\/account"\)/);
  assert.match(source, /hydrateProductionAccount\(\{ initial: true \}\)\.then\(revealResolvedAccountState\)/);
  assert.match(source, /data-v41-production-pending/);
  assert.match(source, /\.headerLogin\{visibility:hidden!important\}/);
});

test("v41 shell performs server-authoritative logout instead of a fake local logout", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /fetch\("\/api\/me"/);
  assert.match(source, /window\.sessionStorage\.getItem\("uchihaBuilderCsrf"\)/);
  assert.match(source, /fetch\("\/api\/auth\/logout"/);
  assert.match(source, /headers\["x-csrf-token"\] = token/);
  assert.match(source, /loggedOut = response\.ok \|\| response\.status === 401/);
  assert.match(source, /window\.location\.assign\("\/login"\)/);
  assert.match(source, /window\.location\.assign\("\/account"\)/);
});

test("v41 social buttons use configured live portal contacts or production support", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /if \(contact\?\.status !== "active"\) continue/);
  assert.match(source, /productionContacts\.set\(type, url\)/);
  assert.match(source, /if \(action === "quick-whatsapp" \|\| action === "open-social"\)/);
  assert.match(source, /openProductionContact\(type\)/);
  assert.match(source, /navigate\("\/support"\)/);
  assert.match(source, /portalEndpoint: "\/api\/public\/portal"/);
});

test("unsafe or unfinished commerce actions still leave the shell for live server flows", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /"confirm-review": "\/services"/);
  assert.match(source, /"retry-payment": "\/orders"/);
  assert.match(source, /"accept-quote": "\/orders"/);
  assert.match(source, /stores: "\/create-store"/);
  assert.match(source, /if \(action === "request"\) return "\/services"/);
  assert.match(source, /if \(action === "logout"\)/);
  assert.match(source, /"\.cat>i\{display:none!important\}"/);
});
