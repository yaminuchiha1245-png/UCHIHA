import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("per-user AI protection counts failed and completed provider attempts", async () => {
  const source = await readFile(new URL("../src/ai-bot-usage-limits.mjs", import.meta.url), "utf8");
  assert.match(source, /COUNT\(\*\)::int AS requests/);
  assert.match(source, /COUNT\(\*\) FILTER \(WHERE request_kind='image'\)::int AS images/);
  const enforcement = source.slice(source.indexOf("async function enforcePromptLimit"));
  assert.doesNotMatch(enforcement, /COUNT\(\*\) FILTER \(WHERE status='completed'\)::int AS requests/);
  assert.match(enforcement, /محاولة/);
});
