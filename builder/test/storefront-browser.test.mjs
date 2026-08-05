import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildApp } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";
import { createDatabase } from "../src/db.mjs";
import { seedEnvironment } from "../src/seed.mjs";

const browserCandidates = [
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);
const browserPath = browserCandidates.find((candidate) => existsSync(candidate));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

async function launchChromium(profileDirectory) {
  const child = spawn(browserPath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-default-apps",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-proxy-server",
    "--proxy-bypass-list=localhost;127.0.0.1",
    "--remote-allow-origins=*",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDirectory}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-24000);
  });

  const browserWebSocketUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Chromium did not expose DevTools.\n${stderr}`));
    }, 15000);
    const inspect = (chunk) => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timeout);
      child.stderr.off("data", inspect);
      resolve(match[1]);
    };
    child.stderr.on("data", inspect);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`Chromium exited before DevTools (${code ?? signal}).\n${stderr}`));
    });
  });

  return {
    child,
    browserWebSocketUrl,
    stderr: () => stderr,
    close() {
      if (!child.killed) child.kill("SIGKILL");
    }
  };
}

async function findPageTarget(debugPort) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { cache: "no-store" });
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch {
      // Chromium may need a brief moment after printing its DevTools URL.
    }
    await delay(200);
  }
  throw new Error("Chromium did not expose a debuggable page target");
}

async function connectCdp(webSocketUrl) {
  assert.equal(typeof WebSocket, "function", "Node must provide WebSocket for the browser smoke test");
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("CDP WebSocket connection timed out")), 10000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("CDP WebSocket connection failed"));
    }, { once: true });
  });

  let sequence = 0;
  const pending = new Map();
  const diagnostics = [];

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result || {});
      return;
    }

    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails || {};
      diagnostics.push(`JS_EXCEPTION ${details.text || ""} ${details.exception?.description || ""}`.trim());
    }
    if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params?.type)) {
      const values = (message.params.args || []).map((item) => item.value ?? item.description ?? "");
      diagnostics.push(`CONSOLE_${message.params.type.toUpperCase()} ${values.join(" ")}`.trim());
    }
    if (message.method === "Log.entryAdded") {
      const entry = message.params?.entry || {};
      if (["error", "warning"].includes(entry.level)) diagnostics.push(`LOG_${entry.level.toUpperCase()} ${entry.text || ""}`.trim());
    }
    if (message.method === "Network.loadingFailed") {
      diagnostics.push(`NETWORK_FAILED ${message.params?.errorText || ""} ${message.params?.blockedReason || ""}`.trim());
    }
    if (message.method === "Network.responseReceived") {
      const response = message.params?.response;
      if (response?.url?.includes("/api/") && Number(response.status) >= 400) {
        diagnostics.push(`API_${response.status} ${response.url}`);
      }
    }
  });

  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 12000);
    pending.set(id, { method, resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });

  return {
    socket,
    command,
    diagnostics,
    close() {
      try { socket.close(); } catch { /* no-op */ }
    }
  };
}

const STATE_EXPRESSION = `(() => {
  const loading = document.getElementById("storeLoading");
  const app = document.getElementById("storeApp");
  const error = document.getElementById("storeLoadingError");
  const hidden = (node) => node ? (node.hidden || getComputedStyle(node).display === "none") : null;
  return {
    href: location.href,
    pathname: location.pathname,
    readyState: document.readyState,
    page: document.body?.dataset?.page || "",
    hasLoading: Boolean(loading),
    loadingHidden: hidden(loading),
    hasApp: Boolean(app),
    appHidden: hidden(app),
    errorHidden: hidden(error),
    errorText: error?.textContent?.trim() || "",
    storeName: document.getElementById("storeName")?.textContent?.trim() || "",
    categoryCount: document.querySelectorAll(".store-category-card").length,
    scripts: [...document.scripts].map((script) => script.src).filter(Boolean)
  };
})()`;

function browserDiagnostic(state, diagnostics, chromeStderr) {
  return [
    `STATE ${JSON.stringify(state, null, 2)}`,
    `BROWSER EVENTS\n${diagnostics.join("\n") || "none"}`,
    `CHROMIUM STDERR\n${chromeStderr.slice(-5000)}`
  ].join("\n\n");
}

test("demo storefront replaces the loader with the real interface in Chromium", {
  skip: !browserPath && process.env.CI !== "true",
  timeout: 60000
}, async (context) => {
  assert.ok(browserPath, "CI must provide Chrome or Chromium for the storefront browser smoke test");

  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const config = browserPreviewConfig(baseUrl);
  const db = await createDatabase(config);
  await seedEnvironment(db, config);
  const app = await buildApp({ db, config, logger: false, startWorkers: false });
  const profileDirectory = await mkdtemp(join(tmpdir(), "uchiha-browser-"));
  let chromium = null;
  let cdp = null;

  context.after(async () => {
    cdp?.close();
    chromium?.close();
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

  chromium = await launchChromium(profileDirectory);
  const debugPort = new URL(chromium.browserWebSocketUrl).port;
  const target = await findPageTarget(debugPort);
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await Promise.all([
    cdp.command("Page.enable"),
    cdp.command("Runtime.enable"),
    cdp.command("Network.enable"),
    cdp.command("Log.enable")
  ]);
  const navigation = await cdp.command("Page.navigate", { url });
  assert.equal(navigation.errorText, undefined, `Chromium navigation failed: ${navigation.errorText}`);

  let state = null;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const evaluation = await cdp.command("Runtime.evaluate", {
        expression: STATE_EXPRESSION,
        returnByValue: true,
        awaitPromise: true
      });
      state = evaluation.result?.value || state;
      if (state?.hasApp && !state.appHidden && state.loadingHidden && state.storeName === "Nova Digital" && state.categoryCount > 0) break;
      if (state?.errorHidden === false) break;
    } catch (error) {
      cdp.diagnostics.push(`EVALUATION ${error.message}`);
    }
    await delay(500);
  }

  const diagnostic = browserDiagnostic(state, cdp.diagnostics, chromium.stderr());
  assert.ok(state?.hasLoading, `Storefront loader element was not present\n${diagnostic}`);
  assert.ok(state.loadingHidden, `Loader remained visible after storefront bootstrap\n${diagnostic}`);
  assert.ok(state?.hasApp, `Storefront app element was not present\n${diagnostic}`);
  assert.equal(state.appHidden, false, `Storefront interface remained hidden\n${diagnostic}`);
  assert.equal(state.errorHidden, true, `Storefront displayed an error\n${diagnostic}`);
  assert.equal(state.storeName, "Nova Digital", `Demo store data did not render\n${diagnostic}`);
  assert.ok(state.categoryCount > 0, `Demo categories did not render\n${diagnostic}`);
});
