import assert from "node:assert/strict";
import test from "node:test";
import { auditLiveStore } from "../scripts/live-browser-audit.mjs";

test(
  "live demo boots in a real browser and dismisses the blocking loader",
  { skip: process.env.CI !== "true", timeout: 45_000 },
  async () => {
    const result = await auditLiveStore({
      url: "https://demo.uchiha-builder.com/",
      timeoutMs: 30_000,
      screenshotPath: "/tmp/uchiha-live-demo.png"
    });
    assert.equal(result.ok, true);
    assert.equal(result.state.appHidden, false);
    assert.equal(result.state.loadingHidden, true);
    assert.notEqual(result.state.loadingErrorHidden, false);
    assert.match(result.state.bodyText, /UCHIHA/i);
  }
);
