import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

test("v41 production bridge sanitizes demo state only after the legacy runtime exists", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /clearLegacyDemoStorage\(\);/);
  assert.match(source, /document\.addEventListener\("DOMContentLoaded", initializeProductionShell/);
  assert.match(source, /window\.state\.orders = \[\]/);
  assert.match(source, /window\.state\.notifications = \[\]/);
  assert.match(source, /window\.DEMO_USER\.balance = 0/);
  assert.match(source, /window\.CONFIG\.demoAdminMode = false/);
});

test("v41 production bridge hydrates account identity from authenticated production APIs", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /fetch\("\/api\/platform\/account"/);
  assert.match(source, /fetch\("\/api\/platform\/orders"/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /window\.state\.loggedIn = true/);
  assert.match(source, /window\.DEMO_USER\.balance = Math\.max\(0, Number\(wallet\.availableMinor \|\| 0\)\) \/ 100/);
});

test("v41 production bridge never exposes the archived demo catalog as the live catalog", async () => {
  const source = await readFile(bridgeUrl, "utf8");
  assert.match(source, /bots: "\/category\/telegram-bots"/);
  assert.match(source, /apps: "\/category\/mobile-apps"/);
  assert.match(source, /websites: "\/category\/websites"/);
  assert.match(source, /stores: "\/create-store"/);
  assert.match(source, /domains: "\/category\/hosting-domains\/domains"/);
  assert.match(source, /hosting: "\/category\/hosting-domains"/);
  assert.match(source, /if \(action === "category"\) return CATEGORY_ROUTES\[id\] \|\| "\/services"/);
  assert.match(source, /if \(action === "service"\) return "\/services"/);
  assert.match(source, /search: "\/services"/);
  assert.match(source, /all: "\/services"/);
});
