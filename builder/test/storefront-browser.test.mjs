import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
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

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  assert.ok(port, "Could not reserve a local browser-test port");
  return port;
}

function browserPreviewConfig(baseUrl) {
  const config = loadConfig({
    NODE_ENV: "production",
    PREVIEW_MEMORY_MODE: "true",
    REQUIRE_PERSISTENT_DATABASE: "false",
    DEMO_SEED: "true",
    ALLOW_DEMO_BILLING: "false",
    TELEGRAM_MODE: "test",
    UCHIHA_API_1_MODE: "test",
    APP_BASE_URL: baseUrl,
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

function diagnosticText(stdout, stderr) {
  return [
    `DOM START:\n${stdout.slice(0, 2500)}`,
    `DOM END:\n${stdout.slice(-2500)}`,
    `CHROME STDERR:\n${stderr.slice(-3000)}`
  ].join("\n\n");
}

function openingTag(dom, id, diagnostic) {
  const match = dom.match(new RegExp(`<[^>]+id=["']${id}["'][^>]*>`, "i"));
  assert.ok(match, `Missing #${id} in browser DOM\n${diagnostic}`);
  return match[0];
}

async function dumpStorefront(url, profileDirectory, { serviceWorker = false } = {}) {
  const flags = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    `--user-data-dir=${profileDirectory}`,
    "--virtual-time-budget=18000",
    "--dump-dom"
  ];
  if (!serviceWorker) flags.push("--disable-features=ServiceWorker");
  flags.push(url);
  return execute(browserPath, flags, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 45000
  });
}

test("demo storefront replaces the loader with the real interface in Chromium", {
  skip: !browserPath && process.env.CI !== "true"
}, async (context) => {
  assert.ok(browserPath, "CI must provide Chrome or Chromium for the storefront browser smoke test");

  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const config = browserPreviewConfig(baseUrl);
  const db = await createDatabase(config);
  await seedEnvironment(db, config);
  const app = await buildApp({ db, config, logger: false, startWorkers: false });
  const profileDirectory = await mkdtemp(join(tmpdir(), "uchiha-browser-"));

  context.after(async () => {
    await app.close();
    await db.close();
    await rm(profileDirectory, { recursive: true, force: true });
  });

  await app.listen({ host: "127.0.0.1", port });
  const url = `${baseUrl}/store/demo?browser-smoke=${Date.now()}`;
  const preflight = await fetch(url, { redirect: "manual", headers: { accept: "text/html" } });
  const source = await preflight.text();
  assert.equal(preflight.status, 200, `Browser URL preflight failed: ${preflight.status} ${preflight.headers.get("location") || ""}`);
  assert.match(source, /id=["']storeLoading["']/, "Browser URL did not return store.html");
  assert.match(source, /preview-banner\.js/, "Browser URL did not include the storefront bootstrap");

  const { stdout, stderr } = await dumpStorefront(url, profileDirectory, { serviceWorker: false });
  const diagnostic = diagnosticText(stdout, stderr);
  const loadingTag = openingTag(stdout, "storeLoading", diagnostic);
  const appTag = openingTag(stdout, "storeApp", diagnostic);
  const errorTag = openingTag(stdout, "storeLoadingError", diagnostic);

  assert.match(loadingTag, /\bhidden(?:=(?:["'](?:hidden)?["']))?/i, `Loader remained visible after storefront bootstrap\n${diagnostic}`);
  assert.doesNotMatch(appTag, /\bhidden(?:=(?:["'](?:hidden)?["']))?/i, `Store interface remained hidden after storefront bootstrap\n${diagnostic}`);
  assert.match(errorTag, /\bhidden(?:=(?:["'](?:hidden)?["']))?/i, `Storefront displayed an error\n${diagnostic}`);
  assert.match(stdout, /id=["']storeName["'][^>]*>\s*Nova Digital\s*</i, `Demo store data did not render\n${diagnostic}`);
  assert.match(stdout, /class=["'][^"']*store-category-card/i, `Demo categories did not render\n${diagnostic}`);
});
