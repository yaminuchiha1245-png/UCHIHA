import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("owner catalog keeps existing search pagination and media actions with responsive management polish", async () => {
  const [css, app, theme, worker, html] = await Promise.all([
    read("public/admin-catalog-v3.css"),
    read("public/app.js"),
    read("public/theme.js"),
    read("public/sw.js"),
    read("public/admin.html")
  ]);

  assert.match(html, /data-panel-view="catalog"/);
  assert.match(html, /id="adminProductSearch"/);
  assert.match(html, /id="adminProductsMore"/);
  assert.match(html, /id="productsList"/);

  assert.match(app, /#adminProductsMore/);
  assert.match(app, /loadCatalog\(false\)/);
  assert.match(app, /#adminProductSearch/);
  assert.match(app, /setTimeout\(\(\) => loadCatalog\(true\), 300\)/);
  assert.match(app, /className: "catalog-product-row"/);
  assert.match(app, /className: "catalog-media-controls"/);
  assert.match(app, /method: "PATCH"/);

  assert.match(css, /#categoryForm\s*\{[\s\S]*position:\s*sticky/);
  assert.match(css, /\.catalog-list-heading\s*\{[\s\S]*position:\s*sticky/);
  assert.match(css, /\.catalog-product-row\s*\{[\s\S]*grid-template-columns/);
  assert.match(css, /\.catalog-media-controls\s*\{[\s\S]*grid-template-columns/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /\.catalog-media-controls\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /\.catalog-more\s*\{[\s\S]*min-height:\s*44px/);

  assert.match(theme, /admin-catalog-v3\.css/);
  assert.match(worker, /admin-catalog-v3\.css/);
});
