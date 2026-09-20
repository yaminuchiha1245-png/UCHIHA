import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scripts = [
  "../scripts/update-vps.sh",
  "../scripts/vps-autodeploy.sh",
  "../scripts/report-vps-failure.sh",
  "../scripts/smoke-vps.sh",
  "../scripts/launch-audit.sh",
  "../scripts/deployment-data-integrity.sh",
  "../scripts/render-vps-runtime.sh"
].map((relative) => fileURLToPath(new URL(relative, import.meta.url)));
const autodeployPath = fileURLToPath(new URL("../scripts/vps-autodeploy.sh", import.meta.url));
const smokePath = fileURLToPath(new URL("../scripts/smoke-vps.sh", import.meta.url));

test("VPS deployment shell scripts pass bash syntax validation before image build can succeed", () => {
  const result = spawnSync("bash", ["-n", ...scripts], { encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `bash -n failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
});

test("VPS deployment remains autonomous and self-heals polling after a legacy wrapper exits", () => {
  const autodeploy = readFileSync(autodeployPath, "utf8");
  const smoke = readFileSync(smokePath, "utf8");

  assert.match(autodeploy, /OnUnitInactiveSec=30s/);
  assert.match(autodeploy, /systemctl enable --now uchiha-autodeploy\.timer/);
  assert.doesNotMatch(autodeploy, /disable --now uchiha-autodeploy\.timer/);
  assert.match(smoke, /schedule_autodeploy_timer_self_heal/);
  assert.match(smoke, /systemd-run --quiet/);
  assert.match(smoke, /--on-active=20s/);
  assert.match(smoke, /enable --now uchiha-autodeploy\.timer/);
});
