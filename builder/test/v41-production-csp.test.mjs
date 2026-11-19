import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { installV41ProductionCsp, V41_PRODUCTION_SCRIPT_HASH } from "../src/v41-production-csp.mjs";

test("retired v41 CSP compatibility module cannot mutate production responses", () => {
  let hookRegistrations = 0;
  const app = {
    addHook() {
      hookRegistrations += 1;
    }
  };

  assert.equal(V41_PRODUCTION_SCRIPT_HASH, null);
  assert.equal(installV41ProductionCsp(app), app);
  assert.equal(hookRegistrations, 0);
});

test("production startup no longer imports or installs the v41 CSP hook", async () => {
  const source = await readFile(new URL("../src/start.mjs", import.meta.url), "utf8");
  const assets = source.indexOf("installLaunchAssetInjection(app);");
  const hardening = source.indexOf("installHttpHardening(app, config);");
  const listen = source.indexOf("await app.listen(");

  assert.doesNotMatch(source, /v41-production-csp/);
  assert.doesNotMatch(source, /installV41ProductionCsp/);
  assert.ok(assets > 0 && hardening > assets && listen > hardening);
});

test("general production CSP remains installed independently of v41", async () => {
  const source = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
  assert.match(source, /"content-security-policy"/);
  assert.match(source, /default-src 'self'/);
  assert.match(source, /script-src 'self'/);
  assert.match(source, /connect-src 'self'/);
});
