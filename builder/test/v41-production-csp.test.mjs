import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { productionV41Document } from "../src/launch-assets.mjs";
import { installV41ProductionCsp, V41_PRODUCTION_SCRIPT_HASH } from "../src/v41-production-csp.mjs";

function inlineRuntime(document) {
  const scripts = [...String(document).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((source) => source.length > 0);
  assert.equal(scripts.length, 1);
  return scripts[0];
}

function hash(source) {
  return `sha256-${createHash("sha256").update(source).digest("base64")}`;
}

test("production CSP hash exactly matches the injected synchronized v41 runtime", async () => {
  const staticHtml = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const staticHash = hash(inlineRuntime(staticHtml));
  const productionHash = hash(inlineRuntime(productionV41Document()));

  assert.equal(V41_PRODUCTION_SCRIPT_HASH, productionHash);
  assert.notEqual(productionHash, staticHash, "the injected production adapter changes the inline runtime and needs its own CSP hash");
});

test("v41 CSP hook adds only the production hash on v41 document routes", async () => {
  let hook;
  const app = {
    addHook(name, handler) {
      assert.equal(name, "onSend");
      hook = handler;
    }
  };
  installV41ProductionCsp(app);
  assert.equal(typeof hook, "function");

  const base = "default-src 'self'; script-src 'self' 'sha256-static'; connect-src 'self'";
  let current = base;
  const reply = {
    getHeader(name) {
      return name === "content-security-policy" ? current : undefined;
    },
    header(name, value) {
      if (name === "content-security-policy") current = value;
      return this;
    }
  };

  await hook({ method: "GET", raw: { url: "/services" } }, reply, "payload");
  assert.match(current, /'sha256-static'/);
  assert.equal(current.includes(`'${V41_PRODUCTION_SCRIPT_HASH}'`), true);
  assert.equal(current.includes("unsafe-inline"), false);

  current = base;
  await hook({ method: "GET", raw: { url: "/category/telegram-bots" } }, reply, "payload");
  assert.equal(current.includes(`'${V41_PRODUCTION_SCRIPT_HASH}'`), true);

  current = base;
  await hook({ method: "GET", raw: { url: "/login" } }, reply, "payload");
  assert.equal(current, base);
});

test("start lifecycle installs the production CSP hook after v41 asset injection and before listen", async () => {
  const source = await readFile(new URL("../src/start.mjs", import.meta.url), "utf8");
  const assets = source.indexOf("installLaunchAssetInjection(app);");
  const csp = source.indexOf("installV41ProductionCsp(app);");
  const hardening = source.indexOf("installHttpHardening(app, config);");
  const listen = source.indexOf("await app.listen(");
  assert.ok(assets > 0 && csp > assets && hardening > csp && listen > hardening);
});
