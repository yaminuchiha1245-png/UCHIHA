import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "../../..");
const lockedReferenceHash = "bdfea1a81d3a82e96330d1a287bc1120046c53af59eca68bb1a3afd452756237";
const forbiddenHosts = ["chatgpt.site", "railway.app", "radius.example.com"];

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("V1-83 reference remains byte-for-byte locked", () => {
  const reference = path.join(projectRoot, "reference/UCHIHA-RADIUS-UI-V1-83.html");
  assert.equal(sha256(reference), lockedReferenceHash);
});

test("provider release build embeds the V1-83 runtime without forbidden hosts", () => {
  execFileSync(process.execPath, ["scripts/build-provider-v183.mjs", "server"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "pipe"
  });
  const outputRoot = path.join(projectRoot, "dist/provider");
  const html = fs.readFileSync(path.join(outputRoot, "index.html"), "utf8");
  assert.match(html, /<meta name="uchiha-runtime" content="web">/);
  assert.match(html, /<script src="\/provider\/assets\/provider-v183-[a-f0-9]+\.js" defer><\/script>/);
  assert.doesNotMatch(html, /<script>([\s\S]*?)<\/script>/);
  const asset = fs.readdirSync(path.join(outputRoot, "assets")).find((name) => /^provider-v183-[a-f0-9]+\.js$/.test(name));
  assert.ok(asset);
  const runtime = fs.readFileSync(path.join(outputRoot, "assets", asset), "utf8");
  assert.match(runtime, /setupUchihaV183Runtime/);
  assert.match(runtime, /\/subscriptions\/redeem/);
  assert.match(runtime, /if\(!state\.meta\)return;/, "offline entry must fall through to V1-83's local preview handler");
  assert.match(runtime, /querySelector\('\.google-label'\)\?\.remove\(\)/, "duplicate Google label must be removed at runtime");
  for (const host of forbiddenHosts) {
    assert.equal(`${html}\n${runtime}`.toLowerCase().includes(host), false, `forbidden runtime host: ${host}`);
  }
});
