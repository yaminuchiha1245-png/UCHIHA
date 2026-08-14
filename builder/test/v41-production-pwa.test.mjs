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

test("v41 production bridge registers the current service worker without cache reuse", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /const RELEASE = "2026\.08\.14\.3"/);
  assert.match(source, /navigator\.serviceWorker/);
  assert.match(source, /\.register\(`\/sw\.js\?v=\$\{RELEASE\}`/);
  assert.match(source, /updateViaCache: "none"/);
  assert.match(source, /scope: "\/"/);
});

test("production root injects the trusted adapter inside the private v41 runtime", () => {
  const html = productionV41Document();
  const runtimeIndex = html.indexOf("window.__UCHIHA_V41_RUNTIME__");
  const iifeCloseIndex = html.lastIndexOf("})();");
  assert.ok(runtimeIndex > 0, "production runtime adapter must be injected");
  assert.ok(iifeCloseIndex > runtimeIndex, "adapter must remain inside the original v41 IIFE");
  assert.match(html, /persistDemoState=function\(\)\{\}/);
  assert.match(html, /chatUnreadCount=function\(\)\{return 0\}/);
  assert.match(html, /CONFIG\.demoAdminMode=false/);
  assert.match(html, /state\.orders=\[\]/);
  assert.match(html, /state\.notifications=\[\]/);
  assert.match(html, /DEMO_USER\.balance=0/);
  assert.match(html, /v41ProductionReset\(\);\n\nrender\(\);\nhideBootLoader\(\);/);
});

test("external bridge uses only the narrow v41 runtime API and fails closed", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /const runtime = window\.__UCHIHA_V41_RUNTIME__/);
  assert.match(source, /runtime\.release !== RELEASE/);
  assert.match(source, /runtime\.setGuest\(\)/);
  assert.match(source, /runtime\.setAccount\(account, orders\)/);
  assert.match(source, /window\.location\.replace\("\/services"\)/);
  assert.doesNotMatch(source, /window\.(?:state|DEMO_USER|CONFIG|money)/);
});

test("v41 production bridge hydrates account identity from authenticated production APIs", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /fetch\("\/api\/platform\/account"/);
  assert.match(source, /fetch\("\/api\/platform\/orders"/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /return applyProductionAccount\(accountPayload\?\.account, orders\) \? "account" : "error"/);
  assert.match(source, /clearLegacyDemoStorage\(\);\n    return applied/);
});

test("v41 root does not flash a fake guest state before account resolution", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /accountResponse\.status === 401 \|\| accountResponse\.status === 403\) return "guest"/);
  assert.match(source, /if \(!accountResponse\.ok\) return "error"/);
  assert.match(source, /function revealResolvedAccountState\(status\)/);
  assert.match(source, /if \(status === "error"\)[\s\S]*window\.location\.replace\("\/account"\)/);
  assert.match(source, /hydrateProductionAccount\(\)\.then\(revealResolvedAccountState\)/);
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
  assert.match(source, /fetch\("\/api\/public\/portal"/);
  assert.match(source, /if \(contact\?\.status !== "active"\) continue/);
  assert.match(source, /productionContacts\.set\(type, url\)/);
  assert.match(source, /if \(action === "quick-whatsapp" \|\| action === "open-social"\)/);
  assert.match(source, /openProductionContact\(type\)/);
  assert.match(source, /navigate\("\/support"\)/);
  assert.match(source, /contactsEndpoint: "\/api\/public\/portal"/);
});

test("v41 shell routes archived demo commerce into live platform flows", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /bots: "\/category\/telegram-bots"/);
  assert.match(source, /apps: "\/category\/mobile-apps"/);
  assert.match(source, /websites: "\/category\/websites"/);
  assert.match(source, /stores: "\/create-store"/);
  assert.match(source, /domains: "\/category\/hosting-domains\/domains"/);
  assert.match(source, /hosting: "\/category\/hosting-domains"/);
  assert.match(source, /about: "\/about"/);
  assert.match(source, /if \(action === "category"\) return CATEGORY_ROUTES\[id\] \|\| "\/services"/);
  assert.match(source, /if \(action === "service"\) return "\/services"/);
  assert.match(source, /search: "\/services"/);
  assert.match(source, /all: "\/services"/);
  assert.match(source, /if \(action === "logout"\)/);
  assert.match(source, /"\.cat>i\{display:none!important\}"/);
});
