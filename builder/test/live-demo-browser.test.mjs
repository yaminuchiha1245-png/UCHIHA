import assert from "node:assert/strict";
import test from "node:test";
import { auditLiveStore } from "../scripts/live-browser-audit.mjs";

test(
  "live demo boots in a real browser with i18n enabled and dismisses the blocking loader",
  { skip: process.env.LIVE_DEMO_AUDIT !== "true", timeout: 45_000 },
  async () => {
    const result = await auditLiveStore({
      url: process.env.LIVE_DEMO_URL || "https://demo.uchiha-builder.com/",
      timeoutMs: 30_000,
      screenshotPath: process.env.LIVE_DEMO_SCREENSHOT || "/tmp/uchiha-live-demo.png"
    });
    assert.equal(result.ok, true);
    assert.equal(result.state.appExists, true);
    assert.equal(result.state.appHidden, false);
    assert.equal(result.state.loadingExists, true);
    assert.equal(result.state.loadingHidden, true);
    assert.notEqual(result.state.loadingErrorHidden, false);
    assert.match(result.state.storeNameHtml, /UCHIHA/i);
  }
);
