import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { hashInstallationId } from "../src/security.js";
import { DEMO } from "../src/seed.js";
import { createTenant, devSession, headers, setup } from "./helpers.js";

const BOT_TOKEN = "123456:abcdefghijklmnopqrstuvwxyz123456";
const ORIGINAL = "11111111-1111-4111-8111-111111111111";
const MINIAPP = "22222222-2222-4222-8222-222222222222";
const SECOND = "33333333-3333-4333-8333-333333333333";
function signedTelegram(userId = 9123456789) {
  const data = { auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: "ISP Owner" }) };
  const message = Object.entries(data).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join("\n");
  const key = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", key).update(message).digest("hex");
  return new URLSearchParams({ ...data, hash }).toString();
}
function appHeaders(token, installation, tenant = DEMO.tenantId) {
  return headers(token, tenant, { "x-installation-id": installation, "x-uchiha-platform": "web" });
}
async function providerLogin(env, installationId) {
  const login = await env.app.inject({ method: "POST", url: "/api/v1/auth/dev",
    headers: { "x-installation-id": installationId, "x-uchiha-platform": "web" },
    payload: { mode: "provider" } });
  assert.equal(login.statusCode, 200, login.body);
  return login.json().data.token;
}
async function link(env, bearer, originalInstallation, tenant = DEMO.tenantId) {
  const issue = await env.app.inject({ method: "POST", url: "/api/v1/auth/telegram-link",
    headers: appHeaders(bearer, originalInstallation, tenant), payload: {} });
  assert.equal(issue.statusCode, 200, issue.body);
  const claim = await env.app.inject({ method: "POST", url: "/api/v1/auth/telegram-link/claim",
    payload: { initData: signedTelegram(), code: issue.json().data.code } });
  assert.equal(claim.statusCode, 200, claim.body);
}
async function telegramLogin(env, installation) {
  const response = await env.app.inject({ method: "POST", url: "/api/v1/auth/telegram",
    headers: { "x-installation-id": installation, "x-uchiha-platform": "web" },
    payload: { initData: signedTelegram() } });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data;
}

test("a provider with a redeemed app links Telegram and opens an activated Mini App for their own tenant", async t => {
  const env = await setup({ telegramBotToken: BOT_TOKEN, requireInstallationBinding: true });
  t.after(() => env.close());
  const platform = await devSession(env.app, "owner");
  const token = await providerLogin(env, ORIGINAL);
  const issue = await env.app.inject({ method: "POST", url: "/api/v1/owner/activation-codes",
    headers: { ...headers(platform.token, null), "idempotency-key": "telegram-original-install-activation" },
    payload: {
      tenantId: DEMO.tenantId, productId: "prd_starter", durationDays: 30,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      issuedToName: "Provider", issuedToEmail: DEMO.email,
      issuedToPhone: "+963900000001", note: "Telegram link", reason: "Authorized provider installation"
    } });
  assert.equal(issue.statusCode, 201, issue.body);
  const redeem = await env.app.inject({ method: "POST", url: "/api/v1/subscriptions/redeem",
    headers: { ...appHeaders(token, ORIGINAL), "idempotency-key": "telegram-redeem-original" },
    payload: { activationCode: issue.json().data.code } });
  assert.equal(redeem.statusCode, 200, redeem.body);
  await link(env, token, ORIGINAL);
  const signed = await telegramLogin(env, MINIAPP);
  assert.equal(signed.tenantId, DEMO.tenantId);
  const me = await env.app.inject({ method: "GET", url: "/api/v1/auth/me",
    headers: appHeaders(signed.token, MINIAPP) });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().data.tenantId, DEMO.tenantId);
  assert.equal(me.json().data.canWrite, true);
  assert.equal(me.json().data.installationBound, true);
  const telegramInstallation = await env.db.get(
    "SELECT tenant_id,metadata_json,activation_code_id FROM app_installations WHERE installation_hash=?",
    [hashInstallationId(MINIAPP)]);
  assert.equal(telegramInstallation.tenant_id, DEMO.tenantId);
  assert.equal(telegramInstallation.activation_code_id, null);
  assert.equal(JSON.parse(telegramInstallation.metadata_json).telegramDerived, true);
  await env.db.run("UPDATE app_installations SET status='blocked' WHERE installation_hash=?",
    [hashInstallationId(ORIGINAL)]);
  const denied = await env.app.inject({ method: "GET", url: "/api/v1/auth/me",
    headers: appHeaders(signed.token, MINIAPP) });
  assert.equal(denied.statusCode, 403, denied.body);
});

test("a signed member of a second provider enters that provider, not their first membership", async t => {
  const env = await setup({ telegramBotToken: BOT_TOKEN, requireInstallationBinding: true });
  t.after(() => env.close());
  const secondTenant = await createTenant(env.db, "telegram-secondary");
  const now = new Date().toISOString();
  await env.db.run(`INSERT INTO memberships (id,tenant_id,user_id,role,status,created_at,updated_at)
    VALUES ('mem_second_telegram',?,?, 'owner','active',?,?)`,
    [secondTenant, DEMO.userId, now, now]);
  const token = await providerLogin(env, SECOND);
  await link(env, token, SECOND, secondTenant);
  const login = await telegramLogin(env, MINIAPP);
  assert.equal(login.tenantId, secondTenant);
  const correct = await env.app.inject({ method: "GET", url: "/api/v1/auth/me",
    headers: appHeaders(login.token, MINIAPP, secondTenant) });
  assert.equal(correct.statusCode, 200, correct.body);
  assert.equal(correct.json().data.tenantId, secondTenant);
  assert.equal(correct.json().data.installationBound, false);
  assert.equal(correct.json().data.canWrite, false);
  const wrong = await env.app.inject({ method: "GET", url: "/api/v1/auth/me",
    headers: appHeaders(login.token, MINIAPP, DEMO.tenantId) });
  assert.equal(wrong.statusCode, 403, wrong.body);
});
