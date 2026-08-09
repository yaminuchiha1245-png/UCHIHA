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
  assert.match(source, /npm run verify:production/);
  assert.match(source, /ai_product_sale_enabled/);
  assert.match(source, /npm run verify:ai-launch/);
  assert.ok(
    source.indexOf("verify_ai_schema") < source.lastIndexOf("npm run verify:ai-launch"),
    "AI schema must be validated before final launch readiness"
  );
});
