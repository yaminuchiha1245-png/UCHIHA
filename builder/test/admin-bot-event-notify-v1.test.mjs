import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/admin-bot-event-notify-v1.mjs", import.meta.url), "utf8");
const start = readFileSync(new URL("../src/start.mjs", import.meta.url), "utf8");


test("event notifications are installed in the Builder runtime", () => {
  assert.match(start, /installAdminBotEventNotifyV1/);
  assert.match(start, /installAdminBotEventNotifyV1\(app, \{ db, config \}\)/);
});


test("customer, support and paid-wallet routes are captured without changing their response", () => {
  assert.match(source, /customerRegistered:/);
  assert.match(source, /supportCreated:/);
  assert.match(source, /supportMessage:/);
  assert.match(source, /walletOrder:/);
  assert.match(source, /customers\\\/register/);
  assert.match(source, /orders\\\/wallet/);
  assert.match(source, /body\.duplicate !== true/);
  assert.match(source, /app\.addHook\("onSend"/);
  assert.match(source, /return responsePayload/);
});


test("Telegram delivery happens after the customer HTTP response and is best effort", () => {
  assert.match(source, /app\.addHook\("onResponse"/);
  assert.match(source, /await dispatchEvent/);
  assert.match(source, /Telegram admin event notification failed after response/);
  assert.match(source, /decryptSecret/);
  assert.match(source, /new TelegramGateway/);
});


test("notifications deep-link to the existing admin bot management callbacks", () => {
  assert.match(source, /adm4:customer:/);
  assert.match(source, /adm5:thread:/);
  assert.match(source, /adm:order:/);
  assert.match(source, /adm:customers/);
  assert.match(source, /adm5:threads/);
  assert.match(source, /adm:orders/);
});


test("event dispatch is scoped to the active store admin bot", () => {
  assert.match(source, /purpose='admin' AND status='active'/);
  assert.match(source, /telegramOwnerId/);
  assert.match(source, /tenant_id=\$1 AND store_id=\$2/);
  assert.match(source, /order\.payment_status !== "paid"/);
});
