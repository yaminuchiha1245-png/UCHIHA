import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("VPS updater gates the exact image on backup, migration 050, production readiness and AI readiness", async () => {
  const source = await readFile(new URL("../scripts/update-vps.sh", import.meta.url), "utf8");

  const backupIndex = source.indexOf('BACKUP_FILE="$(create_verified_backup)"');
  const restoreIndex = source.indexOf('restore_test "$BACKUP_FILE"', backupIndex);
  const buildIndex = source.indexOf('docker build --pull -t "uchiha-builder:$TARGET_SHA" builder', restoreIndex);
  const tagIndex = source.indexOf('docker tag "uchiha-builder:$TARGET_SHA" uchiha-builder:production', buildIndex);
  const renderIndex = source.indexOf('bash "$REPO_DIR/builder/scripts/render-vps-runtime.sh"', tagIndex);
  const migrationIndex = source.indexOf("\napply_migrations_and_preflight\n", renderIndex);
  const apiIndex = source.indexOf('"${COMPOSE[@]}" up -d --force-recreate --no-deps api', migrationIndex);
  const healthIndex = source.indexOf('if ! wait_for_api_health; then', apiIndex);
  const restIndex = source.indexOf('"${COMPOSE[@]}" up -d --force-recreate --remove-orphans worker tls-ask caddy', healthIndex);
  const verifyIndex = source.indexOf("\nverify_live_release\n", restIndex);
  const releaseIndex = source.indexOf('printf \'%s\\n\' "$TARGET_SHA" >"$ROOT_DIR/current-release"', verifyIndex);

  assert.ok(backupIndex >= 0, "a verified PostgreSQL backup must precede release work");
  assert.ok(restoreIndex > backupIndex, "the backup must pass a restore test before image build");
  assert.ok(buildIndex > restoreIndex, "the exact target image must be built only after backup verification");
  assert.ok(tagIndex > buildIndex, "the exact target image must become the production candidate");
  assert.ok(renderIndex > tagIndex, "runtime configuration must be rendered from the target after the image is pinned");
  assert.ok(migrationIndex > renderIndex, "migrations and production preflight must run before live API replacement");
  assert.ok(apiIndex > migrationIndex, "the API must be staged only after migration/preflight gates pass");
  assert.ok(healthIndex > apiIndex, "the staged API must become healthy before the rest of the stack");
  assert.ok(restIndex > healthIndex, "worker and edge services must start only after API health succeeds");
  assert.ok(verifyIndex > restIndex, "full production/AI/smoke verification must run after the full stack is up");
  assert.ok(releaseIndex > verifyIndex, "current-release must be written only after every launch gate passes");

  assert.match(source, /verify_schema_050\(\)/);
  assert.match(source, /050_subscription_review_revalidation_guard/);
  assert.match(source, /Migration 050 is missing/);
  assert.match(source, /apply_migrations_and_preflight\(\)/);
  assert.match(source, /Applying migrations twice to verify idempotency/);
  assert.ok((source.match(/run --rm api npm run bootstrap/g) || []).length >= 2, "migrations must be applied twice to prove idempotency");
  assert.match(source, /run --rm --no-deps api npm run verify:production/);
  assert.match(source, /ai_product_sale_enabled\(\)/);
  assert.match(source, /npm run verify:ai-launch/);
  assert.match(source, /verify_live_release\(\)/);
  assert.match(source, /exec -T api npm run verify:production/);
  assert.match(source, /smoke-vps\.sh/);
  assert.match(source, /launch-audit\.sh/);
  assert.match(source, /PostgreSQL volumes were preserved/);
  assert.doesNotMatch(source, /--force-recreate --remove-orphans postgres/);
});
