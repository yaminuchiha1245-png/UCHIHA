import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const updateScript = new URL("../scripts/update-vps.sh", import.meta.url);

test("VPS update detects stale production v41 assets even when git HEAD is unchanged", async () => {
  const source = await readFile(updateScript, "utf8");
  for (const relative of [
    "src/launch-assets.mjs",
    "public/v41-production-bridge.js",
    "public/v41-responsive.css",
    "public/runtime-recovery.js"
  ]) {
    assert.ok(source.includes(`"${relative}"`), `${relative} must participate in container drift detection`);
  }
  assert.match(source, /container_matches_source\(\)/);
  assert.match(source, /sha256sum "\$REPO_DIR\/builder\/\$relative"/);
  assert.match(source, /docker exec uchiha-api sha256sum "\/app\/\$relative"/);
  assert.match(source, /Git is current but the running container is stale or unverifiable\. Forcing a clean rebuild\./);
});
