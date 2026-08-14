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
