import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scripts = [
  "../scripts/update-vps.sh",
  "../scripts/vps-autodeploy.sh",
  "../scripts/smoke-vps.sh",
  "../scripts/launch-audit.sh",
  "../scripts/deployment-data-integrity.sh",
  "../scripts/render-vps-runtime.sh"
].map((relative) => fileURLToPath(new URL(relative, import.meta.url)));

test("VPS deployment shell scripts pass bash syntax validation before image build can succeed", () => {
  const result = spawnSync("bash", ["-n", ...scripts], { encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `bash -n failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
  );
});
