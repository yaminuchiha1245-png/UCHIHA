import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/bootstrap.mjs", import.meta.url);

test("production bootstrap entrypoint never runs demo/development seedEnvironment", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /const persistentProduction = config\.nodeEnv === "production"/);
  assert.match(source, /const result = persistentProduction \? null : await seedEnvironment\(db, config\)/);
  assert.match(source, /productionBootstrap/);
  assert.match(source, /ensureProductionShowcase\(db, config\)/);
  assert.doesNotMatch(source, /const result = await seedEnvironment\(db, config\)/);
});
