import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const runtime = fs.readFileSync(path.join(root, "apps/provider-v183-runtime/runtime.js"), "utf8");

test("native MikroTik wizard offers API-SSL 8729 only", () => {
  assert.match(runtime, /<option value="api-ssl">RouterOS API-SSL · 8729<\/option>/);
  assert.doesNotMatch(runtime, /<option value="api">RouterOS API · 8728<\/option>/);
});

test("native discovery exposes only API-SSL routers", () => {
  assert.match(runtime, /\.filter\(item=>item\.apiSsl===true\)/);
  assert.match(runtime, /data-router-tls="true"/);
  assert.match(runtime, /API-SSL · 8729/);
});

test("native pairing rejects plaintext RouterOS and stores port 8729 only", () => {
  assert.match(runtime, /if\(!tls\)throw Error/);
  assert.match(runtime, /if\(router\.tls!==true\)throw Error/);
  assert.match(runtime, /requestRouterCredentials\(\{host,tls:true\}\)/);
  assert.match(runtime, /apiPort:8729,connectionMethod:'api'/);
  assert.doesNotMatch(runtime, /apiPort:router\.tls\?8729:8728/);
});
