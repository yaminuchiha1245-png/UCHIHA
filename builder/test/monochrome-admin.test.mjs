import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("owner dashboard monochrome layer neutralizes legacy decorative red while preserving semantic states", async () => {
  const mono = await read("public/monochrome-v1.css");

  assert.match(mono, /body\[data-page="admin"\] \.eyebrow\s*\{[\s\S]*color:\s*#ffffff\s*!important/);
  assert.match(mono, /\.reference-admin-demo::before\s*\{[\s\S]*background:\s*#ffffff\s*!important/);
  assert.match(mono, /\.product-media-library button\.active\s*\{[\s\S]*border-color:\s*#ffffff\s*!important/);
  assert.match(mono, /body\[data-page="admin"\] input:focus,[\s\S]*box-shadow:\s*0 0 0 3px rgba\(255, 255, 255, 0\.08\)/);
  assert.match(mono, /\.status-badge\s*\{[\s\S]*background:\s*#1a1a1a\s*!important/);
  assert.match(mono, /\.status-badge\.active\s*\{[\s\S]*rgba\(47, 173, 104, 0\.12\)/);
  assert.doesNotMatch(mono, /#(?:8f3044|4f1825|d74768|ff6078)/i);
});
