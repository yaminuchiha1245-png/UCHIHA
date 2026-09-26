import assert from "node:assert/strict";
import test from "node:test";
import { DEMO } from "../src/seed.js";
import { devSession, headers, setup } from "./helpers.js";

test("new MikroTik registration defaults to encrypted API-SSL port and remains unverified", async t => {
  const env=await setup(); t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const response=await env.app.inject({method:"POST",url:"/api/v1/devices",
    headers:headers(token,DEMO.tenantId,{"idempotency-key":"router-safe-default"}),
    payload:{name:"Default TLS Router",host:"router-safe.example.test",connectionMethod:"agent"}});
  assert.equal(response.statusCode,201,response.body);
  assert.equal(response.json().data.apiPort,8729);
  assert.equal(response.json().data.status,"pending");
  const row=await env.db.get("SELECT status,last_seen_at,api_port FROM network_devices WHERE id=?",
    [response.json().data.id]);
  assert.equal(row.api_port,8729);
  assert.equal(row.last_seen_at,null);
});

test("manual username or credential edits cannot inherit stale online connectivity", async t => {
  const env=await setup(); t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const now=new Date().toISOString();
  await env.db.run("UPDATE network_devices SET status='online',last_seen_at=? WHERE id='dev_demo_core'",[now]);
  const user=await env.app.inject({method:"PATCH",url:"/api/v1/devices/dev_demo_core",
    headers:headers(token,DEMO.tenantId,{"idempotency-key":"router-username-change"}),
    payload:{username:"new-admin-account",reason:"Changed RouterOS identity"}});
  assert.equal(user.statusCode,200,user.body);
  assert.equal(user.json().data.status,"pending");
  assert.equal(user.json().data.lastSeenAt,null);
  await env.db.run("UPDATE network_devices SET status='online',last_seen_at=? WHERE id='dev_demo_core'",[now]);
  const password="only-for-isolated-test";
  const changed=await env.app.inject({method:"PATCH",url:"/api/v1/devices/dev_demo_core",
    headers:headers(token,DEMO.tenantId,{"idempotency-key":"router-secret-change"}),
    payload:{secret:password,reason:"Changed RouterOS credential"}});
  assert.equal(changed.statusCode,200,changed.body);
  assert.equal(changed.json().data.status,"pending");
  assert.equal(changed.json().data.lastSeenAt,null);
  assert.equal(changed.body.includes(password),false);
});

test("case-insensitive duplicate registration rejects a second router ID", async t => {
  const env=await setup(); t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const payload={name:"Mixed Case Endpoint",host:"ROUTER-CANONICAL.EXAMPLE.TEST",
    apiPort:8729,connectionMethod:"agent"};
  const first=await env.app.inject({method:"POST",url:"/api/v1/devices",
    headers:headers(token,DEMO.tenantId,{"idempotency-key":"router-case-first"}),
    payload});
  assert.equal(first.statusCode,201,first.body);
  assert.equal(first.json().data.host,"router-canonical.example.test");
  const duplicate=await env.app.inject({method:"POST",url:"/api/v1/devices",
    headers:headers(token,DEMO.tenantId,{"idempotency-key":"router-case-second"}),
    payload:{...payload,name:"Another Name",host:payload.host.toLowerCase()}});
  assert.equal(duplicate.statusCode,400,duplicate.body);
  assert.equal((await env.db.get(
    "SELECT COUNT(*) AS n FROM network_devices WHERE tenant_id=? AND LOWER(host)=?",
    [DEMO.tenantId,payload.host.toLowerCase()])).n,1);
});
test("legacy hostnames differing only by case cannot claim two verified online devices",async t=>{
  const env=await setup(); t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const now=new Date().toISOString();
  for(const [id,name,host] of [
    ["dev_legacy_upper","Legacy Upper","LEGACY.EXAMPLE.TEST"],
    ["dev_legacy_lower","Legacy Lower","legacy.example.test"]]){
    await env.db.run(`INSERT INTO network_devices
      (id,tenant_id,name,host,api_port,connection_method,status,last_seen_at,created_at,updated_at)
      VALUES (?,?,?, ?,8729,'agent','online',?,?,?)`,
      [id,DEMO.tenantId,name,host,now,now,now]);
  }
  const result=await env.app.inject({method:"GET",
    url:"/api/v1/devices/connection-diagnostics",headers:headers(token)});
  assert.equal(result.statusCode,200,result.body);
  const duplicates=result.json().data.items.filter(x=>x.id.startsWith("dev_legacy_"));
  assert.equal(duplicates.length,2);
  assert.ok(duplicates.every(x=>x.issues.includes("DUPLICATE_IN_SITE")));
  assert.ok(duplicates.every(x=>x.verifiedOnline===false));
  const evidence=await env.app.inject({method:"GET",
    url:"/api/v1/radius/aaa-evidence?deviceId=dev_legacy_upper",
    headers:headers(token)});
  assert.equal(evidence.statusCode,200,evidence.body);
  assert.equal(evidence.json().data.duplicateRegistrations,2);
  assert.equal(evidence.json().data.attribution,"ambiguous_duplicate_registration");
});