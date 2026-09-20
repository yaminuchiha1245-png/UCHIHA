import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const startUrl = new URL("../src/start.mjs", import.meta.url);

test("launch lifecycle hooks are installed before Fastify starts listening", async () => {
  const source = await readFile(startUrl, "utf8");
  const listen = source.indexOf("await app.listen(");
  assert.ok(listen > 0, "start.mjs must start Fastify explicitly");
  for (const marker of [
    "installLaunchReadinessHttp(app, { db, config });",
    "installLaunchAssetInjection(app);",
    "installHttpHardening(app, config);"
  ]) {
    const position = source.indexOf(marker);
    assert.ok(position > 0, `${marker} must remain installed`);
    assert.ok(position < listen, `${marker} must be installed before app.listen()`);
  }
});
