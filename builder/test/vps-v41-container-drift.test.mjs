import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const updateScript = new URL("../scripts/update-vps.sh", import.meta.url);

test("VPS update detects stale UCHIHA Builder assets even when git HEAD is unchanged", async () => {
  const source = await readFile(updateScript, "utf8");
  for (const relative of [
    "src/launch-assets.mjs",
    "public/platform-v5.html",
    "public/platform-v5.js",
    "public/platform-v5.css",
    "public/runtime-recovery.js"
  ]) {
    assert.ok(source.includes(`"${relative}"`), `${relative} must participate in container drift detection`);
  }
  assert.doesNotMatch(source, /public\/v41-production-bridge\.js/);
  assert.doesNotMatch(source, /public\/v41-responsive\.css/);
  assert.match(source, /container_matches_source\(\)/);
  assert.match(source, /sha256sum "\$REPO_DIR\/builder\/\$relative"/);
  assert.match(source, /docker exec uchiha-api sha256sum "\/app\/\$relative"/);
  assert.match(source, /Git is current but the running container is stale or unverifiable\. Forcing a clean rebuild\./);
});
