import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyTelegramInitData } from "../src/telegram-auth.js";
import { setup, headers } from "./helpers.js";
import { DEMO } from "../src/seed.js";

const TOKEN = "8120730186:1234567890_abcdefghijklmnopqrstuvwxyz";
const now = 1_790_000_000_000;

function signedData(userId = 123456789, time = Math.floor(now / 1000), extra = {}) {
  const fields = new URLSearchParams({
    auth_date: String(time),
    query_id: "test_query",
    user: JSON.stringify({ id: userId, first_name: "Provider" }),
    ...extra,
  });
  const checkString = [...fields.entries()].sort(([a],[b]) => a.localeCompare(b))
    .map(([key,value]) => key + "=" + value).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  fields.set("hash", hash);
  return fields.toString();
}

test("Telegram HMAC accepts only fresh untampered and nonduplicated initData", () => {
  assert.equal(verifyTelegramInitData(signedData(), TOKEN, { now }).id, "123456789");
  assert.throws(() => verifyTelegramInitData(signedData(), "", { now }));
  assert.throws(() => verifyTelegramInitData(signedData(), TOKEN, { now: now + 700_000 }));
  assert.throws(() => verifyTelegramInitData(signedData(), TOKEN, { now: now - 70_000 }));
  assert.throws(() => verifyTelegramInitData(signedData() + "&user=%7B%7D", TOKEN, { now }));
  assert.throws(() => verifyTelegramInitData(signedData().replace("Provider", "Attacker"), TOKEN, { now }));
  assert.throws(() => verifyTelegramInitData(signedData(0), TOKEN, { now }));
  assert.throws(() => verifyTelegramInitData(signedData(), TOKEN.replace("abc", "XYZ"), { now }));
});

test("Telegram-authenticated provider is tenant-scoped and revocation ends existing sessions", async () => {
  const { app, db, close } = await setup({ telegramBotToken: TOKEN, requireInstallationBinding: false });
  try {
    const user = await db.get("SELECT id FROM users WHERE email=?", [DEMO.email]);
    assert.ok(user?.id);
    const timestamp = new Date().toISOString();
    const id = "123456789";
    const payload = signedData(Number(id), Math.floor(Date.now() / 1000));
    const unattached = await app.inject({method:"POST",url:"/api/v1/auth/telegram",payload:{initData:payload}});
    assert.equal(unattached.statusCode, 403);
    const badPayload = await app.inject({method:"POST",url:"/api/v1/auth/telegram",payload:{initData:payload.replace("Provider","Impostor")}});
    assert.equal(badPayload.statusCode, 401);
    await db.run(
      "INSERT INTO telegram_accounts (telegram_user_id,user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      [id, user.id, timestamp, timestamp]
    );
    const login = await app.inject({method:"POST",url:"/api/v1/auth/telegram",payload:{initData:payload}});
    assert.equal(login.statusCode, 200, login.body);
    const token = login.json().data.token;
    assert.ok(token);
    assert.equal(login.headers["cache-control"], "no-store");
    const me = await app.inject({method:"GET",url:"/api/v1/auth/me",headers:headers(token)});
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.json().data.user.id, user.id);
    const catalog = await app.inject({method:"GET",url:"/api/v1/subscribers",headers:headers(token)});
    assert.equal(catalog.statusCode, 200, catalog.body);
    await db.run("UPDATE telegram_accounts SET status='revoked' WHERE telegram_user_id=?", [id]);
    const revoked = await app.inject({method:"GET",url:"/api/v1/auth/me",headers:headers(token)});
    assert.equal(revoked.statusCode, 401);
    const loginAgain = await app.inject({method:"POST",url:"/api/v1/auth/telegram",payload:{initData:payload}});
    assert.equal(loginAgain.statusCode, 403);
  } finally { await close(); }
});

test("Telegram identity does not create a user or provider membership implicitly", async () => {
  const { app, db, close } = await setup({ telegramBotToken: TOKEN });
  try {
    const initial = await db.get("SELECT count(*) as n FROM users");
    const denied = await app.inject({
      method:"POST",url:"/api/v1/auth/telegram",
      payload:{initData:signedData(998877665, Math.floor(Date.now()/1000))}
    });
    assert.equal(denied.statusCode,403);
    const after = await db.get("SELECT count(*) as n FROM users");
    assert.equal(after.n, initial.n);
  } finally { await close(); }
});
