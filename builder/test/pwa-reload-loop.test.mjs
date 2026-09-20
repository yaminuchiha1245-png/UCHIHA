import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function releaseVersion(source) {
  return source.match(/const RELEASE_VERSION = "([^"]+)"/)?.[1] || "";
}

test("PWA has a single service-worker owner and never reloads on controller changes", async () => {
  const [pwa, recovery, worker] = await Promise.all([
    readFile(new URL("../public/pwa.js", import.meta.url), "utf8"),
    readFile(new URL("../public/runtime-recovery.js", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8")
  ]);

  assert.match(pwa, /navigator\.serviceWorker\s*\.register\(/);
  assert.doesNotMatch(recovery, /navigator\.serviceWorker\s*\.register\(/);
  assert.doesNotMatch(pwa, /controllerchange[\s\S]{0,500}location\.reload\(/);
  assert.doesNotMatch(pwa, /registration\.update\(\)/);

  const pwaRelease = releaseVersion(pwa);
  assert.ok(pwaRelease, "pwa.js must declare RELEASE_VERSION");
  assert.equal(releaseVersion(worker), pwaRelease, "sw.js and pwa.js must use the same release");
  assert.equal(releaseVersion(recovery), pwaRelease, "runtime recovery cache marker must match the PWA release");
});
