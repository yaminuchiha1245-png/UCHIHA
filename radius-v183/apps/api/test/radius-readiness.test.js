import assert from "node:assert/strict";
import test from "node:test";
import { summarizeRadiusReadiness } from "../src/radius-readiness.js";
import { encryptSecret } from "../src/security.js";
import { devSession,headers,setup,createUserSession } from "./helpers.js";

const defaults={identity:"ISP CORE",transport:"api-ssl",aaaServerReady:false};
test("readiness differentiates management login, RouterOS settings and real subscriber AAA",()=>{
 const report=summarizeRadiusReadiness({...defaults,
  radiusRows:[{address:"203.0.113.6",service:"ppp,hotspot",disabled:"no",
    "authentication-port":"1812","accounting-port":"1813",secret:"HIDE-ME"}],
  pppRows:[{"use-radius":"yes"}],hotspotRows:[{"use-radius":"yes"}]});
 assert.equal(report.managementVerified,true);
 assert.equal(report.aaaServerConfigured,false);
 assert.equal(report.aaaEndToEndVerified,false);
 assert.equal(report.configurationLooksReady,false);
 assert.equal(report.radiusServers.length,1);
 assert.equal(report.pppoe.useRadius,true);
 assert.equal(report.hotspot.useRadius,true);
 assert.ok(report.issues.includes("AAA_SERVER_NOT_ENABLED"));
 assert.equal(JSON.stringify(report).includes("HIDE-ME"),false);
});
test("unknown and disabled RouterOS settings are never misrepresented as verified",()=>{
 const unknown=summarizeRadiusReadiness({...defaults,
  radiusRows:null,pppRows:null,hotspotRows:null,aaaServerReady:true});
 assert.equal(unknown.radiusServers,null);
 assert.equal(unknown.pppoe.useRadius,null);
 assert.equal(unknown.hotspot.useRadius,null);
 assert.equal(unknown.configurationLooksReady,false);
 assert.ok(unknown.issues.includes("ROUTER_RADIUS_SETTINGS_UNAVAILABLE"));
 const disabled=summarizeRadiusReadiness({...defaults,
  aaaServerReady:true,radiusRows:[{address:"10.0.0.1",service:"login",disabled:"yes"}],
  pppRows:[{"use-radius":"no"}],hotspotRows:[{"use-radius":"no"}]});
 assert.equal(disabled.configurationLooksReady,false);
 assert.ok(disabled.issues.includes("ROUTER_RADIUS_SERVER_NOT_CONFIGURED"));
 assert.ok(disabled.issues.includes("PPPOE_RADIUS_DISABLED"));
});
async function saveVerifiedDirectDevice(env,transport="api-ssl"){
 const ciphertext=encryptSecret(JSON.stringify({
  password:"test-device-secret",caPem:null,serverName:"router.test.invalid",transport
 }),env.config.encryptionKey);
 await env.db.run("UPDATE network_devices SET host=?,api_port=?,username=?,secret_ciphertext=?,"+
    "connection_method='api',status='online' WHERE id='dev_demo_core'",
    ["8.8.8.8",transport==="rest-https"?443:8729,"isp-operator",ciphertext]);
 return ciphertext;
}
test("authenticated owner gets sanitized API-SSL readiness without mutating router registration",async t=>{
 const commands=[];let pending=false;
 const env=await setup({
  directRouterAllowPublic:true,radiusUdpReady:false,
  radiusReadinessClientFactory:options=>({
   async connect(){assert.equal(options.host,"8.8.8.8")},
   async talk(args){
    if(pending)throw Error("Concurrent RouterOS talk was not serialized");
    pending=true;commands.push(args[0]);
    await new Promise(resolve=>setImmediate(resolve));
    pending=false;
    switch(args[0]){
     case "/system/identity/print":return[{name:"CORE CCR"}];
     case "/radius/print":return[{address:"203.0.113.9",service:"ppp",disabled:"no",
       "authentication-port":"1812","accounting-port":"1813",secret:"HIDDEN_RADIUS_KEY"}];
     case "/ppp/aaa/print":return[{"use-radius":"yes"}];
     case "/ip/hotspot/profile/print":return[{"use-radius":"no"}];
    }
    throw Error("Unexpected command");
   },close(){}
  })
 });
 t.after(()=>env.close());
 await saveVerifiedDirectDevice(env);
 const token=(await devSession(env.app,"provider")).token;
 const before=await env.db.get("SELECT * FROM network_devices WHERE id='dev_demo_core'");
 const res=await env.app.inject({method:"POST",
  url:"/api/v1/devices/dev_demo_core/radius-readiness",headers:headers(token)});
 assert.equal(res.statusCode,200,res.body);
 const data=res.json().data;
 assert.equal(data.routerIdentity,"CORE CCR");
 assert.equal(data.managementVerified,true);
 assert.equal(data.aaaServerConfigured,false);
 assert.equal(data.pppoe.useRadius,true);
 assert.equal(data.hotspot.useRadius,false);
 assert.equal(data.aaaEndToEndVerified,false);
 assert.deepEqual(commands,[
  "/system/identity/print","/radius/print","/ppp/aaa/print",
  "/ip/hotspot/profile/print"
 ]);
 assert.equal(res.body.includes("HIDDEN_RADIUS_KEY"),false);
 assert.equal(res.body.includes("test-device-secret"),false);
 const after=await env.db.get("SELECT * FROM network_devices WHERE id='dev_demo_core'");
 assert.deepEqual(after,before);
 const viewer=await createUserSession(env.db,env.config,{role:"viewer"});
 const refused=await env.app.inject({method:"POST",
  url:"/api/v1/devices/dev_demo_core/radius-readiness",headers:headers(viewer.token)});
 assert.equal(refused.statusCode,403,refused.body);
});
test("RouterOS v7 HTTPS REST readiness uses a fixed set of read-only endpoints",async t=>{
 const visited=[];
 const env=await setup({
  directRouterAllowPublic:true,radiusUdpReady:false,
  radiusReadinessRestReader:async args=>{
   visited.push(args.path);
   assert.equal(args.host,"8.8.8.8");
   switch(args.path){
    case "/rest/system/identity":return{name:"CCR v7"};
    case "/rest/radius":return[{address:"203.0.113.1",service:"hotspot",disabled:"no",secret:"HIDE"}];
    case "/rest/ppp/aaa":return{"use-radius":"no"};
    case "/rest/ip/hotspot/profile":return[{"use-radius":"yes"}];
   }
   throw Error("Unknown REST endpoint");
  }
 });
 t.after(()=>env.close());
 await saveVerifiedDirectDevice(env,"rest-https");
 const token=(await devSession(env.app,"provider")).token;
 const result=await env.app.inject({method:"POST",
  url:"/api/v1/devices/dev_demo_core/radius-readiness",headers:headers(token)});
 assert.equal(result.statusCode,200,result.body);
 assert.equal(result.json().data.transport,"rest-https");
 assert.equal(result.json().data.hotspot.useRadius,true);
 assert.equal(result.body.includes("HIDE"),false);
 assert.deepEqual(visited,[
  "/rest/system/identity","/rest/radius","/rest/ppp/aaa",
  "/rest/ip/hotspot/profile"
 ]);
});
test("failed read permission produces unknown data, not false confidence",async t=>{
 const env=await setup({
  directRouterAllowPublic:true,
  radiusReadinessClientFactory:()=>({
   async connect(){},async talk(args){
    if(args[0]==="/system/identity/print")return[{name:"MAIN CCR"}];
    throw Error("secret sensitive error details must not leave server");
   },close(){}
  })
 });
 t.after(()=>env.close());
 await saveVerifiedDirectDevice(env);
 const token=(await devSession(env.app,"provider")).token;
 const res=await env.app.inject({method:"POST",
  url:"/api/v1/devices/dev_demo_core/radius-readiness",headers:headers(token)});
 assert.equal(res.statusCode,200,res.body);
 assert.equal(res.json().data.radiusServers,null);
 assert.equal(res.json().data.pppoe.useRadius,null);
 assert.equal(res.json().data.configurationLooksReady,false);
 assert.equal(res.body.includes("secret sensitive error"),false);
});
