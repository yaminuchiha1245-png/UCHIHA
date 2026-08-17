import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const updateScript = new URL("../scripts/update-vps.sh", import.meta.url);

test("VPS updater always rebuilds the exact target and stages API health before workers", async () => {
  const source = await readFile(updateScript, "utf8");

  assert.doesNotMatch(source, /container_matches_source\(\)/, "source-hash shortcuts must not replace an exact target rebuild");
  assert.match(source, /LIVE_SHA="\$\(cat "\$ROOT_DIR\/current-release"/, "rollback must use the verified live release marker");
  assert.match(source, /uchiha-builder:rollback-\$LIVE_SHA/, "rollback image must be keyed to the verified live release");

  const buildIndex = source.indexOf('docker build --pull -t "uchiha-builder:$TARGET_SHA" builder');
  const tagIndex = source.indexOf('docker tag "uchiha-builder:$TARGET_SHA" uchiha-builder:production', buildIndex);
  const apiIndex = source.indexOf('"${COMPOSE[@]}" up -d --force-recreate --no-deps api', tagIndex);
  const waitIndex = source.indexOf('if ! wait_for_api_health; then', apiIndex);
  const diagnosticsIndex = source.indexOf('print_api_diagnostics', waitIndex);
  const restIndex = source.indexOf('"${COMPOSE[@]}" up -d --force-recreate --remove-orphans worker tls-ask caddy', waitIndex);
  const verifyIndex = source.indexOf('\nverify_live_release\n', restIndex);
  const releaseIndex = source.indexOf('printf \'%s\\n\' "$TARGET_SHA" >"$ROOT_DIR/current-release"', verifyIndex);

  assert.ok(buildIndex >= 0, "the exact target image must always be rebuilt");
  assert.ok(tagIndex > buildIndex, "the freshly built target must become the production candidate image");
  assert.ok(apiIndex > tagIndex, "the API must be recreated from the candidate image before other app services");
  assert.ok(waitIndex > apiIndex, "the API health gate must run immediately after the staged API rollout");
  assert.ok(diagnosticsIndex > waitIndex, "failed API health must capture diagnostics before rollback");
  assert.ok(restIndex > waitIndex, "workers and edge services must start only after API health succeeds");
  assert.ok(verifyIndex > restIndex, "full live verification must run after the application stack is healthy");
  assert.ok(releaseIndex > verifyIndex, "current-release must be written only after all live launch gates pass");

  assert.match(source, /docker inspect -f 'status=\{\{\.State\.Status\}\}.*health=/s);
  assert.match(source, /fetch\('http:\/\/127\.0\.0\.1:4100\/ready'\)/);
  assert.match(source, /Schema verification passed through migration 050/);
  assert.match(source, /PostgreSQL volumes were preserved/);
});
