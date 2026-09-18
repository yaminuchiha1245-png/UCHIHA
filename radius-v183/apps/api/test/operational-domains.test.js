import assert from "node:assert/strict";
import test from "node:test";
import { decryptSecret, signPayload } from "../src/security.js";
import { createUserSession, devSession, headers, setup } from "./helpers.js";
import { createAgent } from "../../radius-agent/src/index.js";

function signedHeaders(secret, raw) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return { "content-type": "application/json", "x-uchiha-timestamp": timestamp,
    "x-uchiha-signature": signPayload(secret, timestamp, raw) };
}

async function write(app, token, method, url, payload, key) {
  return app.inject({ method, url, headers: headers(token, "ten_demo_isp", { "idempotency-key": key }), payload });
}

test("network domains, support and reports are tenant-scoped and operational", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const provider = await devSession(env.app);
  const site = await write(env.app, provider.token, "POST", "/api/v1/sites", { name: "فرع الاختبار", code: "TEST", address: "دمشق" }, "site-create-1");
  assert.equal(site.statusCode, 201, site.body);
  const siteId = site.json().data.id;
  const pool = await write(env.app, provider.token, "POST", "/api/v1/ip-pools", { siteId, name: "PPPoE Test", cidr: "10.44.0.0/24", gateway: "10.44.0.1", dns: ["1.1.1.1"], purpose: "pppoe" }, "pool-create-1");
  assert.equal(pool.statusCode, 201, pool.body);
  const policy = await write(env.app, provider.token, "POST", "/api/v1/radius/policies", { name: "سياسة الاختبار", authMethods: ["pap"], simultaneousUse: 1, interimIntervalSeconds: 300, rateLimitDownMbps: 50, rateLimitUpMbps: 10 }, "policy-create-1");
  assert.equal(policy.statusCode, 201, policy.body);
  const reseller = await write(env.app, provider.token, "POST", "/api/v1/resellers", { siteId, name: "وكيل الاختبار", commissionBps: 500 }, "reseller-create-1");
  assert.equal(reseller.statusCode, 201, reseller.body);
  const ticket = await write(env.app, provider.token, "POST", "/api/v1/support/tickets", { category: "network", priority: "high", title: "اختبار الاتصال", description: "فحص اتصال فرع الاختبار" }, "ticket-create-1");
  assert.equal(ticket.statusCode, 201, ticket.body);
  const report = await env.app.inject({ method: "GET", url: "/api/v1/reports/summary", headers: headers(provider.token) });
  assert.equal(report.statusCode, 200, report.body);
  assert.equal(report.json().data.subscribers.total, 4);
  const topology = await env.app.inject({ method: "GET", url: "/api/v1/topology", headers: headers(provider.token) });
  assert.ok(topology.json().data.sites.some((item) => item.id === siteId));

  const viewer = await createUserSession(env.db, env.config, { role: "viewer" });
  const denied = await write(env.app, viewer.token, "POST", "/api/v1/sites", { name: "ممنوع", code: "NO" }, "viewer-site-denied");
  assert.equal(denied.statusCode, 403);
});

test("subscriber credentials are encrypted and directory sync never exposes them to provider reads", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const provider = await devSession(env.app);
  const created = await write(env.app, provider.token, "POST", "/api/v1/subscribers", {
    username: "radius-secure", radiusPassword: "A-safe-password-55", fullName: "مشترك اختبار", planId: "pln_demo_plus"
  }, "subscriber-secure-create");
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.body.includes("A-safe-password-55"), false);
  assert.equal(created.json().data.credentialConfigured, true);
  const stored = await env.db.get("SELECT radius_secret_ciphertext FROM subscribers WHERE username='radius-secure'");
  assert.equal(stored.radius_secret_ciphertext.includes("A-safe-password-55"), false);
  assert.equal(decryptSecret(stored.radius_secret_ciphertext, env.config.encryptionKey), "A-safe-password-55");

  const request = { agentId: "agent-directory-test", nonce: "directory-nonce-abcdefghi", nonceExpiresAt: new Date(Date.now() + 60_000).toISOString(), afterUsername: "", limit: 500 };
  const raw = JSON.stringify(request);
  const response = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/directory",
    headers: signedHeaders(env.config.connectorSigningSecret, raw), payload: raw });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.headers["cache-control"], /no-store/);
  const principal = response.json().data.principals.find((item) => item.username === "radius-secure");
  assert.equal(principal.password, "A-safe-password-55");
  assert.equal(principal.attributes.rateLimitDownMbps, 50);
});

test("voucher credentials export is no-store and first accepted login activates one subscriber", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const provider = await devSession(env.app);
  const batch = await write(env.app, provider.token, "POST", "/api/v1/voucher-batches", {
    code: "TEST-BATCH", planId: "pln_demo_home", quantity: 2, validDays: 7, usernamePrefix: "TST"
  }, "voucher-batch-create");
  assert.equal(batch.statusCode, 201, batch.body);
  assert.equal(batch.body.includes("password"), false);
  const exported = await env.app.inject({ method: "POST", url: `/api/v1/voucher-batches/${batch.json().data.id}/export`,
    headers: headers(provider.token), payload: { reason: "طباعة بطاقات الاختبار" } });
  assert.equal(exported.statusCode, 200, exported.body);
  assert.match(exported.headers["cache-control"], /no-store/);
  const voucher = exported.json().data.vouchers[0];
  assert.ok(voucher.password.length >= 12);

  const event = { agentId: "agent-auth-test", nonce: "auth-event-nonce-abcdef", nonceExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    eventId: "auth-event-voucher-0001", requestId: "request-voucher-1", username: voucher.username,
    principalType: "voucher", principalId: voucher.id, nasIp: "192.0.2.10", clientIp: "198.51.100.5",
    result: "accept", reason: "matched", latencyMs: 2, occurredAt: new Date().toISOString() };
  const raw = JSON.stringify(event);
  const accepted = await env.app.inject({ method: "POST", url: "/connectors/radius/elite-demo/auth-events",
    headers: signedHeaders(env.config.connectorSigningSecret, raw), payload: raw });
  assert.equal(accepted.statusCode, 202, accepted.body);
  const activated = await env.db.get("SELECT status,subscriber_id FROM vouchers WHERE id=?", [voucher.id]);
  assert.equal(activated.status, "active");
  assert.ok(activated.subscriber_id);
  const subscriber = await env.db.get("SELECT username,status,service_expires_at FROM subscribers WHERE id=?", [activated.subscriber_id]);
  assert.equal(subscriber.username, voucher.username);
  assert.equal(subscriber.status, "active");
  assert.ok(subscriber.service_expires_at);
  assert.equal((await env.db.get("SELECT COUNT(*) AS total FROM radius_auth_events WHERE event_id='auth-event-voucher-0001'")).total, 1);
});

