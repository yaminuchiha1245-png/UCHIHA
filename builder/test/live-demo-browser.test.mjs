import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LIVE_DEMO_URL = "https://demo.uchiha-builder.com/";

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

function tagForId(html, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`<[^>]+id=["']${escaped}["'][^>]*>`, "i"))?.[0] || "";
}

function hasHiddenAttribute(tag) {
  return /\shidden(?:\s|=|>)/i.test(tag);
}

async function renderLiveStore(chrome) {
  const { stdout } = await execFileAsync(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--window-size=390,844",
      "--virtual-time-budget=12000",
      "--dump-dom",
      LIVE_DEMO_URL
    ],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 30_000 }
  );
  return stdout;
}

test(
  "live demo boots in a real browser and dismisses the blocking loader",
  { skip: process.env.CI !== "true", timeout: 90_000 },
  async () => {
    const chrome = findChrome();
    assert.ok(chrome, "Chrome/Chromium is required for the CI live storefront audit");

    let lastHtml = "";
    let lastError = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        lastHtml = await renderLiveStore(chrome);
        const appTag = tagForId(lastHtml, "storeApp");
        const loadingTag = tagForId(lastHtml, "storeLoading");
        const loadingErrorTag = tagForId(lastHtml, "storeLoadingError");

        if (
          appTag &&
          !hasHiddenAttribute(appTag) &&
          loadingTag &&
          hasHiddenAttribute(loadingTag) &&
          (!loadingErrorTag || hasHiddenAttribute(loadingErrorTag)) &&
          /UCHIHA/i.test(lastHtml)
        ) {
          return;
        }
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    if (lastError) throw lastError;
    const appTag = tagForId(lastHtml, "storeApp");
    const loadingTag = tagForId(lastHtml, "storeLoading");
    const loadingErrorTag = tagForId(lastHtml, "storeLoadingError");
    assert.fail(
      `Live storefront stayed blocked after JavaScript boot. ` +
      `storeApp=${appTag || "missing"}; storeLoading=${loadingTag || "missing"}; ` +
      `storeLoadingError=${loadingErrorTag || "missing"}`
    );
  }
);
