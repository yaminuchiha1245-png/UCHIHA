import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const source=fs.readFileSync(path.join(root,"apps/provider-v183-runtime/runtime.js"),"utf8");
const start=source.indexOf(" const miniAppParams=");
const stop=source.indexOf("\n function uuid(){",start);
assert.ok(start>0&&stop>start,"The live Mini App handoff module must exist");
const evaluate=new Function("window","state","navigate","toast","t","document","toggleAdd",
 source.slice(start,stop)+"\nreturn openRequestedMiniAppRoute");
const LOCAL="dev_abc12345678901234567890123456789";
const OTHER="dev_98765432109876543210987654321098";
function harness(search,{role="owner",canWrite=true,ids=[LOCAL]}={}){
 const clicked=[],nav=[],alerts=[],queries=[];
 const state={initialLiveReady:true,me:{role,canWrite},
  devices:ids.map(id=>({id,name:"MikroTik",host:"10.1.2.1"}))};
 const fn=evaluate({location:{search}},state,
  page=>nav.push(page),message=>alerts.push(message),
  (ar)=>ar,{querySelector:selector=>{
   queries.push(selector);
   return {click:()=>clicked.push(selector)};
  }},()=>{throw Error("Subscriber form was not requested")});
 return {fn,clicked,nav,alerts,queries};
}
test("Telegram device link opens precisely the already-registered tenant device",()=>{
 const h=harness("?open=connect-mikrotik&deviceId="+LOCAL);
 h.fn();
 assert.deepEqual(h.nav,["nas"]);
 assert.deepEqual(h.clicked,['[data-v183-direct-connect="'+LOCAL+'"]']);
 h.fn();
 assert.equal(h.clicked.length,1,"Open the form once only");
});
test("other-tenant or malformed device IDs cannot open a router form",()=>{
 for(const id of [OTHER,"../network", "dev_missing"]){
  const h=harness("?open=connect-mikrotik&deviceId="+encodeURIComponent(id));
  h.fn();
  assert.equal(h.clicked.length,0);
  assert.equal(h.queries.length,0);
  assert.ok(h.alerts.length>0);
 }
});
test("a read-only member cannot force direct-router pairing via a web_app link",()=>{
 const h=harness("?open=connect-mikrotik&deviceId="+LOCAL,
  {role:"viewer",canWrite:false});
 h.fn();
 assert.equal(h.clicked.length,0);
 assert.equal(h.queries.length,0);
 assert.ok(h.alerts.length>0);
});
test("bot Site Agent button opens a template for precisely its selected tenant router",()=>{
 const h=harness("?open=site-agent&deviceId="+LOCAL);
 h.fn();
 assert.deepEqual(h.nav,["nas"]);
 assert.deepEqual(h.clicked,['[data-v183-agent-template][data-v183-device-id="'+LOCAL+'"]']);
});
test("unregistered router cannot access another tenant's Site Agent template",()=>{
 const h=harness("?open=site-agent&deviceId="+OTHER);
 h.fn();
 assert.equal(h.clicked.length,0);
 assert.equal(h.queries.length,0);
 assert.ok(h.alerts.length>0);
});
test("viewer cannot start another member's Site Agent enrollment from Telegram",()=>{
 const h=harness("?open=site-agent&deviceId="+LOCAL,{role:"viewer",canWrite:false});
 h.fn();
 assert.equal(h.clicked.length,0);
 assert.ok(h.alerts.length>0);
});
