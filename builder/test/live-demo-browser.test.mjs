import assert from "node:assert/strict";
import test from "node:test";
import { isolateLiveFreeze } from "../scripts/isolate-live-freeze.mjs";

test(
  "live demo identifies the JavaScript asset responsible for renderer freezes",
  { skip: process.env.CI !== "true", timeout: 180_000 },
  async () => {
    const results = await isolateLiveFreeze();
    const baseline = results.find((item) => item.name === "baseline");
    if (baseline?.responsive && baseline.state?.appHidden === false && baseline.state?.loadingHidden === true) {
      return;
    }
    const recovered = results.filter((item) => item.name !== "baseline" && item.responsive);
    assert.fail(
      `Live demo renderer is frozen. Responsive isolation scenarios: ${JSON.stringify(recovered)}`
    );
  }
);
