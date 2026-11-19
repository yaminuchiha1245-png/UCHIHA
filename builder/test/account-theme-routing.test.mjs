import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("customer account routes win before the demo-host storefront fallback", async () => {
  const theme = await read("public/theme.js");
  const accountClassifier = '/^\\/store\\/[^/]+\\/(?:account|wallet|payments|add-funds|orders|support|telegram|security|identity|developer|about)\\/?$/';
  const accountRoute = theme.indexOf(accountClassifier);
  const demoFallback = theme.indexOf('startsWith("demo.")');
  assert.ok(accountRoute >= 0, "customer account route classifier is missing");
  assert.ok(demoFallback >= 0, "demo hostname fallback is missing");
  assert.ok(accountRoute < demoFallback, "demo hostname fallback must not shadow customer account routes");
  assert.match(theme, /account-polish-v2\.css/);
  assert.match(theme, /account-polish-v2\.js/);
  assert.match(theme, /monochrome-v1\.css/);
});

test("storefront palettes stay customizable while non-store surfaces use the neutral shell", async () => {
  const theme = await read("public/theme.js");
  assert.match(theme, /function shouldInstallMonochrome\(kind\)/);
  assert.match(theme, /return kind !== "store" && kind !== "account"/);
  assert.match(theme, /if \(shouldInstallMonochrome\(kind\)\)/);
});