test("local RADIUS agent synchronizes, authenticates and forwards a secret-free audit event", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const provider = await devSession(env.app);
  const credential = await write(env.app, provider.token, "PUT", "/api/v1/subscribers/cus_demo_1/credential",
    { radiusPassword: "offline-radius-77", reason: "اختبار مسار الوكيل المحلي" }, "agent-credential-set");
  assert.equal(credential.statusCode, 200, credential.body);

  const bridgeFetch = async (url, options) => {
    const response = await env.app.inject({ method: options.method, url: new URL(url).pathname, headers: options.headers, payload: options.body });
    return { ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, json: async () => response.json() };
  };
  const agent = createAgent({
    config: { host: "127.0.0.1", port: 0, databasePath: ":memory:", localSecret: "l".repeat(24), cacheKey: "c".repeat(64),
      apiUrl: "http://central.invalid", tenantSlug: "elite-demo", connectorSecret: env.config.connectorSigningSecret,
      agentId: "agent-e2e-test", name: "E2E RADIUS", siteId: null, role: "primary", advertisedEndpoint: "127.0.0.1:1812",
      commandAdapter: "disabled", routersFile: "", pollIntervalMs: 30_000, directorySyncMs: 60_000, heartbeatMs: 15_000 },
    fetchImpl: bridgeFetch, logger: { log() {}, error() {} }
  });
  t.after(() => agent.close());
  await agent.start();
  assert.ok(agent.directory.count() >= 1);
  await agent.heartbeat(true);
  const nodes = await env.app.inject({ method: "GET", url: "/api/v1/radius/nodes", headers: headers(provider.token) });
  assert.equal(nodes.statusCode, 200, nodes.body);
  assert.equal(nodes.json().data.items[0].agentId, "agent-e2e-test");
  const address = agent.server.address();
  const ready = await fetch(`http://127.0.0.1:${address.port}/ready`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).ready, true);
  const authorized = await fetch(`http://127.0.0.1:${address.port}/authorize`, { method: "POST",
    headers: { "content-type": "application/json", "x-agent-secret": "l".repeat(24) },
    body: JSON.stringify({ "Packet-Id": "43", "User-Name": "ahmad-101", "CHAP-Password": "0x1234", "NAS-IP-Address": "192.0.2.10" }) });
  assert.equal(authorized.status, 200);
  const authorizedBody = await authorized.json();
  assert.equal(authorizedBody["control:Cleartext-Password"].value[0], "offline-radius-77");
  assert.equal(authorizedBody["reply:Mikrotik-Rate-Limit"].value[0], "10M/50M");
  const postAuth = await fetch(`http://127.0.0.1:${address.port}/post-auth`, { method: "POST",
    headers: { "content-type": "application/json", "x-agent-secret": "l".repeat(24) },
    body: JSON.stringify({ "Packet-Id": "43", "User-Name": "ahmad-101", "CHAP-Password": "0x1234",
      "NAS-IP-Address": "192.0.2.10", "Response-Packet-Type": "Access-Accept" }) });
  assert.equal(postAuth.status, 200);
  const accepted = await fetch(`http://127.0.0.1:${address.port}/authenticate`, { method: "POST",
    headers: { "content-type": "application/json", "x-agent-secret": "l".repeat(24) },
    body: JSON.stringify({ "Packet-Id": "44", "User-Name": "ahmad-101", "User-Password": "offline-radius-77", "NAS-IP-Address": "192.0.2.10" }) });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json())["reply:Mikrotik-Rate-Limit"].value[0], "10M/50M");
  const rejected = await fetch(`http://127.0.0.1:${address.port}/authenticate`, { method: "POST",
    headers: { "content-type": "application/json", "x-agent-secret": "l".repeat(24) },
    body: JSON.stringify({ "Packet-Id": "45", "User-Name": "ahmad-101", "User-Password": "wrong-password" }) });
  assert.equal(rejected.status, 401);
  await agent.forwardAuthOne();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const events = await env.db.all("SELECT request_id,result,reason FROM radius_auth_events WHERE username='ahmad-101'");
  assert.ok(events.some((event) => event.result === "accept" && event.reason === "matched"));
  assert.ok(events.some((event) => event.result === "accept" && event.reason === "matched" && event.request_id === "43"),
    JSON.stringify({ events, spool: agent.db.prepare("SELECT id,status,attempts,last_error,payload_json FROM auth_spool").all() }));
  assert.ok(events.some((event) => event.result === "reject" && event.reason === "invalid_credentials"));
  const rawEvents = agent.db.prepare("SELECT payload_json FROM auth_spool").all().map((row) => row.payload_json).join("\n");
  assert.equal(rawEvents.includes("offline-radius-77"), false);
});
