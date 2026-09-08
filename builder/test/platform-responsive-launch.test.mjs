import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const responsiveUrl = new URL("../public/platform-v5-responsive.css", import.meta.url);

test("public platform pages scale from mobile drawer to desktop workspace", async () => {
  const source = await readFile(responsiveUrl, "utf8");
  assert.match(source, /@media \(max-width:719px\)/);
  assert.match(source, /\.v5-drawer\{width:min\(86vw,340px\)/);
  assert.match(source, /@media \(min-width:720px\)/);
  assert.match(source, /width:min\(1440px,calc\(100% - 64px\)\)/);
  assert.match(source, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(source, /width:min\(720px,calc\(100% - 48px\)\)/);
  assert.match(source, /\.v5-orders\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});
