import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Uses only Node and installed project dependencies; no npm child processes or downloads.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tests = fs.readdirSync(path.join(root, "apps/api/test")).filter((file) => file.endsWith(".test.js")).sort().map((file) => `apps/api/test/${file}`);
const steps = [
  ["mobile-assets", ["scripts/build-mobile-assets.mjs", "all"]],
  // The legacy helper writes provider-mobile/www/src; the locked V1-83 app
  // deliberately uses provider-mobile/www/assets and must be rebuilt last.
  ["v183-mobile-assets", ["scripts/build-provider-v183.mjs", "mobile"]],
  ["static-check", ["scripts/check.mjs"]],
  ["v183-server-build", ["scripts/build-provider-v183.mjs", "server"]],
  ["fast-v183-build", ["scripts/build-fast-v183.mjs"]],
  ["fast-v183-check", ["scripts/check-fast-v183.mjs"]],
  ["tests", ["--test", "--test-reporter=spec", ...tests]],
  ["api-smoke", ["scripts/smoke.mjs"]],
  ["offline-preview-build", ["scripts/build-preview.mjs"]]
];
const report = { startedAt: new Date().toISOString(), nodeVersion: process.version, version: JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version,
  scope: "Local source and development assets only; no external integrations, browser/device QA or signed Android build.", passed: false, steps: [] };
const output = path.join(root, "docs/verification/latest-local-check.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
for (const [name, args] of steps) {
  console.log(`Checking ${name}…`);
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const step = { name, command: ["node", ...args], exitCode: result.status, durationMs: Date.now() - started, passed: result.status === 0 && !result.error };
  if (name === "tests") step.counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((key) => [key, Number(result.stdout?.match(new RegExp(`ℹ ${key} (\\d+)`))?.[1] ?? 0)]));
  report.steps.push(step);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  if (!step.passed) { console.error(result.error?.message ?? `${name} failed`); process.exit(1); }
}
report.passed = true; report.finishedAt = new Date().toISOString();
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log("Local verification completed. External launch gates remain separate.");
