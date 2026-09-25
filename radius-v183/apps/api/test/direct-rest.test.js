import assert from "node:assert/strict";
import test from "node:test";
import {checkDirectRouter,preflightDirectRouter} from "../src/direct-router.js";
import {sweepDirectRouters} from "../src/direct-router-monitor.js";
import {decryptSecret} from "../src/security.js";
import {devSession,headers,setup} from "./helpers.js";

test("RouterOS v7 REST uses pinned HTTPS route and 443 by default",async()=>{
 let options;
 const config={directRouterAllowedCidrs:["10.64.0.0/16"],directRouterAllowPublic:false};
 const input={host:"10.64.12.7",transport:"rest-https",username:"operator",
  password:"sample-test-password",serverName:"mikrotik.core.example"};
 const proof=await checkDirectRouter(input,config,{
  restProbe:async args=>{options=args;return {identity:"PRIMARY CCR"};}
 });
 assert.equal(proof.identity,"PRIMARY CCR");
 assert.equal(proof.transport,"rest-https");
 assert.equal(proof.route,"vpn");
 assert.equal(options.host,"10.64.12.7");
 assert.equal(options.port,443);
 assert.equal(options.serverName,"mikrotik.core.example");
 const preflight=await preflightDirectRouter(
  {host:input.host,transport:"rest-https",serverName:input.serverName},
  config,{tlsProbe:async tls=>{
   assert.equal(tls.port,443);
   assert.equal(tls.rejectUnauthorized,true);
  }});
 assert.equal(preflight.port,443);
 assert.equal(preflight.loginVerified,false);
});

test("REST authentication and missing endpoint produce actionable sanitized codes",async()=>{
 const input={host:"8.8.8.8",transport:"rest-https",username:"test",password:"testpassword"};
 const config={directRouterAllowPublic:true,directRouterAllowedCidrs:[]};
 for(const [sourceCode,expected] of [
  ["ROUTER_REST_AUTH","ROUTER_LOGIN_FAILED"],
  ["ROUTER_REST_NOT_FOUND","ROUTER_REST_UNAVAILABLE"],
  ["ETIMEDOUT","ROUTER_CONNECT_TIMEOUT"],
  ["ERR_TLS_CERT_ALTNAME_INVALID","ROUTER_TLS_CERTIFICATE_FAILED"]
 ]){
  const e=new Error("sensitive raw error must not escape");e.code=sourceCode;
  await assert.rejects(checkDirectRouter(input,config,{
   restProbe:async()=>{throw e;}
  }),err=>err.code===expected && !err.message.includes("sensitive raw error"));
 }
});

test("REST HTTPS direct pairing survives encryption and periodic verification",async t=>{
 const captures=[];
 const env=await setup({directRouterAllowPublic:true,directRouterMonitorEnabled:true,
  directRouterRestProbe:async params=>{captures.push(params);return {identity:"MAIN CCR v7"};}
 });
 t.after(()=>env.close());
 const own=(await devSession(env.app,"provider")).token;
 const pair=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/direct-connect",
  headers:headers(own),payload:{transport:"rest-https",host:"8.8.8.8",
   username:"isp-operator",password:"longtestpassword",confirmedOwned:true,
   reason:"Owner test of read-only RouterOS HTTPS REST"}});
 assert.equal(pair.statusCode,200,pair.body);
 assert.equal(pair.json().data.transport,"rest-https");
 assert.equal(pair.json().data.apiPort,443);
 assert.equal(pair.body.includes("longtestpassword"),false);
 const saved=await env.db.get("SELECT host,api_port,secret_ciphertext,connection_method FROM network_devices WHERE id='dev_demo_core'");
 const decrypted=JSON.parse(decryptSecret(saved.secret_ciphertext,env.config.encryptionKey));
 assert.equal(decrypted.transport,"rest-https");
 assert.equal(saved.api_port,443);
 assert.equal(saved.connection_method,"api");
 const second=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/verify-direct",
  headers:headers(own)});
 assert.equal(second.statusCode,200,second.body);
 assert.equal(captures.length,2);
 assert.ok(captures.every(item=>item.port===443));
 const sweep=await sweepDirectRouters(env.db,env.config);
 assert.equal(sweep.checked,1);
 assert.equal(sweep.online,1);
 assert.equal(captures.length,3);
 assert.ok(captures.every(item=>item.port===443));
});

test("public direct mode refuses private REST targets without an authorized VPN route",async()=>{
 await assert.rejects(checkDirectRouter({host:"192.168.88.1",transport:"rest-https",
  username:"operator",password:"sampletestpass"},{directRouterAllowPublic:true,directRouterAllowedCidrs:[]},
  {restProbe:async()=>{throw Error("adapter must not run")}}),
  err=>err.code==="ROUTER_NETWORK_NOT_APPROVED");
});
