import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { createUserSession, devSession, headers, setup } from "./helpers.js";

const botToken = "123456:abcdefghijklmnopqrstuvwxyz123456";
const linkUrl = "/api/v1/auth/telegram-link";
function initData(userId = "1234567890") {
  const payload = { auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: Number(userId), first_name: "ISP member" }) };
  const message = Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(message).digest("hex");
  return new URLSearchParams({ ...payload, hash }).toString();
}
async function claim(app, init, code) {
  return app.inject({ method: "POST", url: linkUrl + "/claim", payload: { initData: init, code } });
}

test("existing provider issues single-use 15-minute Telegram code and links exactly that member", async t => {
  const env = await setup({ telegramBotToken: botToken }); t.after(() => env.close());
  const provider = await devSession(env.app, "provider");
  const issued = await env.app.inject({ method: "POST", url: linkUrl,
    headers: headers(provider.token), payload: {} });
  assert.equal(issued.statusCode, 200, issued.body);
  assert.match(issued.headers["cache-control"], /no-store/);
  const code = issued.json().data.code;
  assert.match(code, /^UCHL-[A-Za-z0-9_-]{43}$/);
  assert.ok(Date.parse(issued.json().data.expiresAt) - Date.now() <= 15 * 60_000);
  const stored = await env.db.get("SELECT code_hash,used_at FROM telegram_link_challenges");
  assert.notEqual(stored.code_hash, code);
  assert.equal(stored.used_at, null);
  assert.equal((await claim(env.app, initData(), code)).statusCode, 200);
  assert.equal((await claim(env.app, initData("1234567891"), code)).statusCode, 403);
  const login = await env.app.inject({ method: "POST", url: "/api/v1/auth/telegram",
    payload: { initData: initData() } });
  assert.equal(login.statusCode, 200, login.body);
  const me = await env.app.inject({ method: "GET", url: "/api/v1/auth/me",
    headers: headers(login.json().data.token) });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().data.tenantId, "ten_demo_isp");
  assert.equal(me.json().data.role, "owner");
});
test("a link expires, a replacement invalidates the older code and invalid Telegram HMAC is rejected", async t => {
  const env = await setup({ telegramBotToken: botToken }); t.after(() => env.close());
  const provider = await devSession(env.app, "provider");
  const issue = async () => (await env.app.inject({ method: "POST", url: linkUrl,
    headers: headers(provider.token), payload: {} })).json().data.code;
  const first = await issue(), second = await issue();
  assert.equal((await claim(env.app, initData(), first)).statusCode, 403);
  assert.equal((await claim(env.app, initData().replace(/hash=[a-f0-9]{64}/, "hash=" + "0".repeat(64)), second)).statusCode, 401);
  await env.db.run("UPDATE telegram_link_challenges SET expires_at=?", [new Date(Date.now() - 60_000).toISOString()]);
  assert.equal((await claim(env.app, initData(), second)).statusCode, 403);
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM telegram_accounts")).total, 0);
});
test("member cannot link another account's challenge and an already-bound Telegram ID cannot be hijacked", async t => {
  const env = await setup({ telegramBotToken: botToken }); t.after(() => env.close());
  const provider = await devSession(env.app, "provider");
  const first = (await env.app.inject({ method: "POST", url: linkUrl,
    headers: headers(provider.token), payload: {} })).json().data.code;
  assert.equal((await claim(env.app, initData(), first)).statusCode, 200);
  const second = await createUserSession(env.db, env.config, { role: "admin" });
  const newCode = (await env.app.inject({ method: "POST", url: linkUrl,
    headers: headers(second.token), payload: {} })).json().data.code;
  assert.equal((await claim(env.app, initData(), newCode)).statusCode, 409);
  assert.equal((await claim(env.app, initData("1234567892"), newCode)).statusCode, 200);
  const linked = await env.db.all("SELECT telegram_user_id,user_id FROM telegram_accounts ORDER BY telegram_user_id");
  assert.equal(linked.length, 2);
  assert.notEqual(linked[0].user_id, linked[1].user_id);
});
