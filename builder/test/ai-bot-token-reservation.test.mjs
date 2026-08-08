import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Telegram bot identity is reserved before webhook rotation and released on failed provisioning", async () => {
  const [guard, migration] = await Promise.all([
    readFile(new URL("../src/ai-bot-token-ownership-guard.mjs", import.meta.url), "utf8"),
    readFile(new URL("../migrations/032_ai_bot_telegram_identity_unique.sql", import.meta.url), "utf8")
  ]);

  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_bot_instances_telegram_bot_id_unique/);
  assert.match(migration, /WHERE telegram_bot_id IS NOT NULL/);
  assert.match(guard, /request\.uchihaAiBotReservation/);
  assert.match(guard, /error\?\.code === "23505"/);
  assert.match(guard, /app\.addHook\("onResponse"/);
  assert.match(guard, /token_ciphertext IS NULL/);
  assert.ok(
    guard.indexOf("SET telegram_bot_id=$3") < guard.indexOf("request.uchihaAiBotReservation"),
    "database identity reservation must happen before handing control to the product route"
  );
});
