import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function previewSource() {
  return readFile(new URL("../public/preview-banner.js", import.meta.url), "utf8");
}

test("runtime recovery prevents permanent blocking loaders", async () => {
  const source = await previewSource();
  assert.match(source, /ensureStorage\("sessionStorage"\)/);
  assert.match(source, /ensureStorage\("localStorage"\)/);
  assert.match(source, /__uchihaFetchDeadlineInstalled/);
  assert.match(source, /18000/);
  assert.match(source, /30000/);
  assert.match(source, /pointer-events: none !important/);
  assert.match(source, /WATCHDOG_MS = 22000/);
  assert.match(source, /إعادة المحاولة/);
  assert.match(source, /العودة للرئيسية/);
  assert.match(source, /unhandledrejection/);
});

test("runtime recovery is installed before optional UI hardening", async () => {
  const source = await previewSource();
  assert.ok(source.indexOf("installRuntimeRecovery();") < source.indexOf("installFunctionalHardening();"));
});
