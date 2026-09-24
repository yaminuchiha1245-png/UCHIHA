import assert from "node:assert/strict";
import test from "node:test";
import { signPayload } from "../src/security.js";
import { devSession, headers, setup } from "./helpers.js";

async function post(app, token, url, payload, key) {
  return app.inject({ method: "POST", url, headers: headers(token, null,
    { "idempotency-key": key }), payload });
}
function signed(secret, payload) {
  const raw = JSON.stringify(payload), stamp = String(Math.floor(Date.now() / 1000));
  return { payload: raw,
    headers: { "content-type": "application/json",
      "x-uchiha-timestamp": stamp, "x-uchiha-signature": signPayload(secret, stamp, raw) } };
}
function heartbeat(agentId, siteId, nonce, routers = []) {
  return { agentId, siteId, nonce, nonceExpiresAt: new Date(Date.now() + 90_000).toISOString(),
    name: agentId, role: "primary", version: "1.0.0",
    cachedPrincipals: 0, pendingAccounting: 0, pendingAuth: 0, lastError: null, routers };
}
async function addLegacy(db, name, id, host = "11.5.50.0", port = 8728) {
  const now = new Date().toISOString();
  await db.run("INSERT INTO network_devices (id,tenant_id,site_id,name,host,api_port,"+
      "connection_method,status,created_at,updated_at) "+
      "VALUES (?,'ten_demo_isp',NULL,?,?,?,'agent','pending',?,?)",
    [id, name, host, port, now, now]);
}
async function site(app, token, name, code) {
  const r = await post(app, token, "/api/v1/sites", { name, code }, "site-"+code);
  assert.equal(r.statusCode, 201, r.body);
  return r.json().data.id;
}
async function patch(app, token, id, changes, key) {
  return app.inject({ method: "PATCH", url: "/api/v1/devices/"+id,
    headers: headers(token, null, { "idempotency-key": "edit-router-"+key }),
    payload: { ...changes, reason: "Correction of separate ISP site endpoint" } });
}

