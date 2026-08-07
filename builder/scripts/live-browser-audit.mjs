import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_URL = "https://demo.uchiha-builder.com/";
const DEFAULT_TIMEOUT_MS = 30_000;

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export function findChrome() {
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

async function waitForDevToolsPort(profileDir, child, timeoutMs) {
  const portFile = join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + Math.min(timeoutMs, 12_000);
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Chrome exited before DevTools became ready (code ${child.exitCode})`);
    try {
      const [portLine] = (await readFile(portFile, "utf8")).trim().split(/\r?\n/);
      const port = Number(portLine);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // Chrome has not written DevToolsActivePort yet.
    }
    await sleep(100);
  }
  throw new Error("Chrome DevTools port did not become ready");
}

async function waitForPageTarget(port, expectedHost, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 12_000);
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { cache: "no-store" });
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) =>
          target.type === "page" &&
          target.webSocketDebuggerUrl &&
          (() => {
            try {
              return new URL(target.url).hostname === expectedHost;
            } catch {
              return false;
            }
          })()
        );
        if (page) return page;
      }
    } catch {
      // DevTools HTTP endpoint is still starting.
    }
    await sleep(150);
  }
  throw new Error(`Chrome did not expose a page target for ${expectedHost}`);
}

async function openCdpSocket(url) {
  if (typeof WebSocket !== "function") throw new Error("This Node.js runtime does not provide WebSocket support");
  const socket = new WebSocket(url);
  await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out opening Chrome DevTools WebSocket")), 5000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolvePromise();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Chrome DevTools WebSocket failed to open"));
    }, { once: true });
  });
  return socket;
}

function createCdpClient(socket) {
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message || "Chrome DevTools command failed"));
    else entry.resolve(message.result || {});
  });

  return function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chrome DevTools command timed out: ${method}`));
      }, 5000);
      pending.set(id, { resolve: resolvePromise, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
}

const STATE_EXPRESSION = `(() => {
  const app = document.querySelector('#storeApp');
  const loading = document.querySelector('#storeLoading');
  const loadingError = document.querySelector('#storeLoadingError');
  return {
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    appExists: Boolean(app),
    appHidden: app ? app.hidden : null,
    loadingExists: Boolean(loading),
    loadingHidden: loading ? loading.hidden : null,
    loadingErrorHidden: loadingError ? loadingError.hidden : null,
    loadingErrorText: loadingError ? loadingError.textContent.trim() : '',
    boot: window.__uchihaStoreBoot || null,
    bodyText: document.body ? document.body.innerText.slice(0, 1200) : ''
  };
})()`;

export async function auditLiveStore({
  url = DEFAULT_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  screenshotPath = ""
} = {}) {
  const targetUrl = new URL(url);
  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome/Chromium is not installed");

  const profileDir = await mkdtemp(join(tmpdir(), "uchiha-live-browser-"));
  let stderr = "";
  let child;
  let socket;
  let lastState = null;

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
      "--metrics-recording-only",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "--window-size=390,844",
      targetUrl.toString()
    ], { stdio: ["ignore", "ignore", "pipe"] });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-12_000);
    });

    const port = await waitForDevToolsPort(profileDir, child, timeoutMs);
    const target = await waitForPageTarget(port, targetUrl.hostname, timeoutMs);
    socket = await openCdpSocket(target.webSocketDebuggerUrl);
    const send = createCdpClient(socket);
    await send("Runtime.enable");
    await send("Page.enable");

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const evaluation = await send("Runtime.evaluate", {
        expression: STATE_EXPRESSION,
        returnByValue: true,
        awaitPromise: true
      });
      lastState = evaluation.result?.value || null;
      if (
        lastState?.appExists &&
        lastState.appHidden === false &&
        lastState?.loadingExists &&
        lastState.loadingHidden === true &&
        lastState.loadingErrorHidden !== false &&
        /UCHIHA/i.test(lastState.bodyText || "")
      ) {
        if (screenshotPath) {
          const screenshot = await send("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: false
          });
          if (screenshot.data) await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
        }
        return {
          ok: true,
          chrome,
          url: lastState.href,
          title: lastState.title,
          readyState: lastState.readyState,
          boot: lastState.boot,
          state: lastState
        };
      }
      if (lastState?.loadingErrorHidden === false) {
        throw new Error(`Storefront boot error is visible: ${lastState.loadingErrorText || "unknown error"}`);
      }
      await sleep(500);
    }

    throw new Error(
      `Storefront did not finish booting within ${timeoutMs}ms. ` +
      `Last state: ${JSON.stringify(lastState)}`
    );
  } finally {
    try {
      socket?.close();
    } catch {
      // Best-effort cleanup.
    }
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolvePromise) => child.once("exit", resolvePromise)),
        sleep(1500)
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await rm(profileDir, { recursive: true, force: true });
    if (process.env.UCHIHA_LIVE_BROWSER_DEBUG === "true" && stderr) {
      process.stderr.write(stderr);
    }
  }
}

async function main() {
  try {
    const result = await auditLiveStore({
      url: process.env.LIVE_DEMO_URL || DEFAULT_URL,
      timeoutMs: Number(process.env.LIVE_DEMO_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
      screenshotPath: process.env.LIVE_DEMO_SCREENSHOT || "/tmp/uchiha-demo.png"
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  }
}

const executedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (executedFile === fileURLToPath(import.meta.url)) await main();
