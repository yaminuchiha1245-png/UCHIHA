import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI launch safety middleware is wired before product routes in production runtime", async () => {
  const [start, db, client] = await Promise.all([
    readFile(new URL("../src/start.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/db.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-bot-purchase.js", import.meta.url), "utf8")
  ]);

  for (const symbol of [
    "installAiProductActivationGuard",
    "installAiPurchaseIdempotencyLock",
    "installAiPurchaseConsent",
    "installAiBotWebhookAuthentication",
    "installAiBotOldWebhookCleanup",
    "installAiBotTokenOwnershipGuard"
  ]) assert.match(start, new RegExp(symbol));

  const routes = start.lastIndexOf("installAiBotProductRoutes");
  assert.ok(routes > 0);
  for (const symbol of [
    "installAiProductActivationGuard(app",
    "installAiPurchaseIdempotencyLock(app",
    "installAiPurchaseConsent(app",
    "installAiBotWebhookAuthentication(app",
    "installAiBotOldWebhookCleanup(app",
    "installAiBotTokenOwnershipGuard(app"
  ]) {
    assert.ok(start.indexOf(symbol) < routes, `${symbol} must be installed before AI product routes`);
  }

  assert.ok(
    start.indexOf("installAiBotOldWebhookCleanup(app") < start.indexOf("installAiBotTokenOwnershipGuard(app"),
    "old Telegram identity must be captured before the reservation guard mutates it"
  );
  assert.match(db, /version: "032_ai_bot_telegram_identity_unique"/);
  assert.match(client, /openAiCostAccepted: values\.openAiCostAccepted === "on"/);
});
