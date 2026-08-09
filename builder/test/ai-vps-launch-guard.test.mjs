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
  assert.match(source, /verify_ai_schema/);
  assert.match(source, /verify_running_release\(\)/);
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
  assert.match(unchangedBlock, /--force-recreate --remove-orphans api worker tls-ask caddy/);
  assert.match(unchangedBlock, /wait_for_api_health/);
  assert.match(unchangedBlock, /verify_running_release/);
  assert.match(unchangedBlock, /install_backup_schedule/);
  assert.doesNotMatch(unchangedBlock, /--force-recreate --remove-orphans postgres/);

  const verifyCalls = source.match(/verify_running_release/g) || [];
  assert.ok(verifyCalls.length >= 3, "helper definition plus unchanged and rebuilt release paths must all exist");
});
