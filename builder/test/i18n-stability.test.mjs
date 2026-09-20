import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../public/i18n.js", import.meta.url), "utf8");

test("language controls do not create an endless MutationObserver feedback loop", () => {
  assert.match(source, /if \(valueNode\.textContent !== label\) valueNode\.textContent = label/);
  assert.match(source, /else if \(button\.textContent !== label\)/);
  assert.match(source, /if \(button\.getAttribute\("aria-label"\) !== accessibleLabel\)/);
  assert.match(source, /if \(button\.getAttribute\("title"\) !== accessibleLabel\)/);
  assert.doesNotMatch(source, /if \(valueNode\) valueNode\.textContent = label;\s*else button\.textContent = label;/);
});

test("i18n mutation and locale application guards always release their reentrancy lock", () => {
  assert.match(source, /function applyLocale[\s\S]*?try \{[\s\S]*?\} finally \{\s*applying = false;/);
  assert.match(source, /const observer = new MutationObserver[\s\S]*?try \{[\s\S]*?\} finally \{\s*applying = false;/);
});
