import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("owner category overview mirrors real catalog selects without inventing backend state", async () => {
  const [runtime, css, theme, worker] = await Promise.all([
    read("public/admin-catalog-v3.js"),
    read("public/admin-catalog-v3-runtime.css"),
    read("public/theme.js"),
    read("public/sw.js")
  ]);

  assert.match(runtime, /#categoryParent/);
  assert.match(runtime, /#productCategory/);
  assert.match(runtime, /buildTree\(parentSelect, productSelect\)/);
  assert.match(runtime, /MutationObserver/);
  assert.match(runtime, /productSelect\.value = item\.value/);
  assert.match(runtime, /productForm\.scrollIntoView/);
  assert.doesNotMatch(runtime, /fetch\(|\/api\//);

  assert.match(css, /\.catalog-category-tree\s*\{[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.catalog-category-root/);
  assert.match(css, /\.catalog-category-child/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*grid-template-columns:\s*1fr/);

  assert.match(theme, /admin-catalog-v3-runtime\.css/);
  assert.match(theme, /admin-catalog-v3\.js/);
  assert.match(worker, /admin-catalog-v3-runtime\.css/);
  assert.match(worker, /admin-catalog-v3\.js/);
});