test("legacy matching IPs are diagnosed, editable, and scoped to separate sites", async t => {
  const env = await setup(); t.after(() => env.close());
  const token = (await devSession(env.app, "provider")).token;
  const a = "dev_legacy_site_a1234567", b = "dev_legacy_site_b1234567";
  await addLegacy(env.db, "Legacy Alpha", a);
  await addLegacy(env.db, "Legacy Beta", b);
  const url = "/api/v1/devices/connection-diagnostics";
  const initial = await env.app.inject({ method: "GET", url, headers: headers(token) });
  assert.equal(initial.statusCode, 200, initial.body);
  assert.equal(initial.json().data.requireSiteSeparation, true);
  const initialLegacy = initial.json().data.items.filter(item => [a,b].includes(item.id));
  assert.equal(initialLegacy.length, 2);
  assert.ok(initialLegacy.every(item => !item.verifiedOnline));
  for (const row of initialLegacy) {
    assert.ok(row.issues.includes("DUPLICATE_IN_SITE"));
    assert.ok(row.issues.includes("API_SSL_PORT"));
    assert.ok(row.issues.includes("CHECK_ROUTER_IP"));
  }
  const unassigned = await env.app.inject({ method: "GET",
    url: "/api/v1/radius/agent-setup?siteId=unassigned", headers: headers(token) });
  assert.equal(unassigned.statusCode, 200, unassigned.body);
  assert.equal(unassigned.json().data.selectedUnassigned, true);
  assert.ok(unassigned.json().data.routers.some(router => router.id === a));
  assert.equal(unassigned.json().data.environment.RADIUS_AGENT_SITE_ID, "");
  const rename = await patch(env.app, token, a, { name: "Alpha Renamed" }, "legacy-rename");
  assert.equal(rename.statusCode, 200, rename.body);
  const alphaSite = await site(env.app, token, "Alpha Site", "ALPHASITE");
  const betaSite = await site(env.app, token, "Beta Site", "BETASITE");
  const moveA=await patch(env.app, token, a, { siteId: alphaSite, apiPort: 8729 }, "move-a");
  assert.equal(moveA.statusCode, 200, moveA.body);
  assert.equal((await patch(env.app, token, b, { siteId: betaSite, apiPort: 8729 }, "move-b")).statusCode, 200);
  const current = (await env.app.inject({ method: "GET", url, headers: headers(token) })).json().data;
  assert.equal(current.requireSiteSeparation, false);
  const separated=current.items.filter(item => [a,b].includes(item.id));
  assert.equal(separated.length, 2);
  assert.ok(separated.every(row => row.sameAddressDifferentSites));
  assert.ok(separated.every(row => !row.issues.includes("DUPLICATE_IN_SITE")));
  assert.ok(separated.every(row => !row.issues.includes("API_SSL_PORT")));
  const configA = await env.app.inject({ method: "GET", url: "/api/v1/radius/agent-setup?siteId="+alphaSite,
    headers: headers(token) });
  assert.equal(configA.statusCode, 200, configA.body);
  assert.equal(configA.json().data.routers.length, 1);
  assert.equal(configA.json().data.routers[0].id, a);
  assert.equal(configA.json().data.environment.RADIUS_AGENT_SITE_ID, alphaSite);
  const wrongSite = await env.app.inject({ method: "GET", url: "/api/v1/radius/agent-setup?siteId=sit_not_mine",
    headers: headers(token) });
  assert.equal(wrongSite.statusCode, 400);
  const additional = await post(env.app, token, "/api/v1/devices",
    { name: "New beta duplicate", siteId: betaSite,
      host: "11.5.50.0", apiPort: 8729, connectionMethod: "agent" }, "duplicate-in-beta");
  assert.equal(additional.statusCode, 400, additional.body);
  const issued = await post(env.app, token, "/api/v1/radius/credential",
    { reason: "Local routed site verification for two MikroTik routers", confirmation: "ISSUE" },
    "issue-for-separated-sites");
  assert.equal(issued.statusCode, 200, issued.body);
  const secret = issued.json().data.connectorSecret;
  const route = "/connectors/radius/elite-demo/heartbeat";
  const aHeartbeat = signed(secret, heartbeat("local-agent-alpha", alphaSite, "nonce-site-alpha-one",
    [{ deviceId: a, host: "11.5.50.0", port: 8729, status: "online" },
     { deviceId: b, host: "11.5.50.0", port: 8729, status: "online" }]));
  const responseA = await env.app.inject({ method: "POST", url: route, ...aHeartbeat });
  assert.equal(responseA.statusCode, 200, responseA.body);
  assert.equal(responseA.json().data.verifiedRouters, 1);
  const one = (await env.app.inject({ method: "GET", url, headers: headers(token) })).json().data;
  assert.equal(one.items.find(item => item.id === a).verifiedOnline, true);
  assert.equal(one.items.find(item => item.id === b).verifiedOnline, false);
  const bHeartbeat = signed(secret, heartbeat("local-agent-beta", betaSite, "nonce-site-beta-one",
    [{ deviceId: b, host: "11.5.50.0", port: 8729, status: "online" }]));
  const responseB = await env.app.inject({ method: "POST", url: route, ...bHeartbeat });
  assert.equal(responseB.statusCode, 200, responseB.body);
  assert.equal(responseB.json().data.verifiedRouters, 1);
  const both = (await env.app.inject({ method: "GET", url, headers: headers(token) })).json().data;
  assert.ok(both.items.filter(item => [a,b].includes(item.id)).every(item => item.verifiedOnline && item.agentOnline));
  assert.ok(both.methods.some(item => item.id === "docker-lan" && item.supported));
  assert.equal(both.methods.find(item => item.id === "cloud-direct").supported, false);
});

