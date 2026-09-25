import assert from "node:assert/strict";
import test from "node:test";
import {preflightDirectRouter} from "../src/direct-router.js";
import {devSession,headers,setup} from "./helpers.js";

test("preflight pins approved route and validates TLS without password or RouterOS login",async()=>{
 const capture=[];
 const config={directRouterAllowedCidrs:["10.42.0.0/16"],directRouterAllowPublic:false};
 const result=await preflightDirectRouter({
  host:"isp.core.example",apiPort:8729,serverName:"router.core.example",
  caPem:"-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----"
 },config,{
  dnsLookup:async()=>[{address:"10.42.12.2",family:4}],
  tlsProbe:async options=>{capture.push(options)}
 });
 assert.equal(result.tlsVerified,true);
 assert.equal(result.loginVerified,false);
 assert.equal(result.routerIdentityVerified,false);
 assert.equal(result.route,"vpn");
 assert.equal(result.port,8729);
 assert.equal(capture.length,1);
 assert.equal(capture[0].host,"10.42.12.2");
 assert.equal(capture[0].servername,"router.core.example");
 assert.equal(capture[0].rejectUnauthorized,true);
 assert.equal(capture[0].minVersion,"TLSv1.2");
});

test("preflight refuses loopback, unapproved addresses and disabled direct mode without a TLS socket",async()=>{
 let attempted=0;
 const stub=async()=>{attempted++};
 await assert.rejects(preflightDirectRouter({host:"127.0.0.1"},{
  directRouterAllowPublic:true,directRouterAllowedCidrs:[]
 },{tlsProbe:stub}),error=>error.code==="ROUTER_NETWORK_NOT_APPROVED");
 await assert.rejects(preflightDirectRouter({host:"10.42.12.2"},{
  directRouterAllowPublic:true,directRouterAllowedCidrs:[]
 },{tlsProbe:stub}),error=>error.code==="ROUTER_NETWORK_NOT_APPROVED");
 await assert.rejects(preflightDirectRouter({host:"11.5.50.0"},{
  directRouterAllowPublic:false,directRouterAllowedCidrs:[]
 },{tlsProbe:stub}),error=>error.code==="ROUTER_ROUTE_NOT_CONFIGURED");
 assert.equal(attempted,0);
});

test("preflight failures expose safe categories, not native TLS exception content",async()=>{
 const config={directRouterAllowPublic:true,directRouterAllowedCidrs:[]};
 const base={host:"8.8.8.8",apiPort:8729};
 for(const [code,expected] of [
  ["ECONNREFUSED","ROUTER_API_SSL_UNAVAILABLE"],
  ["ETIMEDOUT","ROUTER_CONNECT_TIMEOUT"],
  ["EHOSTUNREACH","ROUTER_NO_ROUTE"],
  ["ERR_TLS_CERT_ALTNAME_INVALID","ROUTER_TLS_CERTIFICATE_FAILED"],
  ["ERR_SSL_WRONG_VERSION_NUMBER","ROUTER_TLS_HANDSHAKE_FAILED"]
 ]){
  const error=new Error("private test-only sensitive detail");error.code=code;
  await assert.rejects(preflightDirectRouter(base,config,{
   tlsProbe:async()=>{throw error}
  }),reason=>reason.code===expected&&!reason.message.includes("private test-only"));
 }
});

test("tenant-authenticated preflight confirms record exists, requires ownership, and never writes data",async t=>{
 const env=await setup({
  directRouterAllowPublic:true,
  directRouterTlsProbe:async options=>{
   assert.equal(options.port,8729);
   assert.equal(options.rejectUnauthorized,true);
  }
 });
 t.after(()=>env.close());
 const session=await devSession(env.app,"provider");
 const before=await env.db.get("SELECT * FROM network_devices WHERE id='dev_demo_core'");
 const payload={host:"8.8.8.8",apiPort:8729,confirmedOwned:true};
 const good=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/direct-preflight",
  headers:headers(session.token),payload});
 assert.equal(good.statusCode,200,good.body);
 assert.equal(good.json().data.tlsVerified,true);
 assert.equal(good.json().data.loginVerified,false);
 assert.equal(good.json().data.routerIdentityVerified,false);
 const after=await env.db.get("SELECT * FROM network_devices WHERE id='dev_demo_core'");
 assert.deepEqual(after,before);
 const noOwnership=await env.app.inject({method:"POST",
  url:"/api/v1/devices/dev_demo_core/direct-preflight",headers:headers(session.token),
  payload:{host:"8.8.8.8",apiPort:8729}});
 assert.equal(noOwnership.statusCode,400,noOwnership.body);
 const unknown=await env.app.inject({method:"POST",
  url:"/api/v1/devices/dev_nonexistent_123/direct-preflight",headers:headers(session.token),
  payload});
 assert.equal(unknown.statusCode,404,unknown.body);
});
