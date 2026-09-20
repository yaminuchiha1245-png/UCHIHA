import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dockerfile = new URL("../Dockerfile", import.meta.url);
const syntaxChecker = new URL("../scripts/check-syntax.mjs", import.meta.url);

test("production docker build fails closed on syntax lint tests and build verification", async () => {
  const source = await readFile(dockerfile, "utf8");
  assert.match(source, /FROM dependencies AS verification/);
  assert.match(source, /COPY test \.\/test/);
  assert.match(source, /npm run check/);
  assert.match(source, /npm run lint/);
  assert.match(source, /npm test/);
  assert.match(source, /npm run build/);
  const verify = source.indexOf("FROM dependencies AS verification");
  const runtime = source.indexOf("FROM node:24-alpine AS runtime");
  assert.ok(verify >= 0 && runtime > verify, "verification stage must run before the runtime image is created");
});

test("syntax gate decompresses and checks bundled JavaScript runtimes before Docker can advance", async () => {
  const source = await readFile(syntaxChecker, "utf8");
  assert.match(source, /gunzipSync/);
  assert.match(source, /\.js\.gz/);
  assert.match(source, /\.mjs\.gz/);
  assert.match(source, /spawnSync\(process\.execPath, \["--check", "-"\]/);
  assert.match(source, /Failed to read\/decompress/);
});

test("runtime image prunes development dependencies after verification", async () => {
  const source = await readFile(dockerfile, "utf8");
  assert.match(source, /FROM dependencies AS production-dependencies/);
  assert.match(source, /npm prune --omit=dev/);
  assert.match(source, /COPY --from=production-dependencies --chown=node:node \/app\/node_modules \.\/node_modules/);
  assert.match(source, /USER node/);
  assert.match(source, /CMD \["node", "src\/start\.mjs"\]/);
});
