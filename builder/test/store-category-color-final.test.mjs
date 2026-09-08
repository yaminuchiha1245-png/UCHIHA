import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicUrl = new URL("../public/", import.meta.url);

test("store content keeps independent colors while merchant color stays on chrome", async () => {
  const [theme, patch, worker] = await Promise.all([
    readFile(new URL("theme.js", publicUrl), "utf8"),
    readFile(new URL("store-category-color-final.css", publicUrl), "utf8"),
    readFile(new URL("sw.js", publicUrl), "utf8")
  ]);

  const launchIndex = theme.indexOf("store-launch-v6.css");
  const colorIndex = theme.indexOf("store-category-color-final.css");
  assert.ok(launchIndex >= 0, "store launch stylesheet must be installed");
  assert.ok(colorIndex > launchIndex, "final color patch must load after the launch stylesheet");

  assert.match(patch, /store-category-visual img/);
  assert.match(patch, /subcategory-visual img/);
  assert.match(patch, /filter:\s*none\s*!important/);
  assert.match(patch, /mix-blend-mode:\s*normal\s*!important/);
  assert.match(patch, /store-category-visual,[\s\S]*background:\s*var\(--launch-panel\)\s*!important/);
  assert.match(patch, /store-search-hint[\s\S]*background:\s*#2563eb\s*!important/);
  assert.match(patch, /store-main-search:focus-within[\s\S]*#38bdf8/);
  assert.match(patch, /store-drawer nav a[\s\S]*var\(--item-accent, #f97316\)/);
  assert.match(patch, /store-mobile-nav > \* span[\s\S]*var\(--nav-accent\)/);
  assert.doesNotMatch(patch, /background:[^;]*var\(--launch-brand/);
  assert.match(worker, /store-category-color-final\.css/);
});
