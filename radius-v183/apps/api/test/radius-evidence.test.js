import assert from "node:assert/strict";
import test from "node:test";
import { signPayload } from "../src/security.js";
import { devSession, headers, setup, createTenant } from "./helpers.js";

async function send(env, kind, event) {
  const raw=JSON.stringify(event);
  const timestamp=String(Math.floor(Date.now()/1000));
  return env.app.inject({method:"POST",
    url:"/connectors/radius/elite-demo/"+kind,
    headers:{"content-type":"application/json","x-uchiha-timestamp":timestamp,
      "x-uchiha-signature":signPayload(env.config.connectorSigningSecret,timestamp,raw)},
    payload:raw});
}
const nonce=i=>"nonce-evidence-"+i+"-abcdefghijk";
const base=i=>({eventId:"radius-evidence-event-"+i,
  nonce:nonce(i),nonceExpiresAt:new Date(Date.now()+60_000).toISOString(),
  username:"ahmad-101",nasIp:"192.0.2.10",occurredAt:new Date().toISOString()});

test("signed AAA events retain tenant evidence without assigning an ambiguous NAS",async t=>{
  const env=await setup(); t.after(()=>env.close());
  const token=(await devSession(env.app,"provider")).token;
  const read=id=>env.app.inject({method:"GET",
    url:"/api/v1/radius/aaa-evidence"+(id?"?deviceId="+id:""),
    headers:headers(token)});
  const auth={...base("auth-1"),agentId:"agent-evidence-test",requestId:"req-evidence-one",
    result:"accept",principalType:"subscriber"};
  const accounting={...base("acct-1"),statusType:"start",
    sessionId:"session-evidence-one",inputBytes:0,outputBytes:0};
  assert.equal((await send(env,"auth-events",auth)).statusCode,202);
  assert.equal((await send(env,"accounting",accounting)).statusCode,202);
  const unique=(await read("dev_demo_core")).json().data;
  assert.equal(unique.attribution,"unique_registered_endpoint");
  assert.equal(unique.deviceEvents.accepted,1);
  assert.equal(unique.deviceEvents.accountingStarts,1);
  assert.equal(unique.subscriberAaaVerified,false);
  assert.equal(unique.internetConnectivityVerified,false);

  const now=new Date().toISOString();
  await env.db.run(`INSERT INTO network_devices
    (id,tenant_id,name,host,api_port,connection_method,status,created_at,updated_at)
    VALUES ('dev_evidence_copy','ten_demo_isp','Duplicate for audit','192.0.2.10',
      8729,'agent','pending',?,?)`,[now,now]);
  assert.equal((await send(env,"auth-events",{...base("auth-2"),agentId:"agent-evidence-test",
    requestId:"req-evidence-two",result:"accept",principalType:"subscriber"})).statusCode,202);
  assert.equal((await send(env,"accounting",{...base("acct-2"),
    statusType:"start",sessionId:"session-evidence-two",
    inputBytes:0,outputBytes:0})).statusCode,202);
  const second=await env.db.get("SELECT device_id,nas_ip FROM radius_auth_events WHERE event_id=?",
    ["radius-evidence-event-auth-2"]);
  assert.equal(second.device_id,null);
  assert.equal(second.nas_ip,"192.0.2.10");
  const first=await env.db.get("SELECT device_id FROM radius_auth_events WHERE event_id=?",
    ["radius-evidence-event-auth-1"]);
  assert.equal(first.device_id,"dev_demo_core");
  const result=await read("dev_demo_core");
  assert.equal(result.statusCode,200,result.body);
  assert.equal(result.headers["cache-control"],"no-store");
  const evidence=result.json().data;
  assert.equal(evidence.attribution,"ambiguous_duplicate_registration");
  assert.equal(evidence.duplicateRegistrations,2);
  assert.equal(evidence.deviceEvents,null);
  assert.equal(evidence.tenantEvents.accepted,2);
  assert.equal(evidence.tenantEvents.accountingStarts,2);
  assert.equal(evidence.subscriberAaaVerified,false);
  assert.equal((await read("dev_bad!")).statusCode,400);
  const other=await createTenant(env.db,"evidence");
  await env.db.run(`INSERT INTO network_devices
    (id,tenant_id,name,host,api_port,connection_method,status,created_at,updated_at)
    VALUES ('dev_other_tenant',?,'Other','192.0.2.10',8729,'agent','pending',?,?)`,
    [other,now,now]);
  assert.equal((await read("dev_other_tenant")).statusCode,404);
});