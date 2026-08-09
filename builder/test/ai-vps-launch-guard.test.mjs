import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("VPS updater verifies AI runtime sources and schema before considering deployment healthy", async () => {
  const source = await readFile(new URL("../scripts/update-vps.sh", import.meta.url), "utf8");

  for (const critical of [
    "src/start.mjs",
    "src/db.mjs",
    "src/ai-product-activation-guard.mjs",
    "src/ai-bot-token-ownership-guard.mjs",
    "public/ai-bot-purchase.js"
  ]) assert.match(source, new RegExp(critical.replaceAll("/", "\\/")));

  assert.match(source, /032_ai_bot_telegram_identity_unique/);
  assert.match(source, /idx_ai_bot_instances_telegram_bot_id_unique/);
  assert.match(source, /apply_safe_migrations\(\)/);
  assert.match(source, /verify_ai_schema/);
  assert.match(source, /preflight_release_environment\(\)/);
  assert.match(source, /verify_running_release\(\)/);
  assert.match(source, /run --rm --no-deps api npm run verify:production/);
  assert.match(source, /npm run verify:production/);
  assert.match(source, /ai_product_sale_enabled/);
  assert.match(source, /npm run verify:ai-launch/);
  assert.ok(
    source.indexOf("verify_ai_schema") < source.lastIndexOf("npm run verify:ai-launch"),
    "AI schema must be validated before final launch readiness"
  );

  const unchanged = source.indexOf('if [[ "$TARGET_SHA" == "$PREVIOUS_SHA" ]]');
  const rebuild = source.indexOf('OLD_IMAGE_ID=', unchanged);
  const unchangedBlock = source.slice(unchanged, rebuild);
  assert.match(unchangedBlock, /render-vps-runtime\.sh/);
  assert.match(unchangedBlock, /apply_safe_migrations/);
  assert.match(unchangedBlock, /preflight_release_environment/);
  assert.match(unchangedBlock, /--force-recreate --remove-orphans api worker tls-ask caddy/);
  assert.ok(
    unchangedBlock.indexOf("apply_safe_migrations") < unchangedBlock.indexOf("preflight_release_environment"),
    "idempotent migrations and schema checks must complete before runtime preflight"
  );
  assert.ok(
    unchangedBlock.indexOf("preflight_release_environment") < unchangedBlock.indexOf("--force-recreate --remove-orphans api worker tls-ask caddy"),
    "new host environment must pass preflight before live services are recreated"
  );
  assert.match(unchangedBlock, /wait_for_api_health/);
  assert.match(unchangedBlock, /verify_running_release/);
  assert.match(unchangedBlock, /install_backup_schedule/);
  assert.doesNotMatch(unchangedBlock, /--force-recreate --remove-orphans postgres/);

  const migrationCalls = source.match(/apply_safe_migrations/g) || [];
  assert.ok(migrationCalls.length >= 3, "migration helper must cover unchanged and rebuilt release paths");
  const verifyCalls = source.match(/verify_running_release/g) || [];
  assert.ok(verifyCalls.length >= 3, "helper definition plus unchanged and rebuilt release paths must all exist");
  const preflightCalls = source.match(/preflight_release_environment/g) || [];
  assert.ok(preflightCalls.length >= 3, "preflight helper must be used before unchanged and rebuilt live replacement paths");
});
