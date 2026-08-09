import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicUrl = new URL("../public/", import.meta.url);
const readPublic = (name) => readFile(new URL(name, publicUrl), "utf8");

test("all customer account routes paint the launch shell before runtime hydration", async () => {
  const [html, css, runtime, account] = await Promise.all([
    readPublic("account.html"),
    readPublic("account-polish-v2.css"),
    readPublic("account-polish-v2.js"),
    readPublic("account.js")
  ]);

  const baseStyle = html.indexOf("/assets/account.css?v=2026.08.09.2");
  const launchStyle = html.indexOf("/assets/account-polish-v2.css?v=2026.08.09.2");
  const themeScript = html.indexOf("/assets/theme.js?v=2026.08.09.2");
  assert.ok(baseStyle >= 0 && launchStyle > baseStyle && themeScript > launchStyle);

  const actions = html.match(/<nav class="header-actions"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.match(actions, /id="drawerOpen"/);
  assert.match(actions, /id="headerBalance"/);
  assert.match(actions, /id="headerNotifications"/);
  assert.match(actions, /id="headerProfile"[\s\S]*hidden/);
  assert.equal((actions.match(/<button\b/g) || []).length, 4, "three visible controls plus one hidden account sync control");

  assert.match(html, /uchiha-transparent-mark\.svg/);
  assert.match(html, /class="account-language-row"[^>]*data-language-toggle/);
  assert.match(html, /data-active-section="account"/);
  assert.match(css, /grid-template-areas:\s*"notifications balance menu"/);
  assert.match(css, /@keyframes account-drawer-enter[\s\S]*translate3d\(100%,0,0\)/);
  assert.match(css, /@keyframes account-drawer-item-enter/);
  assert.match(css, /\.account-bottom-nav \[aria-current="page"\]/);
  assert.match(css, /\.global-language-toggle\s*\{\s*display:\s*none\s*!important/);
  assert.match(runtime, /const RELEASE = "2026\.08\.09\.2-account"/);
  assert.match(runtime, /account-drawer-icon/);
  assert.match(account, /compactValue = hidden \? "••••" : major\.toFixed\(2\)/);
  assert.match(account, /dataset\.activeSection = section/);
});

test("catalog hierarchy uses independent root, subcategory and product screens", async () => {
  const [html, app, css] = await Promise.all([
    readPublic("store.html"),
    readPublic("app.js"),
    readPublic("store-launch-v6.css")
  ]);

  const rootsStart = html.indexOf('<section class="store-category-section"');
  const rootsEnd = html.indexOf("</section>", rootsStart);
  const nestedStart = html.indexOf('id="storeSubcategoryView"');
  const productsStart = html.indexOf('id="products"');
  assert.ok(rootsStart >= 0 && rootsEnd > rootsStart);
  assert.ok(nestedStart > rootsEnd, "subcategory screen must not be nested inside the root section");
  assert.ok(productsStart > nestedStart, "products screen must follow the subcategory screen");
  assert.match(html, /id="backToRootCategories"/);

  assert.match(app, /categorySection\.hidden = !isHome/);
  assert.match(app, /subcategoryView\.hidden = !isCategory/);
  assert.match(app, /productsSection\.hidden = !isProducts/);
  assert.match(app, /searchShell\.hidden = !isHome/);
  assert.match(app, /storeSupport\.hidden = !isHome/);
  assert.match(app, /isCategory \? subcategoryView : productsSection/);
  assert.match(app, /"aria-pressed": String\(currentCategory === category\.id\)/);

  assert.match(css, /\.store-subcategory-view\[hidden\][\s\S]*display:\s*none\s*!important/);
  assert.match(css, /data-browse-mode="category"[\s\S]*\.store-products-section/);
  assert.match(css, /@keyframes launch-catalog-screen-enter/);
  assert.match(css, /\.store-subcategory-view \.store-subcategory-list[\s\S]*repeat\(3, minmax\(0,1fr\)\)/);
  assert.match(css, /\.store-product-card\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,1fr\)\s*!important/);
  assert.match(css, /\.product-visual\s*\{[\s\S]*width:\s*100%\s*!important[\s\S]*aspect-ratio:\s*1\s*\/\s*1\s*!important/);
});

test("storefront cache owners advance together after the account and hierarchy rewrite", async () => {
  const files = await Promise.all([
    "theme.js",
    "sw.js",
    "pwa.js",
    "runtime-recovery.js",
    "preview-banner.js",
    "store-reference.js",
    "store-polish-v2.js",
    "store-launch-v6.js"
  ].map(readPublic));
  files.forEach((source) => assert.match(source, /2026\.08\.09\.2/));
});
