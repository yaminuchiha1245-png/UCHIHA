import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function previewSource() {
  return read("public/preview-banner.js");
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

test("stale storefront documents recover before app initialization", async () => {
  const [preview, recovery] = await Promise.all([
    previewSource(),
    read("public/runtime-recovery.js")
  ]);
  assert.match(preview, /wrongStoreDocument/);
  assert.match(preview, /document\.body\.dataset\.page = "recovery"/);
  assert.match(preview, /runtime-recovery\.js/);
  assert.match(recovery, /getRegistrations/);
  assert.match(recovery, /clearUchihaCaches/);
  assert.match(recovery, /location\.replace/);
});

test("create store opens the builder directly and store loading has a finite fallback", async () => {
  const recovery = await read("public/runtime-recovery.js");
  assert.match(recovery, /location\.pathname !== "\/create-store"/);
  assert.match(recovery, /builder-direct-route/);
  assert.match(recovery, /#start/);
  assert.match(recovery, /STORE_LOADING_TIMEOUT_MS = 15500/);
  assert.match(recovery, /إعادة المحاولة/);
  assert.match(recovery, /العودة للمنصة/);
});

test("service worker never caches navigation documents and activates despite optional asset failures", async () => {
  const worker = await read("public/sw.js");
  const navigationStart = worker.indexOf('if (request.mode === "navigate")');
  const staticStart = worker.indexOf('/\\.(?:css|js|webmanifest)$/', navigationStart);
  assert.ok(navigationStart >= 0 && staticStart > navigationStart);
  assert.doesNotMatch(worker.slice(navigationStart, staticStart), /cache\.put/);
  assert.match(worker, /warmStaticCache/);
  assert.match(worker, /runtime-recovery\.js/);
  assert.match(worker, /CLEAR_UCHIHA_CACHES/);
});
