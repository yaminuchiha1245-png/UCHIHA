import assert from "node:assert/strict";
import test from "node:test";
import { signPayload } from "../src/security.js";
import { createUserSession, devSession, headers, setup } from "./helpers.js";

const reason = "Provision a dedicated agent for the provider network";
const issueUrl = "/api/v1/radius/credential";
function signed(secret, payload) {
  const raw = JSON.stringify(payload), timestamp = String(Math.floor(Date.now() / 1000));
  return { raw, headers: { "content-type": "application/json", "x-uchiha-timestamp": timestamp,
    "x-uchiha-signature": signPayload(secret, timestamp, raw) } };
}
function claim(nonce) {
  return { agentId: "provider-agent-01", nonce,
    nonceExpiresAt: new Date(Date.now() + 90000).toISOString() };
}
function beat(nonce) {
  return { ...claim(nonce), name: "First real agent", siteId: null, role: "primary",
    endpoint: "radius.example.internal:1812", version: "1.0.0", cachedPrincipals: 0,
    pendingAccounting: 0, pendingAuth: 0, directorySyncedAt: null, lastError: null };
}
async function issue(app, token, confirmation, key) {
  return app.inject({ method: "POST", url: issueUrl,
    headers: headers(token, null, { "x-tenant-id": "ten_demo_isp", "idempotency-key": key }),
    payload: { reason, confirmation } });
}

test("provider owner can issue a tenant-only agent key, with no secrets in overview", async t => {
  const env = await setup({ nodeEnv: "staging", allowDevAuth: true });
  t.after(() => env.close());
  const provider = await devSession(env.app, "provider");
  const before = await env.app.inject({ method: "GET", url: "/api/v1/radius/overview", headers: headers(provider.token) });
  assert.equal(before.statusCode, 200, before.body);
  assert.equal(before.json().data.credentialConfigured, false);
  assert.equal(before.json().data.agentConnected, false);
  const invalid = await issue(env.app, provider.token, "ROTATE", "invalid-first-issuance");
  assert.equal(invalid.statusCode, 400, invalid.body);
  const response = await issue(env.app, provider.token, "ISSUE", "valid-first-issuance");
  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.headers["cache-control"], /no-store/);
  const { connectorSecret, tenantSlug } = response.json().data;
  assert.equal(tenantSlug, "elite-demo");
  assert.ok(connectorSecret.length >= 32);
  const after = await env.app.inject({ method: "GET", url: "/api/v1/radius/overview", headers: headers(provider.token) });
  assert.equal(after.json().data.credentialConfigured, true);
  assert.equal(after.json().data.agentConnected, false);
  assert.ok(!after.body.includes(connectorSecret));
  const unissued = signed(env.config.connectorSigningSecret, claim("shared-dev-key-is-rejected"));
  const rejected = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/commands/claim",
    headers: unissued.headers, payload: unissued.raw });
  assert.equal(rejected.statusCode, 401);
  const valid = signed(connectorSecret, claim("dedicated-tenant-key-accepted"));
  const accepted = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/commands/claim",
    headers: valid.headers, payload: valid.raw });
  assert.equal(accepted.statusCode, 200, accepted.body);
});

test("a signed heartbeat proves online status, and rotation disconnects existing agent keys", async t => {
  const env = await setup({ nodeEnv: "staging", allowDevAuth: true });
  t.after(() => env.close());
  const provider = await devSession(env.app, "provider");
  const first = await issue(env.app, provider.token, "ISSUE", "create-agent-key");
  assert.equal(first.statusCode, 200, first.body);
  const oldSecret = first.json().data.connectorSecret;
  const heartbeat = signed(oldSecret, beat("signed-live-agent-beat-0001"));
  const online = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/heartbeat",
    headers: heartbeat.headers, payload: heartbeat.raw });
  assert.equal(online.statusCode, 200, online.body);
  const overview = await env.app.inject({ method: "GET", url: "/api/v1/radius/overview",
    headers: headers(provider.token) });
  assert.equal(overview.json().data.agentsOnline, 1);
  assert.equal(overview.json().data.agentConnected, true);
  await env.db.run("UPDATE radius_nodes SET last_seen_at=? WHERE tenant_id='ten_demo_isp'",
    [new Date(Date.now() - 90000).toISOString()]);
  const timedOut = await env.app.inject({ method: "GET", url: "/api/v1/radius/overview",
    headers: headers(provider.token) });
  assert.equal(timedOut.json().data.agentConnected, false);
  assert.equal(timedOut.json().data.agentsOnline, 0);
  const recovered = signed(oldSecret, beat("restored-agent-heartbeat-0001"));
  assert.equal((await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/heartbeat",
    headers: recovered.headers, payload: recovered.raw })).statusCode, 200);
  const noImplicitRotate = await issue(env.app, provider.token, "ISSUE", "no-implicit-rotation");
  assert.equal(noImplicitRotate.statusCode, 400);
  const second = await issue(env.app, provider.token, "ROTATE", "explicit-agent-rotation");
  assert.equal(second.statusCode, 200, second.body);
  const newSecret = second.json().data.connectorSecret;
  assert.notEqual(newSecret, oldSecret);
  const offline = await env.app.inject({ method: "GET", url: "/api/v1/radius/overview",
    headers: headers(provider.token) });
  assert.equal(offline.json().data.agentsOnline, 0);
  assert.equal(offline.json().data.agentConnected, false);
  const stale = signed(oldSecret, claim("stale-old-agent-key-0002"));
  const denied = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/commands/claim",
    headers: stale.headers, payload: stale.raw });
  assert.equal(denied.statusCode, 401);
  const fresh = signed(newSecret, beat("new-agent-key-heartbeat-0002"));
  const backOnline = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/heartbeat",
    headers: fresh.headers, payload: fresh.raw });
  assert.equal(backOnline.statusCode, 200, backOnline.body);
  const restored = await env.app.inject({ method: "GET", url: "/api/v1/radius/overview",
    headers: headers(provider.token) });
  assert.equal(restored.json().data.agentConnected, true);
});

test("admins and other tenant members cannot issue a provider-owner connector key", async t => {
  const env = await setup(); t.after(() => env.close());
  const admin = await createUserSession(env.db, env.config, { role: "admin" });
  const viewer = await createUserSession(env.db, env.config, { role: "viewer" });
  assert.equal((await issue(env.app, admin.token, "ISSUE", "denied-admin-issue")).statusCode, 403);
  assert.equal((await issue(env.app, viewer.token, "ISSUE", "denied-viewer-issue")).statusCode, 403);
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM integrations WHERE type='radius' AND secret_ciphertext IS NOT NULL")).total, 0);
});
