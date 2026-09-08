import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicUrl = new URL("../public/", import.meta.url);

test("theme changes notify the live storefront palette", async () => {
  const [theme, app] = await Promise.all([
    readFile(new URL("theme.js", publicUrl), "utf8"),
    readFile(new URL("app.js", publicUrl), "utf8")
  ]);

  assert.match(theme, /uchiha:theme-change/);
  assert.match(theme, /announceTheme\(theme\)/);
  assert.match(app, /addEventListener\("uchiha:theme-change"/);
  assert.match(app, /applyDesign\(catalog\.store\)/);
});
