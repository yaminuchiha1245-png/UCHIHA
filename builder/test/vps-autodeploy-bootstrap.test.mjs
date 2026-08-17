import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("VPS auto-deploy fetches the exact target, monitors it, and retries only after a new commit", async () => {
  const source = await read("../scripts/vps-autodeploy.sh");
  const fetchIndex = source.indexOf("git fetch --prune origin");
  const targetIndex = source.indexOf('TARGET_SHA="$(git rev-parse "origin/$BRANCH")"');
  const releaseIndex = source.indexOf('CURRENT_RELEASE="$(cat "$ROOT_DIR/current-release"');
  const showIndex = source.indexOf('git show "${TARGET_SHA}:builder/scripts/update-vps.sh"');
  const launchIndex = source.indexOf('bash "$TMP_UPDATE" &');
  const waitIndex = source.indexOf('wait "$UPDATE_PID"');
  const reportIndex = source.indexOf('bash "$TMP_REPORT" "$TARGET_SHA" "$UPDATE_STATUS"');

  assert.ok(fetchIndex >= 0, "remote branch must be fetched");
  assert.ok(targetIndex > fetchIndex, "target SHA must be resolved after fetch");
  assert.ok(releaseIndex > targetIndex, "successful release marker must be read after the target SHA");
  assert.match(source, /TARGET_SHA" == "\$LOCAL_SHA" && "\$CURRENT_RELEASE" == "\$TARGET_SHA"/);
  assert.ok(showIndex > releaseIndex, "the updater should only be materialized when deployment work is needed");
  assert.ok(launchIndex > showIndex, "the target updater must start only after it is materialized");
  assert.ok(waitIndex > launchIndex, "the wrapper must wait for the monitored updater");
  assert.ok(reportIndex > waitIndex, "a failed monitored rollout must be reported after the updater exits");

  assert.match(source, /UPDATE_PID=\$!/);
  assert.match(source, /monitor_target_api &/);
  assert.match(source, /MONITOR_PID=\$!/);
  assert.match(source, /FAILED_RELEASE_FILE="\$ROOT_DIR\/failed-release"/);
  assert.match(source, /FAILED_RELEASE" == "\$TARGET_SHA"/);
  assert.match(source, /git show "\$\{TARGET_SHA\}:builder\/scripts\/report-vps-failure\.sh"/);
  assert.match(source, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(source, /git diff --quiet && git diff --cached --quiet/);
  assert.match(source, /git branch --show-current/);
  assert.doesNotMatch(source, /UPDATE_SCRIPT=.*repo\/builder\/scripts\/update-vps\.sh/);
});

test("auto-deploy cadence is 30 seconds instead of the retired ten-minute polling window", async () => {
  const [wrapper, installer] = await Promise.all([
    read("../scripts/vps-autodeploy.sh"),
    read("../scripts/install-vps-automation.sh")
  ]);
  for (const source of [wrapper, installer]) {
    assert.match(source, /OnUnitInactiveSec=30s/);
    assert.match(source, /AccuracySec=5s/);
    assert.doesNotMatch(source, /OnUnitActiveSec=10min/);
    assert.doesNotMatch(source, /RandomizedDelaySec=60/);
  }
});

test("release updater refreshes target and installed auto-deploy runtime before backup or rollout", async () => {
  const source = await read("../scripts/update-vps.sh");
  const refreshTargetIndex = source.indexOf("\nrefresh_target\n");
  const refreshRuntimeIndex = source.indexOf("\nrefresh_autodeploy_runtime\n", refreshTargetIndex + 1);
  const backupIndex = source.indexOf('BACKUP_FILE="$(create_verified_backup)"');

  assert.ok(refreshTargetIndex >= 0, "the exact remote target must be refreshed before release work");
  assert.ok(refreshRuntimeIndex > refreshTargetIndex, "the installed auto-deploy wrapper must be refreshed from that target");
  assert.ok(backupIndex > refreshRuntimeIndex, "wrapper refresh must happen before backup/build/audit work can fail");
  assert.match(source, /git show "\$\{TARGET_SHA\}:builder\/scripts\/vps-autodeploy\.sh" >"\$tmp"/);
  assert.match(source, /install -m 700 "\$tmp" \/usr\/local\/sbin\/uchiha-autodeploy/);
  assert.match(source, /systemctl enable --now uchiha-autodeploy\.timer/);
  assert.match(source, /LIVE_SHA="\$\(cat "\$ROOT_DIR\/current-release"/);
});

test("runtime rendering self-heals the installed systemd auto-deploy wrapper from the checked-out release", async () => {
  const renderer = await read("../scripts/render-vps-runtime.sh");
  assert.match(renderer, /AUTODEPLOY_SOURCE="\$REPO_DIR\/builder\/scripts\/vps-autodeploy\.sh"/);
  assert.match(renderer, /install -m 700 "\$AUTODEPLOY_SOURCE" \/usr\/local\/sbin\/uchiha-autodeploy/);
  assert.match(renderer, /EUID/);
});
