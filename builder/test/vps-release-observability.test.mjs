import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../src/config.mjs";

async function text(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("VPS release SHA takes precedence over Railway deployment metadata", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_MODE: "memory",
    UCHIHA_RELEASE_SHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    RAILWAY_GIT_COMMIT_SHA: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  });

  assert.equal(config.deployment.commitSha, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test("Railway release SHA remains a compatibility fallback", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_MODE: "memory",
    RAILWAY_GIT_COMMIT_SHA: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  });

  assert.equal(config.deployment.commitSha, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
});

test("VPS runtime renderer derives release metadata from the checked out git HEAD", async () => {
  const renderer = await text("../scripts/render-vps-runtime.sh");

  assert.match(renderer, /git -C "\$REPO_DIR" rev-parse HEAD/);
  assert.match(renderer, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(renderer, /UCHIHA_RELEASE_SHA=%s/);
  assert.match(renderer, /release\.env/);
  assert.match(renderer, /- release\.env/);
});

test("readiness endpoint is wired to expose the runtime release SHA", async () => {
  const readiness = await text("../src/launch-readiness-http.mjs");
  assert.match(readiness, /config\.deployment\?\.commitSha/);
  assert.match(readiness, /releaseSha/);
});
