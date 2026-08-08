import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicUrl = new URL("../public/", import.meta.url);

test("launch admin layer keeps desktop content in its own grid column", async () => {
  const css = await readFile(new URL("admin-launch-v4.css", publicUrl), "utf8");
  assert.match(css, /grid-template-columns:\s*232px minmax\(0, 1fr\)\s*!important/);
  assert.match(css, /\.dashboard-main\s*\{[\s\S]*?grid-column:\s*2\s*!important/);
  assert.match(css, /\.admin-mobile-backdrop,[\s\S]*?display:\s*none\s*!important/);
  assert.match(css, /admin-mobile-nav-open \.admin-mobile-backdrop[\s\S]*?display:\s*block\s*!important/);
  assert.match(css, /backdrop-filter:\s*none\s*!important/);
  assert.match(css, /content-visibility:\s*auto/);
});

test("theme installs the admin launch layer and defaults product surfaces to dark", async () => {
  const [theme, worker] = await Promise.all([
    readFile(new URL("theme.js", publicUrl), "utf8"),
    readFile(new URL("sw.js", publicUrl), "utf8")
  ]);
  assert.match(theme, /2026\.08\.08\.23-color/);
  assert.match(theme, /\["store", "account", "admin", "owner-subadmin"\]\.includes\(kind\)/);
  assert.match(theme, /admin-launch-v4\.css/);
  assert.match(worker, /admin-launch-v4\.css/);
  assert.match(worker, /uchiha-banner-madara-1280\.webp/);
  assert.match(worker, /uchiha-banner-itachi-1920\.webp/);
});
