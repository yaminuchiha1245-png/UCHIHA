import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const assetsUrl = new URL("../src/launch-assets.mjs", import.meta.url);
const accountRenewalsUrl = new URL("../public/account-renewals.js", import.meta.url);

test("launch assets preserve exact v41 root while wiring renewal UI only to account and admin", async () => {
  const source = await readFile(assetsUrl, "utf8");
  assert.match(source, /const V41_DOCUMENT = readFileSync\(new URL\("\.\.\/public\/index\.html"/);
  assert.match(source, /pathname === "\/" \|\| pathname === "\/index\.html"[\s\S]*V41_DOCUMENT/);
  assert.match(source, /account-renewals\.css/);
  assert.match(source, /account-renewals\.js/);
  assert.match(source, /launch-admin-renewals\.js/);
  const rootBlock = source.match(/if \(pathname === "\/" \|\| pathname === "\/index\.html"\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.doesNotMatch(rootBlock, /renewal/i, "renewal assets must not alter the approved v41 root document");
});

test("renewal customer UI derives minor-unit factor from the selected currency", async () => {
  const source = await readFile(accountRenewalsUrl, "utf8");
  assert.match(source, /resolvedOptions\(\)\.maximumFractionDigits/);
  assert.match(source, /factor:\s*10 \*\* digits/);
  assert.match(source, /Number\(minor \|\| 0\) \/ factor/);
  assert.doesNotMatch(source, /Number\(minor \|\| 0\) \/ 100/);
});
