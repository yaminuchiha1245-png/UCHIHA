import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const assetsUrl = new URL("../src/launch-assets.mjs", import.meta.url);
const accountRenewalsUrl = new URL("../public/account-renewals.js", import.meta.url);
const responsiveUrl = new URL("../public/v41-responsive.css", import.meta.url);

test("launch assets preserve v41 runtime while wiring responsive root and renewal UI", async () => {
  const source = await readFile(assetsUrl, "utf8");
  assert.match(source, /const V41_DOCUMENT = readFileSync\(new URL\("\.\.\/public\/index\.html"/);
  assert.match(source, /const V41_STYLES = \[`\/assets\/v41-responsive\.css\?v=\$\{RELEASE\}`\]/);
  assert.match(source, /pathname === "\/" \|\| pathname === "\/index\.html"[\s\S]*injectAssets\(V41_DOCUMENT/);
  assert.match(source, /account-renewals\.css/);
  assert.match(source, /account-renewals\.js/);
  assert.match(source, /launch-admin-renewals\.js/);
  const rootBlock = source.match(/if \(pathname === "\/" \|\| pathname === "\/index\.html"\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.doesNotMatch(rootBlock, /renewal/i, "renewal assets must not alter the v41 root document");
});

test("v41 responsive layer removes phone-frame limit and includes desktop breakpoints", async () => {
  const source = await readFile(responsiveUrl, "utf8");
  assert.match(source, /\.app\{[^}]*max-width:none!important/);
  assert.match(source, /height:100dvh!important/);
  assert.match(source, /@media \(min-width:768px\)/);
  assert.match(source, /@media \(min-width:1100px\)/);
  assert.match(source, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(source, /width:min\(720px,calc\(100% - 48px\)\)/);
});

test("renewal customer UI derives minor-unit factor from the selected currency", async () => {
  const source = await readFile(accountRenewalsUrl, "utf8");
  assert.match(source, /resolvedOptions\(\)\.maximumFractionDigits/);
  assert.match(source, /factor:\s*10 \*\* digits/);
  assert.match(source, /Number\(minor \|\| 0\) \/ factor/);
  assert.doesNotMatch(source, /Number\(minor \|\| 0\) \/ 100/);
});
