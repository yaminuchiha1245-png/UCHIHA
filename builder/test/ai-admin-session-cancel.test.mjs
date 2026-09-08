import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Telegram /admin and admin:home cancel any pending admin input session", async () => {
  const source = await readFile(new URL("../src/ai-telegram-admin.mjs", import.meta.url), "utf8");

  assert.match(
    source,
    /if \(messageText === "\/admin"\)[\s\S]*?await clearSession\(db, instance\.id, fromId\)/,
    "/admin must clear stale input state before rendering the admin home"
  );
  assert.match(
    source,
    /if \(data === "admin:home"\)[\s\S]*?await clearSession\(db, instance\.id, fromId\)/,
    "admin:home must act as a real cancel action for pending inputs"
  );
  assert.match(source, /لإلغاء الإدخال أرسل \/cancel/);
  assert.match(source, /if \(messageText === "\/cancel"\)[\s\S]*?await clearSession/);
});
