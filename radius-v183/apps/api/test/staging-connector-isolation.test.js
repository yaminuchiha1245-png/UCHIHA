import assert from "node:assert/strict";
import test from "node:test";
import { signPayload } from "../src/security.js";
import { devSession, headers, setup } from "./helpers.js";

function signed(secret, body) {
  const raw = JSON.stringify(body), timestamp = String(Math.floor(Date.now() / 1000));
  return { raw, headers: { "content-type": "application/json",
    "x-uchiha-timestamp": timestamp, "x-uchiha-signature": signPayload(secret, timestamp, raw) } };
}
function claim(nonce) {
  return { agentId: "staging-test-agent", nonce,
    nonceExpiresAt: new Date(Date.now() + 90000).toISOString() };
}
test("staging must reject a shared connector secret before owner issues a tenant-specific secret", async (t) => {
  const env = await setup({ nodeEnv: "staging", allowDevAuth: true });
  t.after(() => env.close());
  const initial = signed(env.config.connectorSigningSecret, claim("unissued-tenant-secret-123456"));
  const rejected = await env.app.inject({ method: "POST",
    url: "/connectors/radius/elite-demo/commands/claim", headers: initial.headers,
    payload: initial.raw });
  assert.equal(rejected.statusCode, 503, rejected.body);
  assert.equal((await env.db.get("SELECT COUNT(*) as total FROM connector_nonces")).total, 0);
  const owner = await devSession(env.app, "owner");
  const issued = await env.app.inject({ method: "POST",
    url: "/api/v1/owner/tenants/ten_demo_isp/radius-credential",
    headers: headers(owner.token, null, { "idempotency-key": "staging-rotate-key-123" }),
    payload: { reason: "Dedicated tenant credential for validated staging pairing" } });
  assert.equal(issued.statusCode, 200, issued.body);
  const secret = issued.json().data.connectorSecret;
  assert.ok(secret.length >= 32);
  const old = signed(env.config.connectorSigningSecret, claim("rotated-wrong-secret-123456"));
  const noLongerAllowed = await env.app.inject({ method: "POST",
    url: "/connectors/radius/elite-demo/commands/claim", headers: old.headers,
    payload: old.raw });
  assert.equal(noLongerAllowed.statusCode, 401);
  const real = signed(secret, claim("issued-tenant-secret-123456"));
  const accepted = await env.app.inject({ method: "POST",
    url: "/connectors/radius/elite-demo/commands/claim", headers: real.headers,
    payload: real.raw });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal((await env.db.get("SELECT COUNT(*) as total FROM connector_nonces")).total, 1);
});