test("ambiguous old same-site routers cannot both be marked online by one signed agent", async t => {
  const env = await setup(); t.after(() => env.close());
  const token = (await devSession(env.app, "provider")).token;
  const a = "dev_ambiguous_old_a12345", b = "dev_ambiguous_old_b12345";
  await addLegacy(env.db, "Ambiguous One", a, "192.168.88.1", 8729);
  await addLegacy(env.db, "Ambiguous Two", b, "192.168.88.1", 8729);
  const issued = await post(env.app, token, "/api/v1/radius/credential",
    { reason: "Reject ambiguous management probes from legacy endpoints", confirmation: "ISSUE" },
    "issue-for-ambiguous");
  assert.equal(issued.statusCode, 200, issued.body);
  const proof = signed(issued.json().data.connectorSecret,
    heartbeat("local-agent-old", null, "nonce-ambiguous-old",
      [{ deviceId: a, host: "192.168.88.1", port: 8729, status: "online" },
       { deviceId: b, host: "192.168.88.1", port: 8729, status: "online" }]));
  const result = await env.app.inject({ method: "POST",
    url: "/connectors/radius/elite-demo/heartbeat", ...proof });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().data.verifiedRouters, 0);
  const diagnostics = await env.app.inject({ method: "GET",
    url: "/api/v1/devices/connection-diagnostics", headers: headers(token) });
  assert.equal(diagnostics.json().data.items.filter(item => [a,b].includes(item.id) && item.verifiedOnline).length, 0);
  assert.equal(diagnostics.json().data.requireSiteSeparation, true);
});

test("one real ISP router can use one selected record despite a duplicate registration",async t=>{
 const env=await setup();t.after(()=>env.close());
 const token=(await devSession(env.app,"provider")).token;
 const a="dev_primary_one_123456",b="dev_primary_two_123456";
 await addLegacy(env.db,"Primary ISP registration",a,"192.168.40.1",8729);
 await addLegacy(env.db,"Repeated failed attempt",b,"192.168.40.1",8729);
 const one=await env.app.inject({method:"GET",
  url:"/api/v1/radius/agent-setup?deviceId="+a,headers:headers(token)});
 assert.equal(one.statusCode,200,one.body);
 assert.equal(one.json().data.routerCount,1);
 assert.equal(one.json().data.selectedDeviceId,a);
 assert.deepEqual(one.json().data.routers.map(r=>r.id),[a]);
 const both=await env.app.inject({method:"GET",
  url:"/api/v1/radius/agent-setup",headers:headers(token)});
 assert.equal(both.json().data.routers.filter(r=>[a,b].includes(r.id)).length,2);
 const fake=await env.app.inject({method:"GET",
  url:"/api/v1/radius/agent-setup?deviceId=dev_fake_123456789012",headers:headers(token)});
 assert.equal(fake.statusCode,404,fake.body);
 const conflicting=await env.app.inject({method:"GET",
  url:"/api/v1/radius/agent-setup?deviceId="+a+"&siteId=unassigned",headers:headers(token)});
 assert.equal(conflicting.statusCode,400,conflicting.body);
 const issued=await post(env.app,token,"/api/v1/radius/credential",
  {reason:"Verify one selected real ISP router against duplicate registrations",
   confirmation:"ISSUE"},"issue-one-main-router");
 assert.equal(issued.statusCode,200,issued.body);
 const key=issued.json().data.connectorSecret;
 const payload=heartbeat("isp-primary-agent",null,"nonce-single-primary-device",
  [{deviceId:a,host:"192.168.40.1",port:8729,status:"online"}]);
 const proof=signed(key,payload);
 const result=await env.app.inject({method:"POST",
  url:"/connectors/radius/elite-demo/heartbeat",...proof});
 assert.equal(result.statusCode,200,result.body);
 assert.equal(result.json().data.verifiedRouters,1);
 const rows=(await env.app.inject({method:"GET",
  url:"/api/v1/devices/connection-diagnostics",headers:headers(token)})).json().data.items;
 assert.equal(rows.find(d=>d.id===a).verifiedOnline,true);
 assert.equal(rows.find(d=>d.id===b).verifiedOnline,false);
 // The duplicate record must never display an inherited live connection.
 const updates=await env.db.all("SELECT id,status,last_seen_at FROM network_devices WHERE id IN (?,?)",[a,b]);
 assert.equal(updates.filter(row=>row.status==="online").length,1);
});
