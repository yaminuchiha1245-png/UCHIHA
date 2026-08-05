import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { buildApp } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";
import { createDatabase } from "../src/db.mjs";
import { seedEnvironment } from "../src/seed.mjs";

const execute = promisify(execFile);
const browserCandidates = [
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);
const browserPath = browserCandidates.find((candidate) => existsSync(candidate));

function browserPreviewConfig() {
  const config = loadConfig({
    NODE_ENV: "production",
    PREVIEW_MEMORY_MODE: "true",
    REQUIRE_PERSISTENT_DATABASE: "false",
    DEMO_SEED: "true",
    ALLOW_DEMO_BILLING: "false",
    TELEGRAM_MODE: "test",
    UCHIHA_API_1_MODE: "test",
    APP_BASE_URL: "http://127.0.0.1",
    STORE_BASE_DOMAIN: "localhost",
    COOKIE_SECURE: "false",
    RATE_LIMIT_ENABLED: "false"
  });
  config.offerSeed = {
    name: "UCHIHA Full Browser Test",
    priceMinor: 0,
    renewalPriceMinor: 0,
    currency: "USD",
    durationUnit: "month",
    durationCount: 1,
    trialDays: 0
  };
  return config;
}

function openingTag(dom, id) {
  const match = dom.match(new RegExp(`<[^>]+id=["']${id}["'][^>]*>`, "i"));
  assert.ok(match, `Missing #${id} in browser DOM`);
  return match[0];
}

test("demo storefront replaces the loader with the real interface in Chromium", {
  skip: !browserPath && process.env.CI !== "true"
}, async (context) => {
  assert.ok(browserPath, "CI must provide Chrome or Chromium for the storefront browser smoke test");

  const config = browserPreviewConfig();
  const db = await createDatabase(config);
  await seedEnvironment(db, config);
  const app = await buildApp({ db, config, logger: false, startWorkers: false });
  const profileDirectory = await mkdtemp(join(tmpdir(), "uchiha-browser-"));

  context.after(async () => {
    await app.close();
    await db.close();
    await rm(profileDirectory, { recursive: true, force: true });
  });

  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const url = `${address}/store/demo?browser-smoke=${Date.now()}`;
  const { stdout, stderr } = await execute(browserPath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    `--user-data-dir=${profileDirectory}`,
    "--virtual-time-budget=30000",
    "--dump-dom",
    url
  ], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60000
  });

  const loadingTag = openingTag(stdout, "storeLoading");
  const appTag = openingTag(stdout, "storeApp");
  const errorTag = openingTag(stdout, "storeLoadingError");

  assert.match(loadingTag, /\bhidden(?:=(?:["'](?:hidden)?["']))?/i, "Loader remained visible after storefront bootstrap");
  assert.doesNotMatch(appTag, /\bhidden(?:=(?:["'](?:hidden)?["']))?/i, "Store interface remained hidden after storefront bootstrap");
  assert.match(errorTag, /\bhidden(?:=(?:["'](?:hidden)?["']))?/i, `Storefront displayed an error. Browser stderr: ${stderr.slice(-2000)}`);
  assert.match(stdout, /id=["']storeName["'][^>]*>\s*Nova Digital\s*</i, "Demo store data did not render in the browser DOM");
  assert.match(stdout, /class=["'][^"']*store-category-card/i, "Demo categories did not render in the browser DOM");
});
