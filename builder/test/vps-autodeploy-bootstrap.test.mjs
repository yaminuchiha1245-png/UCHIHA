import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("VPS auto-deploy bootstraps the updater from the remote branch before execution", async () => {
  const source = await read("../scripts/vps-autodeploy.sh");
  const fetchIndex = source.indexOf("git fetch --prune origin");
  const targetIndex = source.indexOf('TARGET_SHA="$(git rev-parse "origin/$BRANCH")"');
  const showIndex = source.indexOf('git show "${TARGET_SHA}:builder/scripts/update-vps.sh"');
  const execIndex = source.indexOf('exec env UCHIHA_ROOT_DIR="$ROOT_DIR" UCHIHA_REPO_DIR="$REPO_DIR" bash "$TMP_UPDATE"');

  assert.ok(fetchIndex >= 0, "remote branch must be fetched");
  assert.ok(targetIndex > fetchIndex, "target SHA must be resolved after fetch");
  assert.ok(showIndex > targetIndex, "the updater must be read from the fetched target commit");
  assert.ok(execIndex > showIndex, "the fetched updater must be executed only after it is materialized");
  assert.match(source, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(source, /git diff --quiet && git diff --cached --quiet/);
  assert.match(source, /git branch --show-current/);
  assert.doesNotMatch(source, /UPDATE_SCRIPT=.*repo\/builder\/scripts\/update-vps\.sh/);
});
