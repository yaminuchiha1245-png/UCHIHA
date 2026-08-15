import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("VPS auto-deploy fetches the remote target first and stays lightweight when production is current", async () => {
  const source = await read("../scripts/vps-autodeploy.sh");
  const fetchIndex = source.indexOf("git fetch --prune origin");
  const targetIndex = source.indexOf('TARGET_SHA="$(git rev-parse "origin/$BRANCH")"');
  const releaseIndex = source.indexOf('CURRENT_RELEASE="$(cat "$ROOT_DIR/current-release"');
  const showIndex = source.indexOf('git show "${TARGET_SHA}:builder/scripts/update-vps.sh"');
  const execIndex = source.indexOf('exec env UCHIHA_ROOT_DIR="$ROOT_DIR" UCHIHA_REPO_DIR="$REPO_DIR" bash "$TMP_UPDATE"');

  assert.ok(fetchIndex >= 0, "remote branch must be fetched");
  assert.ok(targetIndex > fetchIndex, "target SHA must be resolved after fetch");
  assert.ok(releaseIndex > targetIndex, "successful release marker must be read after the target SHA");
  assert.match(source, /TARGET_SHA" == "\$LOCAL_SHA" && "\$CURRENT_RELEASE" == "\$TARGET_SHA"/);
  assert.ok(showIndex > releaseIndex, "the updater should only be materialized when deployment work is needed");
  assert.ok(execIndex > showIndex, "the fetched updater must be executed only after it is materialized");
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

test("release updater self-heals the 30-second timer before backup, build or audit work can fail", async () => {
  const source = await read("../scripts/update-vps.sh");
  const functionIndex = source.indexOf("install_fast_autodeploy_runtime() {");
  const callIndex = source.indexOf("install_fast_autodeploy_runtime", functionIndex + 1);
  const backupIndex = source.indexOf('BACKUP_FILE="$(create_verified_backup)"');

  assert.ok(functionIndex >= 0, "fast auto-deploy installer must exist");
  assert.ok(callIndex > functionIndex, "fast auto-deploy installer must be called");
  assert.ok(backupIndex > callIndex, "timer self-healing must happen before backup verification");
  assert.match(source, /git -C "\$REPO_DIR" show "\$\{TARGET_SHA\}:builder\/scripts\/vps-autodeploy\.sh"/);
  assert.match(source, /install -m 700 "\$tmp_wrapper" \/usr\/local\/sbin\/uchiha-autodeploy/);
  assert.match(source, /OnUnitInactiveSec=30s/);
  assert.match(source, /systemctl enable --now uchiha-autodeploy\.timer/);
});

test("runtime rendering self-heals the installed systemd auto-deploy wrapper from the checked-out release", async () => {
  const renderer = await read("../scripts/render-vps-runtime.sh");
  assert.match(renderer, /AUTODEPLOY_SOURCE="\$REPO_DIR\/builder\/scripts\/vps-autodeploy\.sh"/);
  assert.match(renderer, /install -m 700 "\$AUTODEPLOY_SOURCE" \/usr\/local\/sbin\/uchiha-autodeploy/);
  assert.match(renderer, /EUID/);
});
