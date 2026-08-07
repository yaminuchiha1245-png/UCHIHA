import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LIVE_URL = "https://demo.uchiha-builder.com/";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findChrome() {
  for (const name of ["google-chrome", "chromium", "chromium-browser"]) {
    try {
      const path = execFileSync("which", [name], { encoding: "utf8" }).trim();
      if (path) return path;
    } catch {
      // Try the next browser binary.
    }
  }
  return "";
}

async function waitForPort(profileDir, child) {
  const file = join(profileDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Chrome exited early (${child.exitCode})`);
    try {
      const [line] = (await readFile(file, "utf8")).trim().split(/\r?\n/);
      const port = Number(line);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // Not ready yet.
    }
    await sleep(100);
  }
  throw new Error("Chrome DevTools port timeout");
}

async function waitForPage(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { cache: "no-store" });
      const targets = response.ok ? await response.json() : [];
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // Not ready yet.
    }
    await sleep(100);
  }
  throw new Error("Chrome page target timeout");
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("DevTools socket timeout")), 4000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("DevTools socket failed"));
    }, { once: true });
  });
  return socket;
}

function client(socket) {
  let id = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message || "DevTools error"));
    else entry.resolve(message.result || {});
  });
  return (method, params = {}, timeoutMs = 4000) => new Promise((resolve, reject) => {
    const commandId = id++;
    const timer = setTimeout(() => {
      pending.delete(commandId);
      reject(new Error(`${method} timeout`));
    }, timeoutMs);
    pending.set(commandId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: commandId, method, params }));
  });
}

function attrsToObject(values = []) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) result[values[index]] = values[index + 1] ?? "";
  return result;
}

async function inspectState(send) {
  const documentResult = await send("DOM.getDocument", { depth: 1, pierce: true }, 3000);
  const root = documentResult.root?.nodeId;
  if (!root) throw new Error("No DOM root");
  const inspect = async (selector) => {
    const result = await send("DOM.querySelector", { nodeId: root, selector }, 3000);
    if (!result.nodeId) return null;
    const attrs = await send("DOM.getAttributes", { nodeId: result.nodeId }, 3000);
    return attrsToObject(attrs.attributes);
  };
  const [app, loading, error] = await Promise.all([
    inspect("#storeApp"),
    inspect("#storeLoading"),
    inspect("#storeLoadingError")
  ]);
  return {
    appExists: Boolean(app),
    appHidden: app ? Object.hasOwn(app, "hidden") : null,
    loadingExists: Boolean(loading),
    loadingHidden: loading ? Object.hasOwn(loading, "hidden") : null,
    errorHidden: error ? Object.hasOwn(error, "hidden") : null
  };
}

export async function probeScenario({ name, blocked = [] }) {
  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome is unavailable");
  const profileDir = await mkdtemp(join(tmpdir(), "uchiha-isolate-"));
  let child;
  let socket;
  try {
    child = spawn(chrome, [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-sync",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "about:blank"
    ], { stdio: "ignore" });
    const port = await waitForPort(profileDir, child);
    const target = await waitForPage(port);
    socket = await connect(target.webSocketDebuggerUrl);
    const send = client(socket);
    await send("Network.enable");
    await send("Page.enable");
    await send("DOM.enable");
    if (blocked.length) await send("Network.setBlockedURLs", { urls: blocked });
    await send("Page.navigate", { url: LIVE_URL }, 5000);
    await sleep(4500);
    try {
      const state = await inspectState(send);
      return { name, blocked, responsive: true, state };
    } catch (error) {
      return { name, blocked, responsive: false, error: error.message };
    }
  } finally {
    try { socket?.close(); } catch { /* no-op */ }
    if (child && child.exitCode === null) {
      child.kill("SIGKILL");
      await sleep(200);
    }
    try {
      await rm(profileDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
    } catch {
      // Diagnostic cleanup must not hide the result.
    }
  }
}

export async function isolateLiveFreeze() {
  const scenarios = [
    ["baseline", []],
    ["block-theme", ["*://*/assets/theme.js*"]],
    ["block-i18n", ["*://*/assets/i18n.js*"]],
    ["block-preview-banner", ["*://*/assets/preview-banner.js*"]],
    ["block-pwa", ["*://*/assets/pwa.js*"]],
    ["block-payments-links", ["*://*/assets/payments-links.js*"]],
    ["block-demo-development", ["*://*/assets/demo-development.js*"]],
    ["block-app", ["*://*/assets/app.js*"]],
    ["block-store-reference", ["*://*/assets/store-reference.js*"]],
    ["block-store-boot-guard", ["*://*/assets/store-boot-guard.js*"]],
    ["block-runtime-recovery", ["*://*/assets/runtime-recovery.js*"]],
    ["block-functional-hardening", ["*://*/assets/functional-hardening.js*"]],
    ["block-final-design", ["*://*/assets/final-design.js*"]],
    ["block-launch-sales", ["*://*/assets/launch-builder-sales.js*"]]
  ];
  const results = [];
  for (const [name, blocked] of scenarios) {
    const result = await probeScenario({ name, blocked });
    results.push(result);
    console.log(`ISOLATION ${name}: ${JSON.stringify(result)}`);
  }
  return results;
}
