import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicUrl = new URL("../public/", import.meta.url);

test("store category artwork keeps full color after the launch layer", async () => {
  const [theme, patch] = await Promise.all([
    readFile(new URL("theme.js", publicUrl), "utf8"),
    readFile(new URL("store-category-color-final.css", publicUrl), "utf8")
  ]);

  const launchIndex = theme.indexOf("store-launch-v6.css");
  const colorIndex = theme.indexOf("store-category-color-final.css");
  assert.ok(launchIndex >= 0, "store launch stylesheet must be installed");
  assert.ok(colorIndex > launchIndex, "full-color patch must load after the launch stylesheet");
  assert.match(patch, /store-category-visual img/);
  assert.match(patch, /subcategory-visual img/);
  assert.match(patch, /filter:\s*none\s*!important/);
  assert.match(patch, /mix-blend-mode:\s*normal\s*!important/);
});
